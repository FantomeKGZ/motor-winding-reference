#!/usr/bin/env python3
"""Build a validated scheme index from the original handbook pages.

The source handbook is stored in Windows-1251 and must remain unchanged.
This utility reads both original index pages, extracts local HTML links,
checks that their targets exist, and writes UTF-8 JSON reports for the new site.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


@dataclass(frozen=True)
class LinkRecord:
    href: str
    text: str
    target: str
    exists: bool


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._href: str | None = None
        self._text_parts: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attributes = dict(attrs)
        href = attributes.get("href")
        if href:
            self._href = href.strip()
            self._text_parts = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._href is None:
            return
        text = " ".join("".join(self._text_parts).split())
        self.links.append((self._href, text))
        self._href = None
        self._text_parts = []


def is_local_html_link(href: str) -> bool:
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc or href.startswith(('#', 'mailto:', 'javascript:')):
        return False
    path = unquote(parsed.path)
    return path.lower().endswith((".html", ".htm"))


def normalize_target(source_dir: Path, href: str) -> Path:
    parsed = urlsplit(href)
    relative = Path(unquote(parsed.path.replace('\\', '/')))
    return (source_dir / relative).resolve()


def collect_links(index_file: Path) -> list[LinkRecord]:
    raw = index_file.read_bytes()
    text = raw.decode("cp1251", errors="strict")
    parser = LinkParser()
    parser.feed(text)

    source_dir = index_file.parent.resolve()
    records: list[LinkRecord] = []
    seen: set[str] = set()

    for href, label in parser.links:
        if not is_local_html_link(href) or href in seen:
            continue
        seen.add(href)
        target = normalize_target(source_dir, href)
        try:
            target.relative_to(source_dir)
        except ValueError:
            exists = False
        else:
            exists = target.is_file()

        records.append(
            LinkRecord(
                href=href,
                text=label,
                target=target.name,
                exists=exists,
            )
        )

    return records


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--desktop", type=Path, required=True, help="Desktop source index.html")
    parser.add_argument("--mobile", type=Path, required=True, help="Mobile source index.html")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("site/shared/data"),
        help="Directory for generated JSON files",
    )
    args = parser.parse_args()

    inputs = {"desktop": args.desktop, "mobile": args.mobile}
    result: dict[str, list[dict[str, object]]] = {}
    broken_total = 0

    for variant, index_file in inputs.items():
        if not index_file.is_file():
            print(f"ERROR: index file not found: {index_file}", file=sys.stderr)
            return 2

        records = collect_links(index_file)
        broken_total += sum(not record.exists for record in records)
        result[variant] = [asdict(record) for record in records]
        write_json(args.output / f"{variant}-links.json", result[variant])

    desktop_targets = {item["target"] for item in result["desktop"]}
    mobile_targets = {item["target"] for item in result["mobile"]}
    comparison = {
        "desktop_count": len(desktop_targets),
        "mobile_count": len(mobile_targets),
        "common_count": len(desktop_targets & mobile_targets),
        "desktop_only": sorted(desktop_targets - mobile_targets),
        "mobile_only": sorted(mobile_targets - desktop_targets),
        "broken_link_count": broken_total,
    }
    write_json(args.output / "comparison.json", comparison)

    print(json.dumps(comparison, ensure_ascii=False, indent=2))
    return 1 if broken_total else 0


if __name__ == "__main__":
    raise SystemExit(main())
