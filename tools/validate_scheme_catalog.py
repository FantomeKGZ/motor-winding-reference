#!/usr/bin/env python3
"""Validate generated CoilMaster scheme catalogs.

Checks that desktop/mobile catalogs remain structurally compatible and that no
winding variant or connection link is silently lost during generation.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_one(name: str, catalog: dict) -> list[str]:
    errors: list[str] = []
    schemes = catalog.get("schemes") or []
    stats = catalog.get("stats") or {}

    ids = [item.get("scheme_id") for item in schemes]
    if None in ids or "" in ids:
        errors.append(f"{name}: scheme without scheme_id")
    if len(ids) != len(set(ids)):
        errors.append(f"{name}: duplicate scheme_id values")

    pairs = [(item.get("legacy_page"), item.get("image")) for item in schemes]
    if len(pairs) != len(set(pairs)):
        errors.append(f"{name}: duplicate legacy_page + image pairs")

    missing_connections = []
    for item in schemes:
        connections = item.get("connections") or []
        unique_pages = [c.get("page") for c in connections]
        if item.get("connection_count") != len(connections):
            errors.append(
                f"{name}: {item.get('scheme_id')} connection_count="
                f"{item.get('connection_count')} but array has {len(connections)}"
            )
        if len(unique_pages) != len(set(unique_pages)):
            errors.append(f"{name}: {item.get('scheme_id')} has duplicate connection pages")
        for conn in connections:
            if conn.get("missing"):
                missing_connections.append((item.get("scheme_id"), conn.get("page")))

    if missing_connections:
        errors.append(f"{name}: {len(missing_connections)} missing connection-page references")

    if stats.get("schemes") != len(schemes):
        errors.append(f"{name}: stats.schemes does not match schemes array")

    dist = Counter(item.get("connection_count", 0) for item in schemes)
    expected = {
        "schemes_without_connection_pages": dist.get(0, 0),
        "schemes_with_one_connection_page": dist.get(1, 0),
        "schemes_with_multiple_connection_pages": sum(v for k, v in dist.items() if k > 1),
        "max_connection_pages_per_scheme": max(dist, default=0),
    }
    for key, value in expected.items():
        if stats.get(key) != value:
            errors.append(f"{name}: stats.{key}={stats.get(key)} expected {value}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--desktop", type=Path, required=True)
    parser.add_argument("--mobile", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    desktop = load(args.desktop)
    mobile = load(args.mobile)
    errors = validate_one("desktop", desktop) + validate_one("mobile", mobile)

    desktop_ids = {item["scheme_id"] for item in desktop.get("schemes", [])}
    mobile_ids = {item["scheme_id"] for item in mobile.get("schemes", [])}
    only_desktop = sorted(desktop_ids - mobile_ids)
    only_mobile = sorted(mobile_ids - desktop_ids)
    if only_desktop:
        errors.append(f"cross-version: {len(only_desktop)} scheme ids only in desktop")
    if only_mobile:
        errors.append(f"cross-version: {len(only_mobile)} scheme ids only in mobile")

    report = {
        "valid": not errors,
        "errors": errors,
        "desktop_stats": desktop.get("stats", {}),
        "mobile_stats": mobile.get("stats", {}),
        "cross_version": {
            "same_scheme_ids": not only_desktop and not only_mobile,
            "only_desktop": only_desktop,
            "only_mobile": only_mobile,
        },
    }

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    stats = desktop.get("stats", {})
    print(
        "Catalog OK: "
        f"{stats.get('schemes')} schemes; "
        f"{stats.get('schemes_without_connection_pages')} without connection pages; "
        f"{stats.get('schemes_with_one_connection_page')} with one; "
        f"{stats.get('schemes_with_multiple_connection_pages')} with multiple; "
        f"max {stats.get('max_connection_pages_per_scheme')} connection pages per scheme."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
