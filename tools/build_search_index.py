#!/usr/bin/env python3
"""Build compact full-text indexes for the legacy handbook.

The script reads the original Windows-1251 HTML pages without modifying them
and writes UTF-8 JSON indexes consumed by the new external site.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from html.parser import HTMLParser


SPACE_RE = re.compile(r"\s+")
TAG_NOISE_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+")


class PageTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self._in_title = False
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = True
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        if tag in {"script", "style", "noscript"} and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        value = data.strip()
        if not value:
            return
        if self._in_title:
            self.title_parts.append(value)
        self.text_parts.append(value)


def normalize_text(value: str) -> str:
    value = html.unescape(value).replace("\xa0", " ")
    value = TAG_NOISE_RE.sub(" ", value)
    return SPACE_RE.sub(" ", value).strip()


def read_legacy_html(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("cp1251", "utf-8"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    return raw.decode("cp1251", errors="replace")


def make_excerpt(text: str, limit: int = 360) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + "…"


def classify_page(relative: str, title: str, text: str) -> tuple[str, str]:
    """Return a conservative page type without changing legacy content.

    Classification is intentionally broad: it is a navigation hint, not a
    technical assertion about the winding itself.
    """
    path = relative.lower()
    haystack = f"{title} {text[:2200]}".lower()

    if "схем" in haystack and ("уклад" in haystack or re.match(r"^y\d", Path(path).name)):
        return "winding-layout", "Схема укладки"
    if "схем" in haystack and ("соедин" in haystack or Path(path).name.startswith("ss")):
        return "connection", "Схема соединения"
    if any(term in haystack for term in ("обмоточные данные", "данные электродвигател", "тип электродвигател")):
        return "motor-data", "Данные двигателя"
    if "таблиц" in haystack:
        return "table", "Таблица"
    if any(term in haystack for term in ("ремонт", "изоляц", "провод", "подшипник", "технолог")):
        return "reference", "Справочный материал"
    return "page", "Страница справочника"


def build_index(root: Path) -> dict:
    pages = []
    total_chars = 0

    for path in sorted(root.rglob("*.htm*")):
        if any(part.lower() == "_vti_cnf" for part in path.parts):
            continue

        source = read_legacy_html(path)
        parser = PageTextParser()
        try:
            parser.feed(source)
        except Exception:
            # One malformed legacy page must not stop the entire inventory.
            pass

        title = normalize_text(" ".join(parser.title_parts))
        text = normalize_text(" ".join(parser.text_parts))
        if not title:
            title = path.stem

        relative = path.relative_to(root).as_posix()
        page_type, type_label = classify_page(relative, title, text)
        total_chars += len(text)
        pages.append(
            {
                "path": relative,
                "title": title,
                "type": page_type,
                "type_label": type_label,
                "excerpt": make_excerpt(text),
                "search": f"{title} {type_label} {text}".lower(),
            }
        )

    return {
        "version": 2,
        "root": root.name,
        "page_count": len(pages),
        "total_text_chars": total_chars,
        "pages": pages,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--desktop-root", type=Path, required=True)
    parser.add_argument("--mobile-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    targets = {
        "desktop-search-index.json": args.desktop_root,
        "mobile-search-index.json": args.mobile_root,
    }

    for filename, root in targets.items():
        payload = build_index(root)
        (args.output / filename).write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"{filename}: {payload['page_count']} pages, {payload['total_text_chars']} text chars")


if __name__ == "__main__":
    main()
