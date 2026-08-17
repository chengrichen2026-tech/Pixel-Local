#!/usr/bin/env python3
"""Verify that required phrases exist in visible HTML text."""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
from pathlib import Path
import re


def normalize(value: str) -> str:
    return re.sub(r"\s+", "", value)


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._ignored_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()

    html_path = Path(args.html).expanduser().resolve()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not html_path.is_file():
        parser.error(f"HTML file does not exist: {html_path}")
    if not manifest_path.is_file():
        parser.error(f"manifest does not exist: {manifest_path}")

    extractor = VisibleTextParser()
    extractor.feed(html_path.read_text(encoding="utf-8"))
    visible_text = normalize(" ".join(extractor.parts))
    required = [
        line.strip()
        for line in manifest_path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    missing = [phrase for phrase in required if normalize(phrase) not in visible_text]

    if missing:
        print("TEXT_MANIFEST_FAILED")
        for phrase in missing:
            print(f"MISSING: {phrase}")
        return 1

    print(f"TEXT_MANIFEST_OK required={len(required)} missing=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
