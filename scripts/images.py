#!/usr/bin/env python3
"""Validate local PNGs or explicitly export embedded DOCX body images."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import posixpath
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from PIL import Image, ImageOps

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
V = "urn:schemas-microsoft-com:vml"


def read_image(data: bytes, png_only: bool = False) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(data)) as image:
        if png_only and image.format != "PNG":
            raise ValueError("A PNG image is required.")
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError("Animated or multi-frame images are not supported.")
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        if image.format == "PNG":
            return data, image.width, image.height
        transposed = ImageOps.exif_transpose(image)
        has_alpha = transposed.mode in {"RGBA", "LA"} or "transparency" in transposed.info
        converted = transposed.convert("RGBA" if has_alpha else "RGB")
        output = io.BytesIO()
        converted.save(output, format="PNG")
        return output.getvalue(), converted.width, converted.height


def extract_images(input_path: Path, output_directory: Path) -> dict[str, object]:
    if input_path.suffix.lower() != ".docx" or not input_path.is_file():
        raise ValueError(f"DOCX input must be an existing .docx file: {input_path}")
    if not output_directory.is_dir():
        raise ValueError(f"Image output directory must already exist: {output_directory}")
    images: list[dict[str, str]] = []
    files: dict[Path, bytes] = {}
    with zipfile.ZipFile(input_path) as package:
        document = ET.fromstring(package.read("word/document.xml"))
        relationships = ET.fromstring(package.read("word/_rels/document.xml.rels"))
        targets = {entry.get("Id"): entry for entry in relationships.findall(f"{{{REL}}}Relationship")}
        body = document.find(f"{{{W}}}body")
        if body is None:
            raise ValueError("DOCX document does not contain a body.")
        descriptions: dict[ET.Element, str] = {}
        for drawing in body.iter(f"{{{W}}}drawing"):
            properties = drawing.find(f".//{{{WP}}}docPr")
            alt = properties.get("descr", "") if properties is not None else ""
            for blip in drawing.iter(f"{{{A}}}blip"):
                descriptions[blip] = alt
        for node in body.iter():
            if node.tag == f"{{{A}}}blip":
                identifier = node.get(f"{{{R}}}embed") or node.get(f"{{{R}}}link")
                alt = descriptions.get(node, "")
            elif node.tag == f"{{{V}}}imagedata":
                identifier = node.get(f"{{{R}}}id")
                alt = node.get("title", "")
            else:
                continue
            relationship = targets.get(identifier)
            if relationship is None:
                raise ValueError(f"Missing DOCX image relationship: {identifier}")
            if (relationship.get("TargetMode", "").lower() == "external"
                    or not relationship.get("Type", "").endswith("/image")):
                raise ValueError(f"An embedded raster image is required: {identifier}")
            target = unquote(relationship.get("Target", ""))
            entry = posixpath.normpath(target.lstrip("/") if target.startswith("/")
                                      else posixpath.join("word", target))
            if entry == ".." or entry.startswith("../"):
                raise ValueError(f"Image relationship escapes the DOCX package: {target}")
            png, _, _ = read_image(package.read(entry))
            destination = output_directory / f"{hashlib.sha256(png).hexdigest()}.png"
            files[destination] = png
            images.append({"path": destination.as_posix(), "alt": alt})

    for destination, data in files.items():
        if destination.exists() and (not destination.is_file() or destination.read_bytes() != data):
            raise ValueError(f"Existing image conflicts with DOCX content: {destination}")
    created: list[Path] = []
    try:
        for destination, data in files.items():
            if not destination.exists():
                with destination.open("xb") as stream:
                    created.append(destination)
                    stream.write(data)
    except OSError:
        for destination in created:
            destination.unlink()
        raise
    return {"images": images}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("inspect", help="Validate PNG bytes from stdin and print their dimensions.")
    extract = commands.add_parser("extract", help="Export DOCX body images to an existing directory.")
    extract.add_argument("input_docx", type=Path)
    extract.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            _, width, height = read_image(sys.stdin.buffer.read(), png_only=True)
            result = {"widthPx": width, "heightPx": height}
        else:
            result = extract_images(args.input_docx.resolve(), args.output_directory.resolve())
    except (OSError, ValueError, SyntaxError, KeyError, ET.ParseError,
            zipfile.BadZipFile, Image.DecompressionBombError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
