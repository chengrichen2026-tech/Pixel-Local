#!/usr/bin/env python3
"""Render a local HTML infographic to a deterministic high-resolution PNG."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile


CHROME_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
)

DESIGN_WIDTH = 1536
SCALE = 1.0
FINAL_WIDTH = 1536


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def find_chrome(explicit: str | None) -> str:
    candidates = [explicit, os.environ.get("CHROME_BIN"), *CHROME_CANDIDATES]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise FileNotFoundError(
        "Chrome/Chromium was not found. Pass --chrome-bin or set CHROME_BIN."
    )


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a valid PNG: {path}")
    return struct.unpack(">II", header[16:24])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", required=True, help="Local HTML file")
    parser.add_argument("--output", required=True, help="Output PNG path")
    parser.add_argument("--height", type=positive_int, default=1536)
    parser.add_argument("--chrome-bin", help="Chrome or Chromium executable")
    args = parser.parse_args()

    html_path = Path(args.html).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not html_path.is_file():
        parser.error(f"HTML file does not exist: {html_path}")
    if html_path.suffix.lower() not in {".html", ".htm"}:
        parser.error("--html must point to an .html or .htm file")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    chrome = find_chrome(args.chrome_bin)

    with tempfile.TemporaryDirectory(prefix="doc-to-infographic-") as profile_dir:
        command = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            f"--user-data-dir={profile_dir}",
            f"--force-device-scale-factor={SCALE:g}",
            f"--window-size={DESIGN_WIDTH},{args.height}",
            f"--screenshot={output_path}",
            html_path.as_uri(),
        ]
        completed = subprocess.run(command, capture_output=True, text=True)
        if completed.returncode != 0:
            sys.stderr.write(completed.stdout)
            sys.stderr.write(completed.stderr)
            return completed.returncode

    if not output_path.is_file():
        raise RuntimeError(f"Chrome returned success but no PNG was created: {output_path}")

    actual_width, actual_height = png_dimensions(output_path)
    expected_width = FINAL_WIDTH
    expected_height = round(args.height * SCALE)
    if (actual_width, actual_height) != (expected_width, expected_height):
        raise RuntimeError(
            "unexpected PNG dimensions: "
            f"got {actual_width}x{actual_height}, "
            f"expected {expected_width}x{expected_height}"
        )

    print(
        json.dumps(
            {
                "created": True,
                "html": str(html_path),
                "output": str(output_path),
                "canvas": f"{DESIGN_WIDTH}x{args.height}",
                "scale": SCALE,
                "pixels": f"{actual_width}x{actual_height}",
                "bytes": output_path.stat().st_size,
                "chrome": chrome,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
