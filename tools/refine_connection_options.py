#!/usr/bin/env python3
"""Refine generated connection options using conservative legacy-page parsing.

This post-processing step is intentionally read-only with respect to the legacy
handbook. It rebuilds only derived connection metadata in scheme catalog JSON.

Rules:
- a caption explicitly describing "star and delta" is one composite
  `star_delta` option, not three independent options;
- marker/recommendation icons are never used as CM-CON previews;
- ordinary `images/sovmob/...` drawings are allowed: that directory contains
  both real drawings and a few marker files, so only marker file names are
  rejected;
- single-, two- and three-speed pages and combined-winding pages are classified
  from visible legacy captions, not from file names;
- multiple consecutive image-only paragraphs, and explicitly numbered variant
  paragraphs, can belong to one preceding caption; the association stops when
  a new semantic caption begins;
- a page with legacy mojibake is decoded using evidence from Russian technical
  keywords rather than assuming every file has the same byte encoding;
- when a page/type is known but a concrete image cannot be bound safely, keep a
  page-scoped option instead of guessing.
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


def repair_mojibake(value: str) -> str:
    def repl(match: re.Match[str]) -> str:
        chunk = match.group(0)
        try:
            return chunk.encode("latin1").decode("cp1251")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return chunk

    return re.sub(r"[\x80-\xff]+", repl, value)


def clean(value: str | None) -> str:
    text = repair_mojibake(unescape(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def norm(value: str | None) -> str:
    return clean(value).lower().replace("ё", "е")


def norm_path(value: str | None) -> str:
    return unquote((value or "").replace("\\", "/").lstrip("./"))


def stable_id(prefix: str, *parts: str) -> str:
    payload = "|".join(parts).encode("utf-8")
    return f"{prefix}-{hashlib.sha1(payload).hexdigest()[:12].upper()}"


def is_marker(path: str | None) -> bool:
    value = norm_path(path).lower()
    if not value:
        return True
    return bool(re.search(r"(?:^|/)(?:met\d+|marker|icon|recommend)[^/]*\.(?:gif|jpe?g|png|webp)$", value, re.I))


def parallel_branches(text: str) -> list[int]:
    values: set[int] = set()
    for match in re.finditer(r"[аa]\s*=\s*(\d+(?:\s*[/,;]\s*\d+)*)", text or "", re.I):
        for token in re.findall(r"\d+", match.group(1)):
            values.add(int(token))
    return sorted(values)


def phase_connection(text: str) -> str | None:
    match = re.search(r"соединени[ея]\s+фаз\s*[:\-]?\s*([^.;]+)", clean(text), re.I)
    if not match:
        return None
    value = clean(match.group(1))
    return value or None


def connection_kinds(text: str) -> list[str]:
    source = norm(text)
    kinds: list[str] = []

    if re.search(r"схем[аы]\s+соединени[йя].{0,35}однофазн.{0,20}обмот", source):
        kinds.append("single_phase_winding")
    if re.search(r"схем[аы]\s+подключени[йя].{0,35}однофазн.{0,35}(?:двигател|электродвигател).{0,20}(?:к\s+)?сети", source):
        kinds.append("single_phase_supply")

    if re.search(r"схем[аы]\s+соединени[йя].{0,40}двухскоростн.{0,25}(?:обмот|электродвигател)", source):
        kinds.append("two_speed_winding")
    if re.search(r"схем[аы]\s+подключени[йя].{0,40}двухскоростн.{0,35}(?:двигател|электродвигател).{0,20}(?:к\s+)?сети", source):
        kinds.append("two_speed_supply")

    if re.search(r"схем[аы]\s+соединени[йя].{0,40}(?:трех|трёх)скоростн.{0,25}(?:обмот|электродвигател)", source):
        kinds.append("three_speed_winding")
    if re.search(r"схем[аы]\s+подключени[йя].{0,40}(?:трех|трёх)скоростн.{0,35}(?:двигател|электродвигател).{0,20}(?:к\s+)?сети", source):
        kinds.append("three_speed_supply")

    if re.search(r"схем[аы]\s+соединени[йя].{0,40}совмещенн.{0,20}обмот", source):
        kinds.append("combined_winding")

    star_delta = bool(re.search(r"звезд.{0,18}(?:и|/|-)?.{0,8}треуг", source))
    if star_delta:
        kinds.append("star_delta")
    else:
        if re.search(r"в\s+звезд|соединени.{0,35}звезд", source):
            kinds.append("star")
        if re.search(r"в\s+треугольник|соединени.{0,35}треугольник", source):
            kinds.append("delta")
    if re.search(r"даландер|dahlander", source):
        kinds.append("dahlander")
    if re.search(r"двойн.{0,10}звезд|\byy\b", source):
        kinds.append("double_star")
    return list(dict.fromkeys(kinds))


def subordinate_variant_text(text: str) -> bool:
    source = norm(text)
    return bool(
        re.fullmatch(r"вариант\s*№?\s*\d+\.?", source)
        or re.search(r"схем[аы]\s+соединени[йя].{0,45}совмещенн.{0,20}обмот.{0,45}(?:параллельн|последовательн)", source)
    )


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._p_depth = 0
        self._p_text: list[str] = []
        self._p_images: list[str] = []
        self.paragraphs: list[dict] = []
        self.title = ""
        self._in_title = False
        self.body: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        data = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "p":
            self._p_depth += 1
            if self._p_depth == 1:
                self._p_text = []
                self._p_images = []
        if tag == "img" and self._p_depth:
            src = norm_path(data.get("src"))
            if src:
                self._p_images.append(src)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        if tag == "p" and self._p_depth:
            self._p_depth -= 1
            if self._p_depth == 0:
                self.paragraphs.append({"text": clean(" ".join(self._p_text)), "images": list(self._p_images)})

    def handle_data(self, data: str) -> None:
        text = clean(data)
        if not text:
            return
        self.body.append(text)
        if self._in_title:
            self.title += (" " if self.title else "") + text
        if self._p_depth:
            self._p_text.append(text)


def decode_legacy_bytes(raw: bytes) -> str:
    candidates = []
    for encoding in ("windows-1251", "utf-8"):
        text = raw.decode(encoding, errors="replace")
        repaired = repair_mojibake(text)
        lowered = repaired.lower().replace("ё", "е")
        keyword_score = sum(lowered.count(word) for word in ("схем", "обмот", "электродвиг", "соедин", "подключ"))
        replacement_penalty = repaired.count("�") * 10
        cyrillic_score = len(re.findall(r"[А-Яа-яЁё]", repaired)) / 1000
        candidates.append((keyword_score * 100 + cyrillic_score - replacement_penalty, repaired))
    return max(candidates, key=lambda item: item[0])[1]


def parse_page(path: Path) -> Parser:
    parser = Parser()
    parser.feed(decode_legacy_bytes(path.read_bytes()))
    parser.close()
    parser.title = clean(parser.title)
    return parser


def associated_real_images(paragraphs: list[dict], index: int) -> list[str]:
    images: list[str] = []
    for image in paragraphs[index].get("images", []):
        if not is_marker(image) and image not in images:
            images.append(image)

    for item in paragraphs[index + 1:index + 10]:
        text = clean(item.get("text", ""))
        if text:
            if connection_kinds(text):
                break
            if not subordinate_variant_text(text):
                break
        for image in item.get("images", []):
            if not is_marker(image) and image not in images:
                images.append(image)
    return images


def inspect_page(source_root: Path, page: str) -> dict:
    target = norm_path(page)
    path = source_root / target
    page_id = stable_id("CM-CON-PAGE", target)
    if not path.is_file():
        return {"page": target, "page_id": page_id, "missing": True, "types": [], "images": [], "options": []}

    doc = parse_page(path)
    page_kinds = connection_kinds(f"{doc.title} {' '.join(doc.body)}")
    image_options: list[dict] = []
    seen: set[tuple[str, str]] = set()
    default_branches = parallel_branches(doc.title)

    for index, paragraph in enumerate(doc.paragraphs):
        text = paragraph.get("text", "")
        kinds = connection_kinds(text)
        if not kinds:
            continue
        images = associated_real_images(doc.paragraphs, index)
        if not images:
            continue
        branches = parallel_branches(text) or default_branches
        phase = phase_connection(text)
        for image in images:
            for kind in kinds:
                key = (kind, image)
                if key in seen:
                    continue
                seen.add(key)
                image_options.append({
                    "connection_id": stable_id("CM-CON", target, image, kind),
                    "type": kind,
                    "image": image,
                    "description": text,
                    "parallel_branches": branches,
                    "phase_connection": phase,
                    "scope": "image",
                })

    options = list(image_options)
    image_kinds = {item["type"] for item in image_options}
    specific_image_kinds = image_kinds - {"star", "delta", "star_delta"}
    for kind in page_kinds:
        if kind in image_kinds:
            continue
        # If the page has a more specific, image-backed family (for example a
        # combined-winding diagram), a generic star/delta word in a section
        # heading is metadata for that family, not a separate selectable option.
        if kind in {"star", "delta", "star_delta"} and specific_image_kinds:
            continue
        options.append({
            "connection_id": stable_id("CM-CON", target, "", kind),
            "type": kind,
            "image": None,
            "description": doc.title,
            "parallel_branches": default_branches,
            "phase_connection": phase_connection(doc.title),
            "scope": "page",
        })

    if not options:
        options.append({
            "connection_id": stable_id("CM-CON", target, "", "unknown"),
            "type": None,
            "image": None,
            "description": doc.title,
            "parallel_branches": default_branches,
            "phase_connection": phase_connection(doc.title),
            "scope": "page",
        })

    images = [
        {
            "connection_id": item["connection_id"],
            "type": item["type"],
            "image": item["image"],
            "description": item["description"],
            "parallel_branches": item.get("parallel_branches", []),
            "phase_connection": item.get("phase_connection"),
        }
        for item in image_options
    ]

    return {
        "page": target,
        "page_id": page_id,
        "title": doc.title,
        "types": page_kinds,
        "images": images,
        "options": options,
    }


def refine(catalog: dict, source_root: Path) -> tuple[dict, dict]:
    cache: dict[str, dict] = {}
    changed_schemes = 0
    before_ids: set[str] = set()
    after_ids: set[str] = set()

    for scheme in catalog.get("schemes") or []:
        before = [item.get("connection_id") for item in scheme.get("connection_options") or [] if item.get("connection_id")]
        before_ids.update(before)

        rebuilt_pages = []
        for old_page in scheme.get("connections") or []:
            page = norm_path(old_page.get("page"))
            if not page:
                continue
            if page not in cache:
                cache[page] = inspect_page(source_root, page)
            rebuilt_pages.append(cache[page])

        flat: list[dict] = []
        seen_ids: set[str] = set()
        for page_meta in rebuilt_pages:
            for option in page_meta.get("options", []):
                cid = option.get("connection_id")
                if not cid or cid in seen_ids:
                    continue
                seen_ids.add(cid)
                flat.append({**option, "page": page_meta["page"], "page_id": page_meta["page_id"]})
                after_ids.add(cid)

        after = [item.get("connection_id") for item in flat]
        if before != after:
            changed_schemes += 1
        scheme["connections"] = rebuilt_pages
        scheme["connection_count"] = len(rebuilt_pages)
        scheme["connection_options"] = flat
        scheme["connection_option_count"] = len(flat)

    stats = catalog.setdefault("stats", {})
    stats["connection_options"] = len(after_ids)
    counts = [item.get("connection_option_count", 0) for item in catalog.get("schemes") or []]
    stats["schemes_without_connection_options"] = sum(1 for count in counts if count == 0)
    stats["schemes_with_one_connection_option"] = sum(1 for count in counts if count == 1)
    stats["schemes_with_multiple_connection_options"] = sum(1 for count in counts if count > 1)
    stats["max_connection_options_per_scheme"] = max(counts, default=0)
    catalog["connection_refinement"] = {
        "tool": "tools/refine_connection_options.py",
        "changed_schemes": changed_schemes,
        "unique_options_before": len(before_ids),
        "unique_options_after": len(after_ids),
    }
    return catalog, catalog["connection_refinement"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path)
    parser.add_argument("source_root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    data = json.loads(args.catalog.read_text(encoding="utf-8"))
    refined, report = refine(data, args.source_root)
    output = args.output or args.catalog
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(refined, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
