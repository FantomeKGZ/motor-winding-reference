#!/usr/bin/env python3
"""Audit ambiguous page-scoped CM-CON options in generated scheme catalogs.

This tool is read-only. It does not modify legacy handbook files, generated
catalogs, or ESP32 code. Its purpose is to quantify connection options where the
catalog can safely identify a real ss*.html page but cannot yet bind the option
to one concrete connection image.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote


def norm_path(value: str | None) -> str:
    return unquote((value or "").replace("\\", "/").lstrip("./"))


def audit(catalog: dict) -> dict:
    options_seen: set[str] = set()
    page_scoped: list[dict] = []
    by_page: dict[str, list[dict]] = defaultdict(list)
    type_counts: Counter[str] = Counter()
    unknown_type = 0

    for scheme in catalog.get("schemes") or []:
        scheme_id = scheme.get("scheme_id")
        for option in scheme.get("connection_options") or []:
            if (option.get("scope") or "page") != "page":
                continue
            cid = option.get("connection_id")
            if not cid or cid in options_seen:
                continue
            options_seen.add(cid)
            page = norm_path(option.get("page"))
            kind = option.get("type") or None
            item = {
                "connection_id": cid,
                "page": page,
                "type": kind,
                "description": option.get("description") or "",
                "first_seen_in_scheme_id": scheme_id,
            }
            page_scoped.append(item)
            by_page[page].append(item)
            if kind:
                type_counts[str(kind)] += 1
            else:
                unknown_type += 1

    ambiguous_pages = []
    for page, items in sorted(by_page.items()):
        ambiguous_pages.append({
            "page": page,
            "option_count": len(items),
            "types": sorted({item["type"] for item in items if item["type"]}),
            "unknown_type_options": sum(1 for item in items if not item["type"]),
            "options": items,
        })

    return {
        "catalog_version": catalog.get("version"),
        "unique_page_scoped_connection_options": len(page_scoped),
        "unique_pages_with_page_scoped_options": len(ambiguous_pages),
        "page_scoped_options_with_unknown_type": unknown_type,
        "page_scoped_options_with_known_type": len(page_scoped) - unknown_type,
        "types": dict(sorted(type_counts.items())),
        "pages": ambiguous_pages,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--max", type=int, default=30, dest="max_items")
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    report = audit(catalog)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Unique page-scoped connection options: {report['unique_page_scoped_connection_options']}")
    print(f"Pages with page-scoped options: {report['unique_pages_with_page_scoped_options']}")
    print(f"Known type: {report['page_scoped_options_with_known_type']}")
    print(f"Unknown type: {report['page_scoped_options_with_unknown_type']}")
    for page in report["pages"][: args.max_items]:
        types = ", ".join(page["types"]) or "unknown"
        print(f"  {page['page']}: {page['option_count']} option(s), types={types}")
    if len(report["pages"]) > args.max_items:
        print(f"  ... and {len(report['pages']) - args.max_items} more pages")

    # Ambiguity is expected and is not a CI failure. The report is informational.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
