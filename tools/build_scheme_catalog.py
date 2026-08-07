#!/usr/bin/env python3
"""Build a deterministic catalog of winding-layout variants and connection options.

The legacy handbook remains the source of truth. This tool only reads the old
Windows-1251 HTML and writes derived UTF-8 JSON files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote


SPACE_RE = re.compile(r"\s+")
PITCH_RE = re.compile(r"[уy]\s*=\s*([0-9]+(?:\s*[;,+\-/]\s*[0-9]+)*)", re.I)
BRANCH_RE = re.compile(r"[аa]\s*=\s*(\d+)", re.I)
RPM_RE = re.compile(r"(\d{2,5})\s*об(?:/|\.|\s)*мин", re.I)
POLES_RE = re.compile(r"2p\s*=\s*(\d+)", re.I)
SLOTS_RE = re.compile(r"(?:количеств[оа]\s+пазов|пазов)[^0-9]{0,30}(\d+)", re.I)
Q_RE = re.compile(r"\bq\s*=\s*([\d.,]+)", re.I)


def clean(value: str | None) -> str:
    return SPACE_RE.sub(" ", unescape(value or "")).strip()


def norm(value: str | None) -> str:
    return clean(value).lower().replace("ё", "е")


def norm_path(value: str | None) -> str:
    return unquote((value or "").replace("\\", "/").lstrip("./"))


def stable_id(prefix: str, *parts: str) -> str:
    payload = "|".join(parts).encode("utf-8")
    return f"{prefix}-{hashlib.sha1(payload).hexdigest()[:12].upper()}"


class LegacyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self._p_depth = 0
        self._p_text: list[str] = []
        self._p_links: list[dict[str, str]] = []
        self._p_images: list[dict[str, str]] = []
        self.paragraphs: list[dict] = []
        self.images: list[dict[str, str]] = []
        self.body_chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        data = dict(attrs)
        tag = tag.lower()
        if tag == "title":
            self._in_title = True
        if tag == "p":
            self._p_depth += 1
            if self._p_depth == 1:
                self._p_text, self._p_links, self._p_images = [], [], []
        if tag == "a" and self._p_depth:
            self._p_links.append({"href": data.get("href", ""), "title": data.get("title", "")})
        if tag == "img":
            image = {
                "src": data.get("src", ""),
                "alt": data.get("alt", ""),
                "title": data.get("title", ""),
            }
            self.images.append(image)
            if self._p_depth:
                self._p_images.append(image)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        if tag == "p" and self._p_depth:
            self._p_depth -= 1
            if self._p_depth == 0:
                self.paragraphs.append({
                    "text": clean(" ".join(self._p_text)),
                    "links": list(self._p_links),
                    "images": list(self._p_images),
                })

    def handle_data(self, data: str) -> None:
        text = clean(data)
        if not text:
            return
        self.body_chunks.append(text)
        if self._in_title:
            self.title += (" " if self.title else "") + text
        if self._p_depth:
            self._p_text.append(text)


def parse_html(path: Path) -> LegacyParser:
    raw = path.read_bytes()
    text = raw.decode("windows-1251", errors="replace")
    parser = LegacyParser()
    parser.feed(text)
    parser.close()
    parser.title = clean(parser.title)
    return parser


def winding_types(text: str) -> list[str]:
    source = norm(text)
    rules = [
        ("two_layer", r"двухслойн"),
        ("single_layer", r"однослойн"),
        ("chain", r"цепн"),
        ("concentric", r"вразвалк"),
        ("expanded_phase_zone", r"расширенн.{0,40}фазн.{0,30}зон"),
        ("continuous_phase_zone", r"сплошн.{0,30}фазн.{0,30}зон"),
    ]
    return [label for label, pattern in rules if re.search(pattern, source)]


def special_hints(text: str) -> list[str]:
    source = norm(text)
    rules = [
        ("dahlander", r"даландер|dahlander"),
        ("pole_changing", r"переключ.{0,30}полюс|изменен.{0,30}полюс"),
        ("two_speed", r"двухскорост|2[- ]?скорост"),
        ("three_speed", r"трехскорост|трёхскорост|3[- ]?скорост"),
        ("separate_windings", r"раздельн.{0,20}обмот"),
        ("double_star", r"двойн.{0,10}звезд|yy\b"),
        ("star_delta", r"звезд.{0,10}треуг"),
    ]
    return [label for label, pattern in rules if re.search(pattern, source)]


def connection_kinds(text: str) -> list[str]:
    source = norm(text)
    kinds: list[str] = []
    if re.search(r"в\s+звезд|соединени.{0,35}звезд", source):
        kinds.append("star")
    if re.search(r"в\s+треугольник|соединени.{0,35}треугольник", source):
        kinds.append("delta")
    for item in special_hints(source):
        if item not in kinds:
            kinds.append(item)
    return kinds


def first_number(pattern: re.Pattern, text: str) -> int | None:
    match = pattern.search(text)
    return int(match.group(1)) if match else None


def first_float(pattern: re.Pattern, text: str) -> float | None:
    match = pattern.search(text)
    return float(match.group(1).replace(",", ".")) if match else None


def inspect_connection(root: Path, href: str, cache: dict[str, dict]) -> dict:
    target = norm_path(href)
    if target in cache:
        return cache[target]
    path = root / target
    if not path.is_file():
        result = {"page": target, "missing": True, "types": [], "images": []}
        cache[target] = result
        return result

    doc = parse_html(path)
    page_text = " ".join(doc.body_chunks)
    types = connection_kinds(f"{doc.title} {page_text}")
    images: list[dict] = []
    for idx, paragraph in enumerate(doc.paragraphs):
        ptext = paragraph["text"]
        kinds = connection_kinds(ptext)
        if not kinds:
            continue
        image_src = None
        if paragraph["images"]:
            image_src = norm_path(paragraph["images"][0].get("src"))
        elif idx + 1 < len(doc.paragraphs) and doc.paragraphs[idx + 1]["images"]:
            image_src = norm_path(doc.paragraphs[idx + 1]["images"][0].get("src"))
        if image_src:
            for kind in kinds:
                images.append({"type": kind, "image": image_src, "description": ptext})

    result = {
        "page": target,
        "title": doc.title,
        "types": sorted(set(types)),
        "images": images,
        "special": special_hints(f"{doc.title} {page_text}"),
    }
    cache[target] = result
    return result


def page_parameters(doc: LegacyParser) -> dict:
    text = f"{doc.title} {' '.join(doc.body_chunks)}"
    return {
        "slots": first_number(SLOTS_RE, text),
        "rpm": first_number(RPM_RE, text),
        "poles": first_number(POLES_RE, text),
        "q": first_float(Q_RE, text),
    }


def variants_from_page(root: Path, path: Path, connection_cache: dict[str, dict]) -> list[dict]:
    doc = parse_html(path)
    params = page_parameters(doc)
    target = path.relative_to(root).as_posix()
    variants: list[dict] = []
    seen_images: set[str] = set()

    paragraphs = doc.paragraphs
    for index, paragraph in enumerate(paragraphs):
        description = paragraph["text"]
        if "схема укладки" not in norm(description):
            continue

        image = None
        if paragraph["images"]:
            image = norm_path(paragraph["images"][0].get("src"))
        if not image:
            for following in paragraphs[index + 1:index + 3]:
                if following["images"]:
                    image = norm_path(following["images"][0].get("src"))
                    break
        if not image or image in seen_images:
            continue
        seen_images.add(image)

        pitch_match = PITCH_RE.search(description)
        branches = sorted({int(m.group(1)) for m in BRANCH_RE.finditer(description)})
        conn_pages = []
        for link in paragraph["links"]:
            href = norm_path(link.get("href"))
            if re.match(r"^ss.*\.html?$", href, re.I):
                conn_pages.append(inspect_connection(root, href, connection_cache))

        scheme = {
            "scheme_id": stable_id("CM-SCH", target, image),
            "legacy_page": target,
            "image": image,
            "description": description,
            **params,
            "winding_types": winding_types(description),
            "pitch": clean(pitch_match.group(1)).replace(" ", "") if pitch_match else None,
            "parallel_branches": branches,
            "connections": conn_pages,
            "connection_count": len(conn_pages),
            "special": special_hints(description),
        }
        variants.append(scheme)
    return variants


def build(root: Path) -> dict:
    connection_cache: dict[str, dict] = {}
    schemes: list[dict] = []
    pages_scanned = 0
    pages_with_variants = 0

    for path in sorted(root.rglob("*.htm*")):
        if "_vti_cnf" in path.parts:
            continue
        pages_scanned += 1
        try:
            items = variants_from_page(root, path, connection_cache)
        except Exception as exc:  # catalog generation must report, not mutate source
            print(f"WARN {path}: {exc}")
            continue
        if items:
            pages_with_variants += 1
            schemes.extend(items)

    schemes.sort(key=lambda item: (item.get("slots") or 0, item.get("rpm") or 0, item["legacy_page"], item["image"]))
    return {
        "version": 1,
        "generator": "tools/build_scheme_catalog.py",
        "stats": {
            "pages_scanned": pages_scanned,
            "pages_with_variants": pages_with_variants,
            "schemes": len(schemes),
            "connection_pages": len(connection_cache),
            "schemes_with_multiple_connection_pages": sum(1 for item in schemes if item["connection_count"] > 1),
        },
        "schemes": schemes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--desktop-root", type=Path, required=True)
    parser.add_argument("--mobile-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    for name, root in (("desktop", args.desktop_root), ("mobile", args.mobile_root)):
        catalog = build(root)
        out = args.output / f"{name}-scheme-catalog.json"
        out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{name}: {catalog['stats']['schemes']} schemes; {catalog['stats']['connection_pages']} connection pages -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
