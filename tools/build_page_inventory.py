#!/usr/bin/env python3
"""Inventory legacy handbook HTML pages without modifying the sources.

For every HTML/HTM file the tool records basic preservation metadata:
- title and detected/declared charset;
- byte size and text length;
- linked stylesheets and scripts;
- inline style blocks and style attributes;
- referenced images;
- local HTML links.

The goal is to preserve technical text and page-specific presentation while the
new site shell is developed around the original handbook.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


CHARSET_RE = re.compile(r"charset\s*=\s*['\"]?([A-Za-z0-9._-]+)", re.I)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_title = False
        self.in_style = False
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.stylesheets: list[str] = []
        self.scripts: list[str] = []
        self.images: list[str] = []
        self.links: list[str] = []
        self.inline_style_blocks = 0
        self.style_attributes = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attributes = {k.lower(): v for k, v in attrs}
        if attributes.get("style"):
            self.style_attributes += 1
        if tag == "title":
            self.in_title = True
        elif tag == "style":
            self.in_style = True
            self.inline_style_blocks += 1
        elif tag == "link" and (attributes.get("rel") or "").lower() == "stylesheet":
            if attributes.get("href"):
                self.stylesheets.append(attributes["href"].strip())
        elif tag == "script" and attributes.get("src"):
            self.scripts.append(attributes["src"].strip())
        elif tag == "img" and attributes.get("src"):
            self.images.append(attributes["src"].strip())
        elif tag == "a" and attributes.get("href"):
            self.links.append(attributes["href"].strip())

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self.in_title = False
        elif tag == "style":
            self.in_style = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)
        if not self.in_style:
            self.text_parts.append(data)


def declared_charset(raw: bytes) -> str | None:
    head = raw[:8192].decode("latin-1", errors="ignore")
    match = CHARSET_RE.search(head)
    return match.group(1).lower() if match else None


def decode_html(raw: bytes, declared: str | None) -> tuple[str, str]:
    candidates = []
    if declared:
        candidates.append(declared)
    candidates.extend(["cp1251", "utf-8"])
    seen: set[str] = set()
    for encoding in candidates:
        normalized = encoding.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        try:
            return raw.decode(encoding), encoding
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("cp1251", errors="replace"), "cp1251-replace"


def is_local_html_link(href: str) -> bool:
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc or href.startswith(("#", "mailto:", "javascript:")):
        return False
    return unquote(parsed.path).lower().endswith((".html", ".htm"))


def clean_text(parts: list[str]) -> str:
    return " ".join(" ".join(parts).split())


@dataclass
class PageRecord:
    variant: str
    path: str
    bytes: int
    declared_charset: str | None
    decoded_as: str
    title: str
    text_chars: int
    stylesheet_count: int
    stylesheets: list[str]
    script_count: int
    scripts: list[str]
    inline_style_blocks: int
    style_attributes: int
    image_count: int
    images: list[str]
    local_html_link_count: int
    local_html_links: list[str]


def scan_variant(variant: str, root: Path) -> list[PageRecord]:
    records: list[PageRecord] = []
    for page in sorted([*root.rglob("*.html"), *root.rglob("*.htm")]):
        raw = page.read_bytes()
        declared = declared_charset(raw)
        text, decoded_as = decode_html(raw, declared)
        parser = PageParser()
        parser.feed(text)
        normalized_text = clean_text(parser.text_parts)
        local_links = sorted({href for href in parser.links if is_local_html_link(href)})
        records.append(PageRecord(
            variant=variant,
            path=page.relative_to(root).as_posix(),
            bytes=len(raw),
            declared_charset=declared,
            decoded_as=decoded_as,
            title=clean_text(parser.title_parts),
            text_chars=len(normalized_text),
            stylesheet_count=len(set(parser.stylesheets)),
            stylesheets=sorted(set(parser.stylesheets)),
            script_count=len(set(parser.scripts)),
            scripts=sorted(set(parser.scripts)),
            inline_style_blocks=parser.inline_style_blocks,
            style_attributes=parser.style_attributes,
            image_count=len(set(parser.images)),
            images=sorted(set(parser.images)),
            local_html_link_count=len(local_links),
            local_html_links=local_links,
        ))
    return records


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--desktop-root", required=True, type=Path)
    ap.add_argument("--mobile-root", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()

    desktop = scan_variant("desktop", args.desktop_root)
    mobile = scan_variant("mobile", args.mobile_root)
    all_pages = desktop + mobile

    summary = {
        "desktop_pages": len(desktop),
        "mobile_pages": len(mobile),
        "total_pages": len(all_pages),
        "pages_with_inline_style_blocks": sum(bool(p.inline_style_blocks) for p in all_pages),
        "pages_with_style_attributes": sum(bool(p.style_attributes) for p in all_pages),
        "pages_with_images": sum(bool(p.image_count) for p in all_pages),
        "total_text_chars": sum(p.text_chars for p in all_pages),
        "policy": "Inventory only. Technical text and page-specific styling are not removed automatically.",
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"summary": summary, "pages": [asdict(p) for p in all_pages]}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
