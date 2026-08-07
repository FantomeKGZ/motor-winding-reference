#!/usr/bin/env python3
"""Audit ambiguous page-scoped CM-CON options in generated scheme catalogs.

This tool is read-only. It does not modify legacy handbook files, generated
catalogs, or ESP32 code. Its purpose is to quantify connection options where the
catalog can safely identify a real ss*.html page but cannot yet bind the option
to one concrete connection image.

The report is also a work queue: ambiguous pages are ranked by how many winding
schemes reference them, so future parser improvements can target the highest
impact legacy pages first.
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
    option_usage: Counter[str] = Counter()
    option_semantics: dict[str, dict] = {}
    option_schemes: dict[str, set[str]] = defaultdict(set)
    page_usage: Counter[str] = Counter()
    page_schemes: dict[str, set[str]] = defaultdict(set)
    page_option_ids: dict[str, set[str]] = defaultdict(set)
    type_counts: Counter[str] = Counter()

    # Count every reference from a winding scheme. Do not deduplicate before
    # counting usage: the purpose is to measure impact on the handbook UI.
    for scheme in catalog.get("schemes") or []:
        scheme_id = scheme.get("scheme_id") or ""
        for option in scheme.get("connection_options") or []:
            if (option.get("scope") or "page") != "page":
                continue
            cid = option.get("connection_id")
            if not cid:
                continue
            page = norm_path(option.get("page"))
            kind = option.get("type") or None
            option_usage[cid] += 1
            option_schemes[cid].add(scheme_id)
            page_usage[page] += 1
            page_schemes[page].add(scheme_id)
            page_option_ids[page].add(cid)
            option_semantics.setdefault(cid, {
                "connection_id": cid,
                "page": page,
                "type": kind,
                "description": option.get("description") or "",
                "first_seen_in_scheme_id": scheme_id,
            })

    page_scoped: list[dict] = []
    unknown_type = 0
    for cid, base in option_semantics.items():
        kind = base["type"]
        if kind:
            type_counts[str(kind)] += 1
        else:
            unknown_type += 1
        page_scoped.append({
            **base,
            "reference_count": option_usage[cid],
            "scheme_count": len(option_schemes[cid]),
        })

    by_page: dict[str, list[dict]] = defaultdict(list)
    for item in page_scoped:
        by_page[item["page"]].append(item)

    ambiguous_pages = []
    for page, items in by_page.items():
        ambiguous_pages.append({
            "page": page,
            "reference_count": page_usage[page],
            "scheme_count": len(page_schemes[page]),
            "option_count": len(page_option_ids[page]),
            "types": sorted({item["type"] for item in items if item["type"]}),
            "unknown_type_options": sum(1 for item in items if not item["type"]),
            "options": sorted(
                items,
                key=lambda item: (-item["reference_count"], str(item["type"] or ""), item["connection_id"]),
            ),
        })

    ambiguous_pages.sort(
        key=lambda item: (
            -item["reference_count"],
            -item["scheme_count"],
            -item["unknown_type_options"],
            item["page"],
        )
    )
    page_scoped.sort(key=lambda item: (-item["reference_count"], item["page"], item["connection_id"]))

    total_references = sum(option_usage.values())
    top10_references = sum(item["reference_count"] for item in ambiguous_pages[:10])

    return {
        "catalog_version": catalog.get("version"),
        "unique_page_scoped_connection_options": len(page_scoped),
        "unique_pages_with_page_scoped_options": len(ambiguous_pages),
        "page_scoped_options_with_unknown_type": unknown_type,
        "page_scoped_options_with_known_type": len(page_scoped) - unknown_type,
        "page_scoped_reference_count": total_references,
        "top_10_pages_reference_count": top10_references,
        "top_10_pages_reference_share": round(top10_references / total_references, 4) if total_references else 0.0,
        "types": dict(sorted(type_counts.items())),
        "priority_pages": ambiguous_pages,
        "options": page_scoped,
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
    print(f"References from winding schemes: {report['page_scoped_reference_count']}")
    print(f"Known type: {report['page_scoped_options_with_known_type']}")
    print(f"Unknown type: {report['page_scoped_options_with_unknown_type']}")
    print(f"Top 10 page share: {report['top_10_pages_reference_share']:.1%}")
    for page in report["priority_pages"][: args.max_items]:
        types = ", ".join(page["types"]) or "unknown"
        print(
            f"  {page['page']}: refs={page['reference_count']}, "
            f"schemes={page['scheme_count']}, options={page['option_count']}, types={types}"
        )
    if len(report["priority_pages"]) > args.max_items:
        print(f"  ... and {len(report['priority_pages']) - args.max_items} more pages")

    # Ambiguity is expected and is not a CI failure. The report is informational.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
