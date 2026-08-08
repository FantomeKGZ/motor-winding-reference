#!/usr/bin/env python3
"""Regression checks for well-understood legacy handbook cases.

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


def options_for_page(catalog: dict, page: str) -> list[dict]:
    seen: set[str] = set()
    result: list[dict] = []
    for scheme in catalog.get("schemes") or []:
        for option in scheme.get("connection_options") or []:
            if option.get("page") != page:
                continue
            cid = option.get("connection_id")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            result.append(option)
    return result


def expect_signatures(errors: list[str], catalog: dict, page: str, expected: set[tuple]) -> None:
    signatures = {option_signature(option) for option in options_for_page(catalog, page)}
    missing = expected - signatures
    if missing:
        errors.append(f"known {page} mappings missing: {sorted(missing)!r}")


def validate(catalog: dict) -> list[str]:
    errors: list[str] = []

    # Known 36 slots / 3000 rpm page. This page contains recommendation marker
    # icons before some real winding-layout drawings, so it is a useful guard
    # against accidentally selecting met*.jpg as the scheme image.
    scheme = find_scheme(catalog, page="y363000.html", image="cxemykl/36p/363000y15.jpg")
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

    expect_signatures(errors, catalog, "ss2k3000a2.html", {
        ("ss2k3000a2.html", "star_delta", "images/zvtr/tr_zv_2.jpg", "image"),
        ("ss2k3000a2.html", "star", "images/ss3000/2k3000a2_zv.jpg", "image"),
        ("ss2k3000a2.html", "delta", "images/ss3000/2k3000a2_tr.jpg", "image"),
    })

    combined_image = "images/zvtr/tr_zv_2.jpg"
    combined_types = {
        option.get("type")
        for option in options_for_page(catalog, "ss2k3000a2.html")
        if option.get("image") == combined_image
    }
    if combined_types != {"star_delta"}:
        errors.append(
            f"combined image {combined_image} must map only to star_delta, got {sorted(x for x in combined_types if x)}"
        )

    # Single-phase page: two winding variants (a=1 and a=2) plus a separate
    # motor-to-mains connection diagram must remain individually selectable.
    expect_signatures(errors, catalog, "ss2k3000a1a2m2.html", {
        ("ss2k3000a1a2m2.html", "single_phase_winding", "images/odnofm2/ss3000/ss3000a1m2.jpg", "image"),
        ("ss2k3000a1a2m2.html", "single_phase_winding", "images/odnofm2/ss3000/ss3000a2m2.jpg", "image"),
        ("ss2k3000a1a2m2.html", "single_phase_supply", "cxempodkl/odnofaz/odnofkond.gif", "image"),
    })
    single_options = options_for_page(catalog, "ss2k3000a1a2m2.html")
    branches_by_image = {
        option.get("image"): tuple(option.get("parallel_branches") or [])
        for option in single_options
    }
    if branches_by_image.get("images/odnofm2/ss3000/ss3000a1m2.jpg") != (1,):
        errors.append("single-phase a=1 option lost its branch metadata")
    if branches_by_image.get("images/odnofm2/ss3000/ss3000a2m2.jpg") != (2,):
        errors.append("single-phase a=2 option lost its branch metadata")

    # Two-speed page: preserve both phase-connection alternatives and the mains
    # drawing. The page also contains reversed speed order variants; all are
    # real connection drawings, not duplicates to discard.
    expect_signatures(errors, catalog, "ss250500a3.html", {
        ("ss250500a3.html", "two_speed_winding", "images/dvsk/ss250500/sx250500a3a6.jpg", "image"),
        ("ss250500a3.html", "two_speed_winding", "images/dvsk/ss250500/sx250500a3a6Y.jpg", "image"),
        ("ss250500a3.html", "two_speed_supply", "images/dvsk/ss250500/p250500.jpg", "image"),
        ("ss250500a3.html", "two_speed_winding", "images/dvsk/ss250500/TZsx500200a3a6.jpg", "image"),
        ("ss250500a3.html", "two_speed_winding", "images/dvsk/ss250500/ZZsx500200a3a6.jpg", "image"),
        ("ss250500a3.html", "two_speed_supply", "cxempodkl/dvskor/500250s.JPG", "image"),
    })

    # Three-speed legacy files include a small group encoded as mojibake in the
    # repository. The decoder must still expose one winding drawing and all
    # three mains-connection drawings instead of falling back to a page-only ID.
    expect_signatures(errors, catalog, "ss12K100015003000.html", {
        ("ss12K100015003000.html", "three_speed_winding", "images/dvsk/ss100015003000/ss100015003000.jpg", "image"),
        ("ss12K100015003000.html", "three_speed_supply", "cxempodkl/dvskor/027.jpg", "image"),
        ("ss12K100015003000.html", "three_speed_supply", "cxempodkl/dvskor/028.jpg", "image"),
        ("ss12K100015003000.html", "three_speed_supply", "cxempodkl/dvskor/029.jpg", "image"),
    })

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
