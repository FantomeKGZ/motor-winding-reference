#!/usr/bin/env python3
"""Fill missing q values in a generated scheme catalog from legacy HTML text.

Some legacy pages render q as table cells like "q" then "6" rather than the
literal text "q=6". The base parser intentionally stays conservative, so this
post-processing step fills only missing q values and never overwrites an
already parsed value.
"""

from __future__ import annotations

import argparse
import json
import re
from html import unescape
from pathlib import Path


def clean_html_text(raw: str) -> str:
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", raw, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_q(path: Path) -> float | None:
    if not path.is_file():
        return None
    raw = path.read_bytes().decode("windows-1251", errors="replace")
    text = clean_html_text(raw)
    patterns = [
        r"\bq\s*=\s*(\d+(?:[.,]\d+)?)",
        r"число\s+пазов\s+на\s+полюс\s+и\s+фазу\s+q\s*(\d+(?:[.,]\d+)?)",
        r"\bq\b\s*(\d+(?:[.,]\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            try:
                return float(match.group(1).replace(",", "."))
            except ValueError:
                continue
    return None


def enrich(catalog: dict, source_root: Path) -> dict:
    cache: dict[str, float | None] = {}
    changed = 0
    unresolved_pages: set[str] = set()

    for scheme in catalog.get("schemes") or []:
        if scheme.get("q") is not None:
            continue
        page = scheme.get("legacy_page") or ""
        if not page:
            continue
        if page not in cache:
            cache[page] = parse_q(source_root / page)
        value = cache[page]
        if value is None:
            unresolved_pages.add(page)
            continue
        scheme["q"] = value
        changed += 1

    report = {
        "tool": "tools/enrich_scheme_catalog_q.py",
        "schemes_enriched": changed,
        "pages_checked": len(cache),
        "pages_still_without_q": len(unresolved_pages),
        "unresolved_pages": sorted(unresolved_pages),
    }
    catalog["q_enrichment"] = report
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path)
    parser.add_argument("source_root", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    report = enrich(catalog, args.source_root)
    args.catalog.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({k: v for k, v in report.items() if k != "unresolved_pages"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
