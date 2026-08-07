#!/usr/bin/env python3
"""Inventory handbook images without deleting or merging anything.

The script scans desktop and mobile source trees, calculates SHA-256 hashes,
records image dimensions when possible, and maps HTML pages that reference each
image. Exact duplicates are reported only as byte-identical groups. Similar
looking images are never treated as duplicates automatically.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
HTML_EXTENSIONS = {'.html', '.htm'}


class ImageRefParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != 'img':
            return
        src = dict(attrs).get('src')
        if src:
            self.sources.append(src.strip())


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def image_size(path: Path) -> tuple[int | None, int | None]:
    """Read common image dimensions using only the standard library."""
    try:
        data = path.read_bytes()[:32]
        suffix = path.suffix.lower()
        if suffix == '.png' and data.startswith(b'\x89PNG\r\n\x1a\n'):
            return struct.unpack('>II', data[16:24])
        if suffix == '.gif' and data[:6] in (b'GIF87a', b'GIF89a'):
            return struct.unpack('<HH', data[6:10])
        if suffix in {'.jpg', '.jpeg'}:
            with path.open('rb') as f:
                if f.read(2) != b'\xff\xd8':
                    return None, None
                while True:
                    marker_start = f.read(1)
                    if not marker_start:
                        break
                    if marker_start != b'\xff':
                        continue
                    marker = f.read(1)
                    while marker == b'\xff':
                        marker = f.read(1)
                    if marker in {b'\xd8', b'\xd9'}:
                        continue
                    length_bytes = f.read(2)
                    if len(length_bytes) != 2:
                        break
                    length = struct.unpack('>H', length_bytes)[0]
                    if marker and marker[0] in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                        payload = f.read(5)
                        if len(payload) == 5:
                            height, width = struct.unpack('>HH', payload[1:5])
                            return width, height
                        break
                    f.seek(max(length - 2, 0), 1)
    except (OSError, ValueError, struct.error):
        pass
    return None, None


def decode_html(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ('cp1251', 'utf-8'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode('cp1251', errors='replace')


def normalize_local_ref(page: Path, root: Path, src: str) -> Path | None:
    parsed = urlsplit(src)
    if parsed.scheme or parsed.netloc or src.startswith(('data:', 'javascript:')):
        return None
    rel = Path(unquote(parsed.path.replace('\\', '/')))
    target = (page.parent / rel).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return None
    return target


def collect_references(root: Path) -> dict[Path, list[str]]:
    refs: dict[Path, list[str]] = defaultdict(list)
    for page in root.rglob('*'):
        if not page.is_file() or page.suffix.lower() not in HTML_EXTENSIONS:
            continue
        parser = ImageRefParser()
        try:
            parser.feed(decode_html(page))
        except Exception:
            continue
        for src in parser.sources:
            target = normalize_local_ref(page, root, src)
            if target is not None:
                try:
                    page_rel = page.relative_to(root).as_posix()
                except ValueError:
                    page_rel = page.name
                refs[target].append(page_rel)
    return refs


def scan_variant(name: str, root: Path) -> list[dict[str, object]]:
    references = collect_references(root)
    records: list[dict[str, object]] = []
    for image in sorted(root.rglob('*')):
        if not image.is_file() or image.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        width, height = image_size(image)
        records.append({
            'variant': name,
            'path': image.relative_to(root).as_posix(),
            'bytes': image.stat().st_size,
            'sha256': sha256(image),
            'width': width,
            'height': height,
            'referenced_by': sorted(set(references.get(image.resolve(), []))),
            'reference_count': len(set(references.get(image.resolve(), []))),
        })
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--desktop', type=Path, required=True)
    parser.add_argument('--mobile', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('site/shared/data'))
    args = parser.parse_args()

    desktop = scan_variant('desktop', args.desktop)
    mobile = scan_variant('mobile', args.mobile)
    all_records = desktop + mobile

    by_hash: dict[str, list[dict[str, object]]] = defaultdict(list)
    for record in all_records:
        by_hash[str(record['sha256'])].append(record)

    exact_groups = []
    for digest, records in by_hash.items():
        if len(records) < 2:
            continue
        exact_groups.append({
            'sha256': digest,
            'count': len(records),
            'files': [f"{item['variant']}:{item['path']}" for item in records],
        })

    summary = {
        'desktop_images': len(desktop),
        'mobile_images': len(mobile),
        'total_images': len(all_records),
        'unique_byte_content': len(by_hash),
        'exact_duplicate_groups': len(exact_groups),
        'unreferenced_images': sum(1 for item in all_records if item['reference_count'] == 0),
        'policy': 'No image is deleted or merged automatically. SHA-256 groups mean byte-identical only.',
    }

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'image-inventory.json').write_text(
        json.dumps({'summary': summary, 'images': all_records}, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    (args.output / 'image-exact-duplicates.json').write_text(
        json.dumps({'summary': summary, 'groups': exact_groups}, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
