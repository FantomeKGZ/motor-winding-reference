#!/usr/bin/env python3
"""Extract original homepage tables into UTF-8 JSON without changing sources."""

from __future__ import annotations

import argparse
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[dict[str, object]]]] = []
        self._table: list[list[dict[str, object]]] | None = None
        self._row: list[dict[str, object]] | None = None
        self._cell: dict[str, object] | None = None
        self._cell_text: list[str] = []
        self._link: dict[str, str] | None = None
        self._link_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attributes = {key.lower(): value for key, value in attrs}
        if tag == "table":
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = {
                "tag": tag,
                "rowspan": int(attributes.get("rowspan") or 1),
                "colspan": int(attributes.get("colspan") or 1),
                "links": [],
            }
            self._cell_text = []
        elif tag == "a" and self._cell is not None:
            href = (attributes.get("href") or "").strip()
            self._link = {"href": href, "text": ""}
            self._link_text = []
        elif tag == "br" and self._cell is not None:
            self._cell_text.append(" ")

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell_text.append(data)
        if self._link is not None:
            self._link_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a" and self._link is not None and self._cell is not None:
            self._link["text"] = " ".join("".join(self._link_text).split())
            links = self._cell["links"]
            assert isinstance(links, list)
            links.append(self._link)
            self._link = None
            self._link_text = []
        elif tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._cell["text"] = " ".join("".join(self._cell_text).split())
            self._row.append(self._cell)
            self._cell = None
            self._cell_text = []
        elif tag == "tr" and self._row is not None and self._table is not None:
            if self._row:
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            if self._table:
                self.tables.append(self._table)
            self._table = None


def localize_links(tables: list[list[list[dict[str, object]]]], source_root: Path) -> None:
    for table in tables:
        for row in table:
            for cell in row:
                links = cell.get("links", [])
                assert isinstance(links, list)
                for link in links:
                    href = str(link.get("href", ""))
                    parsed = urlsplit(href)
                    if parsed.scheme or parsed.netloc or not parsed.path:
                        link["exists"] = False
                        continue
                    target = (source_root / parsed.path).resolve()
                    try:
                        target.relative_to(source_root.resolve())
                    except ValueError:
                        link["exists"] = False
                    else:
                        link["exists"] = target.is_file()
                        link["target"] = target.name


def extract(index_file: Path) -> dict[str, object]:
    text = index_file.read_bytes().decode("cp1251", errors="strict")
    parser = TableParser()
    parser.feed(text)
    localize_links(parser.tables, index_file.parent)
    return {
        "source": index_file.name,
        "table_count": len(parser.tables),
        "tables": parser.tables,
    }


def main() -> int:
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("--desktop", type=Path, required=True)
    argument_parser.add_argument("--mobile", type=Path, required=True)
    argument_parser.add_argument("--output", type=Path, default=Path("site/shared/data"))
    args = argument_parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    for variant, source in (("desktop", args.desktop), ("mobile", args.mobile)):
        payload = extract(source)
        target = args.output / f"{variant}-home-tables.json"
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{variant}: {payload['table_count']} tables -> {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
