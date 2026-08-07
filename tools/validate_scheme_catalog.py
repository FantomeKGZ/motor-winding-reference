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


def option_identity(option: dict) -> tuple:
    return (
        option.get("page"),
        option.get("image"),
        option.get("type"),
        option.get("scope"),
    )


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
    connection_identities: dict[str, tuple] = {}
    all_connection_ids: set[str] = set()

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
            if not conn.get("page_id"):
                errors.append(f"{name}: {item.get('scheme_id')} connection page lacks page_id")
            page_options = conn.get("options") or []
            page_option_ids = [opt.get("connection_id") for opt in page_options]
            if any(not cid for cid in page_option_ids):
                errors.append(f"{name}: {item.get('scheme_id')} connection page has option without connection_id")
            if len(page_option_ids) != len(set(page_option_ids)):
                errors.append(f"{name}: {item.get('scheme_id')} connection page has duplicate option IDs")

        options = item.get("connection_options") or []
        if item.get("connection_option_count") != len(options):
            errors.append(
                f"{name}: {item.get('scheme_id')} connection_option_count="
                f"{item.get('connection_option_count')} but array has {len(options)}"
            )
        option_ids = [opt.get("connection_id") for opt in options]
        if any(not cid for cid in option_ids):
            errors.append(f"{name}: {item.get('scheme_id')} has connection option without connection_id")
        if len(option_ids) != len(set(option_ids)):
            errors.append(f"{name}: {item.get('scheme_id')} has duplicate connection option IDs")

        connection_pages = {conn.get("page") for conn in connections}
        for option in options:
            cid = option.get("connection_id")
            if not cid:
                continue
            if option.get("page") not in connection_pages:
                errors.append(
                    f"{name}: {item.get('scheme_id')} option {cid} references page outside scheme connections"
                )
            identity = option_identity(option)
            previous = connection_identities.get(cid)
            if previous is not None and previous != identity:
                errors.append(f"{name}: connection_id {cid} maps to different identities")
            connection_identities[cid] = identity
            all_connection_ids.add(cid)

    if missing_connections:
        errors.append(f"{name}: {len(missing_connections)} missing connection-page references")

    if stats.get("schemes") != len(schemes):
        errors.append(f"{name}: stats.schemes does not match schemes array")
    if stats.get("connection_options") != len(all_connection_ids):
        errors.append(
            f"{name}: stats.connection_options={stats.get('connection_options')} "
            f"expected {len(all_connection_ids)}"
        )

    page_dist = Counter(item.get("connection_count", 0) for item in schemes)
    expected_pages = {
        "schemes_without_connection_pages": page_dist.get(0, 0),
        "schemes_with_one_connection_page": page_dist.get(1, 0),
        "schemes_with_multiple_connection_pages": sum(v for k, v in page_dist.items() if k > 1),
        "max_connection_pages_per_scheme": max(page_dist, default=0),
    }
    for key, value in expected_pages.items():
        if stats.get(key) != value:
            errors.append(f"{name}: stats.{key}={stats.get(key)} expected {value}")

    option_dist = Counter(item.get("connection_option_count", 0) for item in schemes)
    expected_options = {
        "schemes_without_connection_options": option_dist.get(0, 0),
        "schemes_with_one_connection_option": option_dist.get(1, 0),
        "schemes_with_multiple_connection_options": sum(v for k, v in option_dist.items() if k > 1),
        "max_connection_options_per_scheme": max(option_dist, default=0),
    }
    for key, value in expected_options.items():
        if stats.get(key) != value:
            errors.append(f"{name}: stats.{key}={stats.get(key)} expected {value}")

    return errors


def connection_map(catalog: dict) -> dict[str, tuple]:
    result: dict[str, tuple] = {}
    for scheme in catalog.get("schemes", []):
        for option in scheme.get("connection_options", []):
            cid = option.get("connection_id")
            if cid:
                result[cid] = option_identity(option)
    return result


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

    desktop_connections = connection_map(desktop)
    mobile_connections = connection_map(mobile)
    only_desktop_connections = sorted(set(desktop_connections) - set(mobile_connections))
    only_mobile_connections = sorted(set(mobile_connections) - set(desktop_connections))
    if only_desktop_connections:
        errors.append(
            f"cross-version: {len(only_desktop_connections)} connection ids only in desktop"
        )
    if only_mobile_connections:
        errors.append(
            f"cross-version: {len(only_mobile_connections)} connection ids only in mobile"
        )

    for cid in sorted(set(desktop_connections) & set(mobile_connections)):
        if desktop_connections[cid] != mobile_connections[cid]:
            errors.append(f"cross-version: connection id {cid} has different metadata")

    report = {
        "valid": not errors,
        "errors": errors,
        "desktop_stats": desktop.get("stats", {}),
        "mobile_stats": mobile.get("stats", {}),
        "cross_version": {
            "same_scheme_ids": not only_desktop and not only_mobile,
            "same_connection_ids": not only_desktop_connections and not only_mobile_connections,
            "only_desktop": only_desktop,
            "only_mobile": only_mobile,
            "only_desktop_connections": only_desktop_connections,
            "only_mobile_connections": only_mobile_connections,
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
        f"{stats.get('connection_options')} connection options; "
        f"{stats.get('schemes_without_connection_pages')} without connection pages; "
        f"{stats.get('schemes_with_one_connection_page')} with one page; "
        f"{stats.get('schemes_with_multiple_connection_pages')} with multiple pages; "
        f"max {stats.get('max_connection_options_per_scheme')} options per scheme."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
