#!/usr/bin/env python3
"""Validate concrete CM-CON image mappings in a generated scheme catalog.

This is a read-only verifier for the external handbook project. It never edits
legacy HTML/images and never touches ESP32 firmware.

For each connection option with scope="image" it verifies:
- image path is present and is not an obvious UI/marker asset;
- referenced connection page exists;
- referenced image file exists in the legacy handbook;
- the image path is actually referenced by that connection page HTML;
- connection_id matches the deterministic catalog identity rule
  page + image + normalized type.

For scope="page" it verifies that no concrete image is claimed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote


MARKER_RE = re.compile(
    r"(?:^|/)(?:images/sovmob/)?(?:met\d+|marker|icon|recommend)[^/]*\.(?:gif|jpe?g|png|webp)$",
    re.I,
)


def norm_path(value: str | None) -> str:
    return unquote((value or "").replace("\\", "/").lstrip("./"))


def stable_connection_id(page: str, image: str | None, kind: str | None) -> str:
    payload = "|".join([page, image or "", kind or "unknown"]).encode("utf-8")
    return f"CM-CON-{hashlib.sha1(payload).hexdigest()[:12].upper()}"


def suspicious_image(path: str | None) -> bool:
    value = norm_path(path)
    if not value:
        return True
    low = value.lower()
    if "/images/sovmob/" in f"/{low}":
        return True
    return bool(MARKER_RE.search(value))


def page_mentions_image(page_path: Path, image: str) -> bool:
    try:
        html = page_path.read_bytes().decode("windows-1251", errors="replace")
    except OSError:
        return False
    normalized_html = unquote(html.replace("\\", "/")).lower()
    image_norm = norm_path(image).lower()
    return image_norm in normalized_html


def validate(catalog: dict, source_root: Path) -> dict:
    errors: list[dict] = []
    checked = 0
    image_scoped = 0
    page_scoped = 0
    seen_semantics: dict[str, tuple[str, str | None, str | None, str]] = {}

    for scheme in catalog.get("schemes") or []:
        scheme_id = scheme.get("scheme_id")
        for option in scheme.get("connection_options") or []:
            checked += 1
            cid = option.get("connection_id")
            page = norm_path(option.get("page"))
            image = norm_path(option.get("image")) if option.get("image") else None
            kind = option.get("type") or None
            scope = option.get("scope") or "page"

            if not cid:
                errors.append({"code": "missing_connection_id", "scheme_id": scheme_id, "option": option})
                continue

            semantics = (page, image, kind, scope)
            previous = seen_semantics.get(cid)
            if previous and previous != semantics:
                errors.append({
                    "code": "connection_id_semantic_collision",
                    "scheme_id": scheme_id,
                    "connection_id": cid,
                    "previous": previous,
                    "current": semantics,
                })
            else:
                seen_semantics[cid] = semantics

            expected_id = stable_connection_id(page, image, kind)
            if cid != expected_id:
                errors.append({
                    "code": "connection_id_mismatch",
                    "scheme_id": scheme_id,
                    "connection_id": cid,
                    "expected": expected_id,
                    "page": page,
                    "image": image,
                    "type": kind,
                })

            if not page:
                errors.append({"code": "missing_connection_page", "scheme_id": scheme_id, "connection_id": cid})
                continue

            page_path = source_root / page
            if not page_path.is_file():
                errors.append({
                    "code": "connection_page_not_found",
                    "scheme_id": scheme_id,
                    "connection_id": cid,
                    "page": page,
                })
                continue

            if scope == "image":
                image_scoped += 1
                if not image:
                    errors.append({
                        "code": "image_scope_without_image",
                        "scheme_id": scheme_id,
                        "connection_id": cid,
                        "page": page,
                    })
                    continue
                if suspicious_image(image):
                    errors.append({
                        "code": "suspicious_connection_image",
                        "scheme_id": scheme_id,
                        "connection_id": cid,
                        "page": page,
                        "image": image,
                    })
                image_path = source_root / image
                if not image_path.is_file():
                    errors.append({
                        "code": "connection_image_not_found",
                        "scheme_id": scheme_id,
                        "connection_id": cid,
                        "page": page,
                        "image": image,
                    })
                if not page_mentions_image(page_path, image):
                    errors.append({
                        "code": "connection_page_does_not_reference_image",
                        "scheme_id": scheme_id,
                        "connection_id": cid,
                        "page": page,
                        "image": image,
                    })
            else:
                page_scoped += 1
                if image:
                    errors.append({
                        "code": "page_scope_claims_image",
                        "scheme_id": scheme_id,
                        "connection_id": cid,
                        "page": page,
                        "image": image,
                    })

    return {
        "ok": not errors,
        "checked_connection_options": checked,
        "image_scoped_options": image_scoped,
        "page_scoped_options": page_scoped,
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path)
    parser.add_argument("source_root", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--max", type=int, default=40, dest="max_items")
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    report = validate(catalog, args.source_root)

    print(f"Connection options checked: {report['checked_connection_options']}")
    print(f"Image-scoped: {report['image_scoped_options']}")
    print(f"Page-scoped: {report['page_scoped_options']}")
    print(f"Errors: {len(report['errors'])}")
    for item in report["errors"][: args.max_items]:
        print("  " + json.dumps(item, ensure_ascii=False))
    if len(report["errors"]) > args.max_items:
        print(f"  ... and {len(report['errors']) - args.max_items} more")

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
