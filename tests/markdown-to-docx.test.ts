import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DOMParser, onWarningStopParsing, type Document as XmlDocument, type Element } from "@xmldom/xmldom";
import JSZip from "jszip";

import { convertMarkdownToDocx, runCli } from "../scripts/markdown-to-docx.ts";
import { pythonExecutable } from "../scripts/python.ts";

const SKILL_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const CLI_PATH = path.join(SKILL_DIRECTORY, "scripts/markdown-to-docx.ts");
const IMAGES_PATH = path.join(SKILL_DIRECTORY, "scripts/images.py");
const RENDER_PATH = path.join(SKILL_DIRECTORY, "scripts/render-docx.py");
const VISUAL_FIXTURE = path.join(SKILL_DIRECTORY, "tests/fixtures/visual-fixture.md");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFAAH/VscvDQAAAABJRU5ErkJggg==", "base64",
);

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const root = process.platform === "win32" ? "C:/dev/tmp" : tmpdir();
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, "markdown-to-docx-test-"));
  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function xmlPart(zip: JSZip, name = "word/document.xml"): Promise<XmlDocument> {
  const part = zip.file(name);
  assert.ok(part, `Missing DOCX part: ${name}`);
  return new DOMParser({ onError: onWarningStopParsing }).parseFromString(await part.async("string"), "application/xml");
}

function elements(node: XmlDocument | Element, localName: string, namespace = W): Element[] {
  return Array.from(node.getElementsByTagNameNS(namespace, localName));
}

function photoTable(): string {
  return '<table><colgroup><col width="120"><col width="280"><col width="120"></colgroup><tbody>' +
    '<tr><th>Name</th><td>Sample Person</td><td rowspan="2" valign="top"><img src="seed.png" alt="証明写真" style="width:30mm;max-height:20mm"></td></tr>' +
    '<tr><th>Address</th><td>Sample address</td></tr><tr><th>Email</th><td colspan="2">sample@example.test</td></tr></tbody></table>';
}

function extractImages(input: string, directory: string) {
  return spawnSync(pythonExecutable, [IMAGES_PATH, "extract", input, directory], { encoding: "utf8", timeout: 120_000 });
}

test("conversion overwrites output without reading it or mutating Markdown", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  const source = "\uFEFF# Source of truth\r\n\r\nBody\r\n";
  writeFileSync(input, source);
  writeFileSync(output, "This is not a DOCX package.");
  await convertMarkdownToDocx(input, output);
  const zip = await JSZip.loadAsync(readFileSync(output), { checkCRC32: true });
  assert.equal(elements(await xmlPart(zip), "t").map((node) => node.textContent).join(""), "Source of truthBody");
  assert.equal(readFileSync(input, "utf8"), source);
  assert.deepEqual(readdirSync(directory).sort(), ["input.md", "output.docx"]);
}));

test("photo table text, structure and image removal can be regenerated at the same path", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "resume.md");
  const output = path.join(directory, "resume.docx");
  writeFileSync(path.join(directory, "seed.png"), ONE_PIXEL_PNG);
  writeFileSync(input, photoTable());
  await convertMarkdownToDocx(input, output);
  const edited = photoTable().replace("Sample Person", "Updated Person").replace("Sample address", "Updated address");
  writeFileSync(input, edited);
  await convertMarkdownToDocx(input, output);
  let document = await xmlPart(await JSZip.loadAsync(readFileSync(output)));
  assert.match(document.documentElement!.textContent!, /Updated Person.*Updated address/);
  assert.equal(elements(document, "drawing").length, 1);
  const removed = "# Resume\n\nThe photo table was deliberately removed.";
  writeFileSync(input, removed);
  await convertMarkdownToDocx(input, output);
  document = await xmlPart(await JSZip.loadAsync(readFileSync(output)));
  assert.equal(elements(document, "drawing").length, 0);
  assert.equal(elements(document, "tbl").length, 0);
  assert.equal(readFileSync(input, "utf8"), removed);
}));

test("deleted body images are not resurrected and image edits follow Markdown", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  const image = path.join(directory, "seed.png");
  writeFileSync(image, ONE_PIXEL_PNG);
  writeFileSync(input, "# Report\n\n![Before](seed.png)\n\nEnd");
  await convertMarkdownToDocx(input, output);
  const replacement = Buffer.concat([ONE_PIXEL_PNG, Buffer.from("replacement")]);
  writeFileSync(image, replacement);
  writeFileSync(input, "# Report\n\n![After](seed.png)\n\nEnd");
  await convertMarkdownToDocx(input, output);
  const zip = await JSZip.loadAsync(readFileSync(output), { checkCRC32: true });
  const media = zip.file(/^word\/media\/[^/]+\.png$/);
  assert.equal(media.length, 1);
  assert.deepEqual(await media[0]!.async("nodebuffer"), replacement);
  writeFileSync(input, "# Report\n\nEnd");
  const source = readFileSync(input);
  await convertMarkdownToDocx(input, output);
  assert.equal(elements(await xmlPart(await JSZip.loadAsync(readFileSync(output))), "drawing").length, 0);
  assert.deepEqual(readFileSync(input), source);
  assert.equal(existsSync(path.join(directory, "images")), false);
}));

test("Marked image syntax, escaped paths and references work end to end", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(path.join(directory, "photo(1).png"), ONE_PIXEL_PNG);
  writeFileSync(path.join(directory, "日本語 photo.png"), ONE_PIXEL_PNG);
  const absolute = path.join(directory, "photo(1).png").replaceAll("\\", "/");
  writeFileSync(input, [
    "![Portrait](photo(1).png)", "", "![証明写真][photo]", "",
    "[photo]: <日本語 photo.png>", "", `![Absolute](${absolute})`, "",
    "[Reference][ref]", "", "[ref]: https://example.test/path",
  ].join("\n"));
  await convertMarkdownToDocx(input, output);
  const zip = await JSZip.loadAsync(readFileSync(output));
  const document = await xmlPart(zip);
  assert.equal(elements(document, "drawing").length, 3);
  assert.deepEqual(elements(document, "docPr", WP).map((node) => node.getAttribute("descr")), ["Portrait", "証明写真", "Absolute"]);
  const ids = elements(document, "docPr", WP).map((node) => node.getAttribute("id"));
  assert.equal(new Set(ids).size, ids.length);
  const relationships = await xmlPart(zip, "word/_rels/document.xml.rels");
  assert.ok(elements(relationships, "Relationship", REL).some((node) => node.getAttribute("Target") === "https://example.test/path"));
}));

test("merged photo tables retain spans, aspect ratio, physical bounds and first-page body rows", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(path.join(directory, "seed.png"), ONE_PIXEL_PNG);
  writeFileSync(input, photoTable());
  await convertMarkdownToDocx(input, output);
  const zip = await JSZip.loadAsync(readFileSync(output), { checkCRC32: true });
  const document = await xmlPart(zip);
  assert.ok(elements(document, "gridSpan").some((node) => node.getAttributeNS(W, "val") === "2"));
  assert.ok(elements(document, "vMerge").some((node) => node.getAttributeNS(W, "val") === "restart"));
  assert.equal(elements(document, "vMerge").length, 2);
  assert.equal(elements(document, "tblHeader").length, 0);
  const extent = elements(document, "extent", WP)[0]!;
  // docx/html sizes images in whole CSS pixels, so allow one pixel of print-size rounding.
  assert.ok(Math.abs(Number(extent.getAttribute("cx")) - 720000) <= 9525);
  assert.equal(extent.getAttribute("cx"), extent.getAttribute("cy"));
  const imageCells = elements(document, "tc").filter((node) => elements(node, "drawing").length > 0);
  assert.equal(imageCells.length, 1);
  assert.equal(elements(imageCells[0]!, "vAlign")[0]!.getAttributeNS(W, "val"), "top");
}));

test("library-generated DOCX preserves formatting, table headers, lists and literal code", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(input, [
    "# Heading", "", "Normal **bold *nested italic* [link](https://example.test)** `C:\\temp\\file` ~~strike~~.", "",
    "3. First", "", "4. Second", "", "   - Child", "     - Grandchild", "",
    "| Key | Value |", "| --- | ---: |", "| a\\|b | **Bold cell** |", "",
    '<table><thead><tr><th colspan="2">Summary</th></tr></thead><tbody><tr><td rowspan="2"><strong>Area</strong></td><td>One<br>Two</td></tr><tr><td>Three</td></tr></tbody></table>', "",
    "```\n**literal** _identifier_ [label](https://example.test) C:\\temp\\file\n```",
  ].join("\n"));
  await convertMarkdownToDocx(input, output);
  const zip = await JSZip.loadAsync(readFileSync(output), { checkCRC32: true });
  const document = await xmlPart(zip);
  assert.equal(elements(document, "tbl").length, 2);
  assert.equal(elements(document, "tblHeader").length, 2);
  const italic = elements(document, "r").find((node) => node.textContent === "nested italic");
  assert.ok(italic);
  assert.equal(elements(italic, "b").length, 1);
  assert.equal(elements(italic, "i").length, 1);
  assert.equal(elements(document, "strike").length, 1);
  assert.ok(elements(document, "t").some((node) => node.textContent === "C:\\temp\\file"));
  assert.ok(elements(document, "t").some((node) => node.textContent?.includes("**literal** _identifier_ [label]")));
  const listParagraphs = elements(document, "p").filter((node) => elements(node, "numPr").length > 0);
  assert.equal(listParagraphs.length, 4);
  assert.deepEqual(listParagraphs.map((node) => elements(node, "ilvl")[0]!.getAttributeNS(W, "val")), ["0", "0", "1", "2"]);
  const numbering = await xmlPart(zip, "word/numbering.xml");
  assert.ok(elements(numbering, "start").some((node) => node.getAttributeNS(W, "val") === "3"));
}));

test("document design uses editable typography, one accent and open tables", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(input, [
    "# 文書タイトル", "", "通常の日本語と English, **強調** と [link](https://example.test).", "",
    "## Section", "", "### Detail", "", "#### Fourth", "", "##### Fifth", "", "###### Sixth", "",
    "| Item | State |", "| --- | --- |", "| Alpha | Done |", "",
    '<table><tbody><tr><th>Label</th><td colspan="2">Value</td></tr></tbody></table>', "",
    "> A quiet quotation", "", "```ts\nconst value = 1;\n```", "", "---",
  ].join("\n"));
  await convertMarkdownToDocx(input, output);
  const zip = await JSZip.loadAsync(readFileSync(output));
  const document = await xmlPart(zip);
  const styles = await xmlPart(zip, "word/styles.xml");
  const defaults = elements(styles, "docDefaults")[0]!;
  const fonts = elements(defaults, "rFonts")[0]!;
  assert.equal(elements(defaults, "sz")[0]!.getAttributeNS(W, "val"), "21");
  assert.equal(fonts.getAttributeNS(W, "ascii"), "Noto Sans");
  assert.equal(fonts.getAttributeNS(W, "hAnsi"), "Noto Sans");
  assert.equal(fonts.getAttributeNS(W, "eastAsia"), "Noto Sans JP");
  assert.equal(elements(defaults, "color")[0]!.getAttributeNS(W, "val"), "213247");
  const spacing = elements(defaults, "spacing")[0]!;
  assert.equal(spacing.getAttributeNS(W, "after"), "140");
  assert.equal(spacing.getAttributeNS(W, "line"), "276");
  let previousSize = Infinity;
  for (let level = 1; level <= 6; level++) {
    const id = `Heading${level}`;
    const style = elements(styles, "style").find((node) => node.getAttributeNS(W, "styleId") === id)!;
    const size = Number(elements(style, "sz")[0]!.getAttributeNS(W, "val"));
    assert.ok(size <= previousSize && size >= 21);
    previousSize = size;
    assert.equal(elements(style, "b").length, 1);
    assert.equal(elements(style, "color")[0]!.getAttributeNS(W, "val"), level === 2 ? "166A73" : "213247");
    assert.equal(elements(style, "i").length, 0);
    assert.equal(elements(style, "pBdr").length, 0);
    const paragraph = elements(document, "p").find((node) => elements(node, "pStyle").some((ref) => ref.getAttributeNS(W, "val") === id))!;
    for (const property of ["sz", "color", "rFonts", "pBdr"]) {
      assert.equal(elements(paragraph, property).length, 0, "Heading typography must stay editable through Word styles");
    }
  }
  const titleStyle = elements(styles, "style").find((node) => node.getAttributeNS(W, "styleId") === "Heading1")!;
  assert.equal(elements(titleStyle, "sz")[0]!.getAttributeNS(W, "val"), "56");
  const headers = elements(document, "tc").filter((cell) => ["Item", "State", "Label"].includes(cell.textContent ?? ""));
  assert.equal(headers.length, 3);
  for (const header of headers) {
    assert.equal(elements(header, "shd")[0]!.getAttributeNS(W, "fill"), "F3F7F8");
    assert.equal(elements(header, "color")[0]!.getAttributeNS(W, "val"), "166A73");
    assert.equal(elements(header, "jc")[0]!.getAttributeNS(W, "val"), "left");
  }
  for (const cell of elements(document, "tc")) {
    const borders = elements(cell, "tcBorders")[0]!;
    assert.ok(borders);
    const bottom = elements(borders, "bottom")[0]!;
    assert.equal(bottom.getAttributeNS(W, "val"), "single");
    assert.equal(bottom.getAttributeNS(W, "color"), "D9E3E8");
    assert.equal(bottom.getAttributeNS(W, "sz"), "4");
    for (const side of ["top", "left", "right"]) {
      assert.equal(elements(borders, side)[0]!.getAttributeNS(W, "val"), "none");
    }
  }
  const quotation = elements(document, "p").find((node) => node.textContent === "A quiet quotation")!;
  const quoteBorder = elements(elements(quotation, "pBdr")[0]!, "left")[0]!;
  assert.equal(quoteBorder.getAttributeNS(W, "color"), "166A73");
  assert.equal(quoteBorder.getAttributeNS(W, "sz"), "16");
  const code = elements(document, "p").find((node) => node.textContent === "const value = 1;")!;
  assert.equal(elements(code, "shd")[0]!.getAttributeNS(W, "fill"), "F3F7F8");
  const codeBorders = elements(code, "pBdr")[0]!;
  for (const side of ["top", "bottom", "left", "right"]) {
    const border = elements(codeBorders, side)[0]!;
    assert.equal(border.getAttributeNS(W, "color"), "F3F7F8");
    assert.equal(border.getAttributeNS(W, "space"), ["top", "bottom"].includes(side) ? "10" : "12");
  }
  const hyperlink = elements(styles, "style").find((node) => node.getAttributeNS(W, "styleId") === "Hyperlink")!;
  assert.equal(elements(hyperlink, "color")[0]!.getAttributeNS(W, "val"), "166A73");
  assert.equal(elements(hyperlink, "u").length, 1);
}));

test("quote and code borders align with the body edges", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(input, [
    "# Alignment", "", "Body with `inline code`.", "",
    "> Quote first paragraph", ">", "> Quote second paragraph", "",
    "```ts\nconst first = 1;\nconst second = 2;\n```",
  ].join("\n"));
  await convertMarkdownToDocx(input, output);
  const document = await xmlPart(await JSZip.loadAsync(readFileSync(output)));
  const paragraphs = elements(document, "p");
  const framed = paragraphs.filter((paragraph) => elements(paragraph, "pBdr").length > 0);
  assert.equal(framed.length, 3);
  for (const paragraph of framed) {
    const borders = elements(paragraph, "pBdr")[0]!;
    const indent = elements(paragraph, "ind")[0];
    assert.ok(indent, "Bordered paragraphs need an explicit text inset");
    for (const side of ["left", "right"]) {
      const border = elements(borders, side)[0];
      if (!border) continue;
      const inset = Number(border.getAttributeNS(W, "space")) * 20 + Number(border.getAttributeNS(W, "sz")) * 20 / 8;
      assert.equal(Number(indent.getAttributeNS(W, side)), inset, `${side} border must not hang outside the body edge`);
    }
  }
  for (const text of ["Alignment", "Body with inline code."]) {
    const paragraph = paragraphs.find((node) => node.textContent === text)!;
    assert.equal(elements(paragraph, "ind").length, 0);
    assert.equal(elements(paragraph, "pBdr").length, 0);
  }
}));

test("headings keep their lines and next block without changing body pagination", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(input, Array.from({ length: 6 }, (_, index) => `${"#".repeat(index + 1)} Heading ${index + 1}\n\nBody ${index + 1}\n`).join("\n"));
  await convertMarkdownToDocx(input, output);
  const zip = await JSZip.loadAsync(readFileSync(output));
  const document = await xmlPart(zip);
  const styles = await xmlPart(zip, "word/styles.xml");
  for (let level = 1; level <= 6; level++) {
    const id = `Heading${level}`;
    const heading = elements(document, "p").find((node) => node.textContent === `Heading ${level}`);
    assert.ok(heading);
    assert.equal(elements(heading, "pStyle")[0]!.getAttributeNS(W, "val"), id);
    const style = elements(styles, "style").find((node) => node.getAttributeNS(W, "styleId") === id);
    assert.ok(style);
    for (const property of ["keepNext", "keepLines"]) {
      const settings = elements(style, property);
      assert.equal(settings.length, 1, `${id} must set ${property}`);
      assert.ok(!["0", "false", "off"].includes(settings[0]!.getAttributeNS(W, "val") ?? ""));
    }
  }
  assert.equal(elements(elements(styles, "docDefaults")[0]!, "keepNext").length, 0);
  for (const body of elements(document, "p").filter((node) => node.textContent?.startsWith("Body "))) {
    assert.equal(elements(body, "keepNext").length, 0);
  }
}));

test("code appendix bookmarks, links and page breaks survive DOCX generation", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(input, "Intro\n\n```ts\nconst a = 1;\nconst b = 2;\n```");
  await convertMarkdownToDocx(input, output, { codeAppendixThreshold: 1 });
  const document = await xmlPart(await JSZip.loadAsync(readFileSync(output)));
  const anchor = elements(document, "hyperlink")[0]!.getAttributeNS(W, "anchor");
  assert.ok(anchor);
  assert.ok(elements(document, "bookmarkStart").some((node) => node.getAttributeNS(W, "name") === anchor));
  const appendix = elements(document, "p").find((node) => node.textContent === "Appendix");
  assert.ok(appendix);
  assert.equal(elements(appendix, "pageBreakBefore").length, 1);
  assert.match(document.documentElement!.textContent!, /Appendix 1.*Appendix.*const a = 1;/s);
}));

test("failures leave source and existing DOCX untouched, without staged files", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  const previous = Buffer.from("Previous output is never inspected.");
  writeFileSync(output, previous);
  const corrupt = Buffer.from(ONE_PIXEL_PNG);
  corrupt[29] = corrupt[29]! ^ 1;
  writeFileSync(path.join(directory, "bad.png"), corrupt);
  for (const [source, error] of [
    ["![Missing](missing.png)", /does not exist/],
    ["![Remote](https://example.test/photo.png)", /Remote and data/],
    ["![Invalid](bad.png)", /Unable to validate PNG/],
    ["![Unsupported](photo.jpg)", /Only PNG/],
    ['[Unsafe](javascript:alert(1))', /unsafe-link/],
    ['<video src="video.mp4"></video>', /unsupported-element/],
  ] as const) {
    writeFileSync(input, source);
    await assert.rejects(convertMarkdownToDocx(input, output), error);
    assert.equal(readFileSync(input, "utf8"), source);
    assert.deepEqual(readFileSync(output), previous);
    assert.deepEqual(readdirSync(directory).sort(), ["bad.png", "input.md", "output.docx"]);
  }
  const invalidUtf8 = Buffer.from([0xc3, 0x28]);
  writeFileSync(input, invalidUtf8);
  await assert.rejects(convertMarkdownToDocx(input, output), /encoded data/);
  assert.deepEqual(readFileSync(input), invalidUtf8);
  assert.deepEqual(readFileSync(output), previous);
}));

test("paths and options are validated before writing outputs", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(input, "Body");
  await assert.rejects(convertMarkdownToDocx(input + ".txt", output), /Markdown input/);
  await assert.rejects(convertMarkdownToDocx(input, output + ".txt"), /DOCX output/);
  await assert.rejects(convertMarkdownToDocx(path.join(directory, "missing.md"), output), /does not exist/);
  await assert.rejects(convertMarkdownToDocx(input, path.join(directory, "missing/out.docx")), /directory does not exist/);
  mkdirSync(output);
  await assert.rejects(convertMarkdownToDocx(input, output), /not a file/);
  rmSync(output, { recursive: true });
  for (const codeAppendixThreshold of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(convertMarkdownToDocx(input, output, { codeAppendixThreshold }), /positive integer/);
  }
  assert.equal(existsSync(output), false);
}));

test("explicit extraction exports body and table photos without modifying documents", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "日本語.md");
  const output = path.join(directory, "日本語.docx");
  const images = path.join(directory, "画像");
  mkdirSync(images);
  writeFileSync(path.join(directory, "seed.png"), ONE_PIXEL_PNG);
  const source = photoTable() + "\n\n![Repeated](seed.png)\n\nText with ![Inline](seed.png) inline.";
  writeFileSync(input, source);
  await convertMarkdownToDocx(input, output);
  const originalDocx = readFileSync(output);
  const extracted = extractImages(output, images);
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.equal(extracted.stderr, "");
  const records = JSON.parse(extracted.stdout).images as Array<{ path: string; alt: string }>;
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record.alt), ["証明写真", "Repeated", "Inline"]);
  assert.equal(new Set(records.map((record) => record.path)).size, 1);
  assert.deepEqual(readFileSync(records[0]!.path), ONE_PIXEL_PNG);
  assert.equal(readdirSync(images).length, 1);
  assert.equal(readFileSync(input, "utf8"), source);
  assert.deepEqual(readFileSync(output), originalDocx);
  assert.equal(extractImages(output, images).status, 0);
  assert.equal(readdirSync(images).length, 1);
}));

test("explicit extraction normalizes embedded JPEGs to content-addressed PNGs", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  const images = path.join(directory, "images");
  mkdirSync(images);
  writeFileSync(path.join(directory, "seed.png"), ONE_PIXEL_PNG);
  writeFileSync(input, "![Photo](seed.png)");
  await convertMarkdownToDocx(input, output);
  const encoded = spawnSync(pythonExecutable, ["-c", "import io,sys; from PIL import Image; Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB').save(sys.stdout.buffer,format='JPEG')"], { input: ONE_PIXEL_PNG });
  assert.equal(encoded.status, 0, encoded.stderr.toString());
  const zip = await JSZip.loadAsync(readFileSync(output));
  const media = zip.file(/^word\/media\/[^/]+\.png$/)[0]!;
  const jpegName = "word/media/photo name.jpeg";
  zip.remove(media.name);
  zip.file(jpegName, encoded.stdout);
  const rels = zip.file("word/_rels/document.xml.rels")!;
  zip.file(rels.name, (await rels.async("string")).replace(path.posix.basename(media.name), encodeURIComponent(path.posix.basename(jpegName))));
  const contentTypes = zip.file("[Content_Types].xml")!;
  zip.file(contentTypes.name, (await contentTypes.async("string")).replace("</Types>", '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>'));
  writeFileSync(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  const extracted = extractImages(output, images);
  assert.equal(extracted.status, 0, extracted.stderr);
  const pngPath = JSON.parse(extracted.stdout).images[0].path as string;
  const png = readFileSync(pngPath);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(path.basename(pngPath), createHash("sha256").update(png).digest("hex") + ".png");
  assert.notDeepEqual(png, encoded.stdout);
}));

test("extraction validates every image before writing and rejects unsafe relationships", () => withTempDirectory(async (directory) => {
  const output = path.join(directory, "input.docx");
  const images = path.join(directory, "images");
  mkdirSync(images);
  const document = `<w:document xmlns:w="${W}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:drawing><a:blip r:embed="rId1"/><a:blip r:embed="rId2"/></w:drawing></w:r></w:p></w:body></w:document>`;
  for (const relationship of [
    '<Relationship Id="rId2" Type="image/image" Target="media/bad.png"/>',
    '<Relationship Id="rId2" Type="image/image" Target="https://example.test/photo.png" TargetMode="External"/>',
    '<Relationship Id="rId2" Type="image/image" Target="../../escape.png"/>',
    '<Relationship Id="rId2" Type="image/image" Target="%2e%2e/%2e%2e/escape.png"/>',
    "",
  ]) {
    const zip = new JSZip();
    zip.file("word/document.xml", document);
    zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="image/image" Target="media/good.png"/>${relationship}</Relationships>`);
    zip.file("word/media/good.png", ONE_PIXEL_PNG);
    zip.file("word/media/bad.png", "Invalid PNG");
    writeFileSync(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    const extracted = extractImages(output, images);
    assert.equal(extracted.status, 1, extracted.stdout);
    assert.notEqual(extracted.stderr.trim(), "");
    assert.deepEqual(readdirSync(images), []);
  }
}));

test("extraction conflicts and invalid paths leave existing image files untouched", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  const images = path.join(directory, "images");
  mkdirSync(images);
  writeFileSync(path.join(directory, "seed.png"), ONE_PIXEL_PNG);
  writeFileSync(input, "![Photo](seed.png)");
  await convertMarkdownToDocx(input, output);
  const conflict = path.join(images, createHash("sha256").update(ONE_PIXEL_PNG).digest("hex") + ".png");
  writeFileSync(conflict, "Keep existing file");
  assert.equal(extractImages(output, images).status, 1);
  assert.equal(readFileSync(conflict, "utf8"), "Keep existing file");
  assert.equal(extractImages(output, path.join(directory, "missing")).status, 1);
  assert.equal(extractImages(input, images).status, 1);
  assert.equal(readdirSync(images).length, 1);
}));

test("CLI converts files, reports failures and validates thresholds", () => withTempDirectory(async (directory) => {
  const input = path.join(directory, "input.md");
  const output = path.join(directory, "output.docx");
  writeFileSync(input, "# CLI\n\nBody");
  const success = spawnSync(process.execPath, [CLI_PATH, input, output, "--code-appendix-threshold", "5"], { cwd: directory, encoding: "utf8" });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /Converted:/);
  await JSZip.loadAsync(readFileSync(output), { checkCRC32: true });
  const failure = spawnSync(process.execPath, [CLI_PATH, input], { encoding: "utf8" });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Exactly one input path and one output path/);
  const help = spawnSync(process.execPath, [CLI_PATH, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
  for (const value of ["no", "0", "1.5", "9007199254740992"]) {
    await assert.rejects(runCli([input, output, "--code-appendix-threshold", value]), /positive integer/);
  }
}));

test("black-box renderer returns JSON with one existing PNG per page", { timeout: 120_000 }, () => withTempDirectory(async (directory) => {
  const localized = path.join(directory, "日本語");
  mkdirSync(localized);
  const output = path.join(localized, "render.docx");
  await convertMarkdownToDocx(VISUAL_FIXTURE, output, { codeAppendixThreshold: 5 });
  const rendered = spawnSync(pythonExecutable, [RENDER_PATH, output], { cwd: SKILL_DIRECTORY, encoding: "utf8", timeout: 120_000 });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stderr.trim(), "");
  const result = JSON.parse(rendered.stdout) as { output_directory: string; page_count: number; pages: string[] };
  try {
    assert.equal(result.page_count, result.pages.length);
    assert.ok(result.page_count > 0);
    for (const page of result.pages) {
      assert.equal(readFileSync(page).subarray(1, 4).toString("ascii"), "PNG");
    }
  } finally {
    rmSync(result.output_directory, { recursive: true, force: true });
  }
}));
