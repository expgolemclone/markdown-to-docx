#!/usr/bin/env python3
"""Validate PNG bytes from stdin and return their decoded dimensions."""

from __future__ import annotations

import io
import json
import sys

from PIL import Image


def inspect_png(data: bytes) -> dict[str, int]:
    with Image.open(io.BytesIO(data)) as image:
        if image.format != "PNG" or getattr(image, "n_frames", 1) != 1:
            raise ValueError("A single-frame PNG is required.")
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        width, height = image.size
    return {"widthPx": width, "heightPx": height}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        result = inspect_png(sys.stdin.buffer.read())
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
