#!/usr/bin/env python3
"""Validate that scheme catalog layout images are real winding drawings, not UI markers."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import unquote

MARKER_RE = re.compile(r"(?:^|/)(?:images/sovmob/)?met\d+[^/]*\.(?:gif|jpe?g|png|webp)$", re.I)


def norm_path(value: str | None) -> str:
    return unquote((value or "").replace("\\", "/").lstrip("./"))


def suspicious(path: str | None) -> bool:
    value = norm_path(path)
    if not value:
        return True
    return bool(MARKER_RE.search(value)) or "/images/sovmob/" in f"/{value.lower()}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path)
    parser.add_argument("--max", type=int, default=30, dest="max_items")
    args = parser.parse_args()

    data = json.loads(args.catalog.read_text(encoding="utf-8"))
    schemes = data.get("schemes") or []
    bad = [
        {
            "scheme_id": item.get("scheme_id"),
            "legacy_page": item.get("legacy_page"),
            "image": item.get("image"),
            "description": item.get("description"),
        }
        for item in schemes
        if suspicious(item.get("image"))
    ]

    print(f"Schemes checked: {len(schemes)}")
    print(f"Suspicious layout images: {len(bad)}")
    for item in bad[: args.max_items]:
        print(f"  {item['scheme_id']} {item['legacy_page']} -> {item['image']}")
    if len(bad) > args.max_items:
        print(f"  ... and {len(bad) - args.max_items} more")

    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
