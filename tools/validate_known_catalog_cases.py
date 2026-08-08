#!/usr/bin/env python3
"""Regression checks for a few well-understood legacy handbook cases.

The catalog has broad structural validators, but these checks protect concrete
semantics that are important for the user interface. They intentionally use
real legacy examples instead of synthetic fixtures.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def find_scheme(catalog: dict, *, page: str, image: str) -> dict | None:
    for scheme in catalog.get("schemes") or []:
        if scheme.get("legacy_page") == page and scheme.get("image") == image:
            return scheme
    return None


def option_signature(option: dict) -> tuple[str, str | None, str | None, str]:
    return (
        option.get("page") or "",
        option.get("type") or None,
        option.get("image") or None,
        option.get("scope") or "page",
    )


def validate(catalog: dict) -> list[str]:
    errors: list[str] = []

    # Known 36 slots / 3000 rpm page. This page contains recommendation marker
    # icons before some real winding-layout drawings, so it is a useful guard
    # against accidentally selecting met*.jpg as the scheme image.
    scheme = find_scheme(
        catalog,
        page="y363000.html",
        image="cxemykl/36p/363000y15.jpg",
    )
    if not scheme:
        errors.append("missing known layout y363000.html -> cxemykl/36p/363000y15.jpg")
        return errors

    if scheme.get("slots") != 36:
        errors.append(f"known layout slots expected 36, got {scheme.get('slots')!r}")
    if scheme.get("rpm") != 3000:
        errors.append(f"known layout rpm expected 3000, got {scheme.get('rpm')!r}")
    if scheme.get("poles") != 2:
        errors.append(f"known layout poles expected 2, got {scheme.get('poles')!r}")
    if scheme.get("q") != 6:
        errors.append(f"known layout q expected 6, got {scheme.get('q')!r}")
    if str(scheme.get("pitch")) != "15":
        errors.append(f"known layout pitch expected '15', got {scheme.get('pitch')!r}")
    if "two_layer" not in (scheme.get("winding_types") or []):
        errors.append("known layout must be classified as two_layer")
    branches = {int(x) for x in (scheme.get("parallel_branches") or [])}
    if not {1, 2}.issubset(branches):
        errors.append(f"known layout must allow a=1 and a=2, got {sorted(branches)}")

    signatures = {option_signature(x) for x in (scheme.get("connection_options") or [])}
    expected = {
        (
            "ss2k3000a2.html",
            "star_delta",
            "images/zvtr/tr_zv_2.jpg",
            "image",
        ),
        (
            "ss2k3000a2.html",
            "star",
            "images/ss3000/2k3000a2_zv.jpg",
            "image",
        ),
        (
            "ss2k3000a2.html",
            "delta",
            "images/ss3000/2k3000a2_tr.jpg",
            "image",
        ),
    }
    missing = expected - signatures
    if missing:
        errors.append("known ss2k3000a2 connection mappings missing: " + repr(sorted(missing)))

    # A combined star+delta picture must be one star_delta option, not duplicate
    # star and delta options pointing at the same combined image.
    combined_image = "images/zvtr/tr_zv_2.jpg"
    combined_types = {
        option.get("type")
        for option in (scheme.get("connection_options") or [])
        if option.get("page") == "ss2k3000a2.html" and option.get("image") == combined_image
    }
    if combined_types != {"star_delta"}:
        errors.append(
            f"combined image {combined_image} must map only to star_delta, got {sorted(x for x in combined_types if x)}"
        )

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path)
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    errors = validate(catalog)
    print(f"Known-case validation errors: {len(errors)}")
    for error in errors:
        print("  " + error)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
