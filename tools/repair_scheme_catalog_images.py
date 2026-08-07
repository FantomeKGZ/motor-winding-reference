#!/usr/bin/env python3
"""Repair derived scheme-catalog entries that accidentally point at marker icons.

The legacy handbook sometimes places a small recommendation icon inside the same
paragraph as the text "Схема укладки ...". Older catalog extraction may then
mistake that marker for the actual winding-layout image.

This tool NEVER changes legacy HTML or images. It only repairs a generated JSON
catalog by re-reading the referenced legacy page and selecting the first real
layout image after the matching description paragraph.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote


MARKER_PATH_RE = re.compile(
    r"(?:^|/)(?:images/sovmob/)?(?:met\d+|marker|icon|recommend)[^/]*\.(?:gif|jpe?g|png|webp)$",
    re.I,
)


def norm_path(value: str | None) -> str:
    return unquote((value or "").replace("\\", "/").lstrip("./"))


def stable_scheme_id(page: str, image: str) -> str:
    payload = f"{page}|{image}".encode("utf-8")
    return f"CM-SCH-{hashlib.sha1(payload).hexdigest()[:12].upper()}"


def is_marker(path: str | None) -> bool:
    value = norm_path(path)
    if not value:
        return True
    low = value.lower()
    if "/images/sovmob/" in f"/{low}" and re.search(r"/(?:met\d+)[^/]*\.", f"/{low}"):
        return True
    return bool(MARKER_PATH_RE.search(value))


class ParagraphImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.text: list[str] = []
        self.images: list[str] = []
        self.paragraphs: list[dict] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        data = dict(attrs)
        if tag == "p":
            self.depth += 1
            if self.depth == 1:
                self.text = []
                self.images = []
        elif tag == "img" and self.depth:
            src = norm_path(data.get("src"))
            if src:
                self.images.append(src)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "p" and self.depth:
            self.depth -= 1
            if self.depth == 0:
                self.paragraphs.append({
                    "text": " ".join(" ".join(self.text).split()),
                    "images": list(self.images),
                })

    def handle_data(self, data: str) -> None:
        if self.depth:
            value = " ".join(data.split())
            if value:
                self.text.append(value)


def parse_page(path: Path) -> list[dict]:
    parser = ParagraphImageParser()
    parser.feed(path.read_bytes().decode("windows-1251", errors="replace"))
    parser.close()
    return parser.paragraphs


def find_real_image(root: Path, page: str, description: str) -> str | None:
    path = root / norm_path(page)
    if not path.is_file():
        return None
    paragraphs = parse_page(path)
    wanted = " ".join((description or "").lower().replace("ё", "е").split())

    candidate_indexes: list[int] = []
    for idx, item in enumerate(paragraphs):
        text = " ".join(item["text"].lower().replace("ё", "е").split())
        if "схема укладки" not in text:
            continue
        if wanted and text == wanted:
            candidate_indexes.insert(0, idx)
        else:
            candidate_indexes.append(idx)

    for idx in candidate_indexes:
        # First prefer a non-marker image in the description paragraph itself.
        for image in paragraphs[idx]["images"]:
            if not is_marker(image):
                return image
        # In the legacy handbook the real large layout is normally in the next paragraph.
        for following in paragraphs[idx + 1 : idx + 3]:
            for image in following["images"]:
                if not is_marker(image):
                    return image
    return None


def repair(catalog: dict, root: Path) -> tuple[dict, list[dict]]:
    changes: list[dict] = []
    schemes = catalog.get("schemes") or []
    for scheme in schemes:
        old_image = norm_path(scheme.get("image"))
        if not is_marker(old_image):
            continue
        new_image = find_real_image(root, scheme.get("legacy_page", ""), scheme.get("description", ""))
        if not new_image or is_marker(new_image):
            continue
        old_id = scheme.get("scheme_id")
        scheme["image"] = new_image
        scheme["scheme_id"] = stable_scheme_id(scheme.get("legacy_page", ""), new_image)
        changes.append({
            "legacy_page": scheme.get("legacy_page"),
            "old_image": old_image,
            "new_image": new_image,
            "old_scheme_id": old_id,
            "new_scheme_id": scheme["scheme_id"],
        })

    stats = catalog.setdefault("stats", {})
    stats["repaired_marker_images"] = len(changes)
    catalog["image_repair"] = {
        "tool": "tools/repair_scheme_catalog_images.py",
        "changed": len(changes),
    }
    return catalog, changes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path, help="Generated scheme catalog JSON")
    parser.add_argument("source_root", type=Path, help="Legacy handbook root")
    parser.add_argument("--output", type=Path, help="Output JSON; defaults to replacing catalog")
    parser.add_argument("--report", type=Path, help="Optional JSON report with repaired entries")
    args = parser.parse_args()

    data = json.loads(args.catalog.read_text(encoding="utf-8"))
    repaired, changes = repair(data, args.source_root)
    output = args.output or args.catalog
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(repaired, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps({"changed": len(changes), "changes": changes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Repaired marker-image catalog entries: {len(changes)}")
    for item in changes[:20]:
        print(f"  {item['legacy_page']}: {item['old_image']} -> {item['new_image']}")
    if len(changes) > 20:
        print(f"  ... and {len(changes) - 20} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
