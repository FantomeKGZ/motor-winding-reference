#!/usr/bin/env python3
"""Audit legacy ss*.html templates behind page-scoped connection options.

Read-only analysis for the external handbook project. The goal is to identify
repeated HTML structures that can later be promoted safely from scope="page"
to scope="image" without adding per-file guesses.

The tool deliberately does not rewrite the catalog. It reports evidence only.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", unescape(value or "")).strip()


def norm(value: str | None) -> str:
    return clean(value).lower().replace("ё", "е")


def norm_path(value: str | None) -> str:
    return unquote((value or "").replace("\\", "/").lstrip("./"))


def is_marker(path: str | None) -> bool:
    value = norm_path(path).lower()
    if not value:
        return True
    if "images/sovmob/" in value:
        return True
    return bool(re.search(r"(?:^|/)(?:met\d+|marker|icon|recommend)[^/]*\.(?:gif|jpe?g|png|webp)$", value, re.I))


def explicit_kinds(text: str) -> list[str]:
    source = norm(text)
    result: list[str] = []
    if re.search(r"звезд.{0,18}(?:и|/|-)?.{0,8}треуг", source):
        return ["star_delta"]
    if re.search(r"в\s+звезд|соединени.{0,35}звезд", source):
        result.append("star")
    if re.search(r"в\s+треугольник|соединени.{0,35}треугольник", source):
        result.append("delta")
    if re.search(r"даландер|dahlander", source):
        result.append("dahlander")
    if re.search(r"двойн.{0,10}звезд|\byy\b", source):
        result.append("double_star")
    return list(dict.fromkeys(result))


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.text: list[str] = []
        self.images: list[str] = []
        self.paragraphs: list[dict] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        data = dict(attrs)
        if tag == "p":
            self.depth += 1
            if self.depth == 1:
                self.text, self.images = [], []
        elif tag == "img" and self.depth:
            src = norm_path(data.get("src"))
            if src:
                self.images.append(src)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "p" and self.depth:
            self.depth -= 1
            if self.depth == 0:
                self.paragraphs.append({
                    "text": clean(" ".join(self.text)),
                    "images": list(self.images),
                })

    def handle_data(self, data: str) -> None:
        if self.depth:
            value = clean(data)
            if value:
                self.text.append(value)


def parse(path: Path) -> list[dict]:
    parser = Parser()
    parser.feed(path.read_bytes().decode("windows-1251", errors="replace"))
    parser.close()
    return parser.paragraphs


def inspect_page(path: Path) -> dict:
    paragraphs = parse(path)
    explicit: list[dict] = []
    for index, paragraph in enumerate(paragraphs):
        kinds = explicit_kinds(paragraph["text"])
        if not kinds:
            continue
        nearby: list[str] = []
        for candidate in paragraphs[index:index + 4]:
            for image in candidate.get("images", []):
                if image not in nearby and not is_marker(image):
                    nearby.append(image)
        explicit.append({
            "paragraph_index": index,
            "text": paragraph["text"],
            "kinds": kinds,
            "nearby_real_images": nearby,
            "safe_single_image": nearby[0] if len(nearby) == 1 else None,
        })

    safe = [item for item in explicit if item["safe_single_image"]]
    ambiguous = [item for item in explicit if len(item["nearby_real_images"]) != 1]
    signature = {
        "explicit_caption_count": len(explicit),
        "safe_single_image_caption_count": len(safe),
        "ambiguous_caption_count": len(ambiguous),
        "has_star": any("star" in x["kinds"] for x in explicit),
        "has_delta": any("delta" in x["kinds"] for x in explicit),
        "has_star_delta": any("star_delta" in x["kinds"] for x in explicit),
    }
    signature_key = ";".join(f"{k}={int(v) if isinstance(v, bool) else v}" for k, v in signature.items())
    return {
        "signature": signature,
        "signature_key": signature_key,
        "captions": explicit,
        "safe_promotion_candidates": safe,
    }


def audit(catalog: dict, source_root: Path) -> dict:
    page_refs: Counter[str] = Counter()
    page_options: dict[str, set[str]] = defaultdict(set)
    page_types: dict[str, set[str]] = defaultdict(set)

    for scheme in catalog.get("schemes") or []:
        for option in scheme.get("connection_options") or []:
            if (option.get("scope") or "page") != "page":
                continue
            page = norm_path(option.get("page"))
            if not page:
                continue
            page_refs[page] += 1
            if option.get("connection_id"):
                page_options[page].add(option["connection_id"])
            if option.get("type"):
                page_types[page].add(str(option["type"]))

    pages: list[dict] = []
    signatures: Counter[str] = Counter()
    missing = 0
    safe_pages = 0

    for page, refs in page_refs.items():
        path = source_root / page
        if not path.is_file():
            missing += 1
            pages.append({"page": page, "reference_count": refs, "missing": True})
            continue
        info = inspect_page(path)
        signatures[info["signature_key"]] += 1
        if info["safe_promotion_candidates"]:
            safe_pages += 1
        pages.append({
            "page": page,
            "reference_count": refs,
            "page_scoped_option_count": len(page_options[page]),
            "catalog_types": sorted(page_types[page]),
            **info,
        })

    pages.sort(key=lambda x: (-x.get("reference_count", 0), x.get("page", "")))
    return {
        "catalog_version": catalog.get("version"),
        "page_scoped_pages": len(page_refs),
        "missing_pages": missing,
        "pages_with_at_least_one_safe_single_image_caption": safe_pages,
        "template_signatures": [
            {"signature_key": key, "page_count": count}
            for key, count in signatures.most_common()
        ],
        "priority_pages": pages,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path)
    parser.add_argument("source_root", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--max", type=int, default=20, dest="max_items")
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    report = audit(catalog, args.source_root)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Page-scoped pages: {report['page_scoped_pages']}")
    print(f"Missing pages: {report['missing_pages']}")
    print(f"Pages with safe single-image caption evidence: {report['pages_with_at_least_one_safe_single_image_caption']}")
    for item in report["priority_pages"][: args.max_items]:
        safe = len(item.get("safe_promotion_candidates", []))
        print(f"  {item.get('page')}: refs={item.get('reference_count', 0)}, safe-caption-candidates={safe}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
