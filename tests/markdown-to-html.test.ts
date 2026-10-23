import assert from "node:assert/strict";
import test from "node:test";

import { markdownToHtml } from "../scripts/markdown-to-html.ts";

test("one Marked document resolves reference links and parenthesized image paths", () => {
  const html = markdownToHtml([
    "![Portrait](images/photo(1).png)", "", "[Reference][ref]", "",
    "[ref]: https://example.test/path", "", "![Photo][photo]", "",
    "[photo]: <images/日本語 photo.png>",
  ].join("\n"));
  assert.match(html, /<img src="images\/photo\(1\).png" alt="Portrait">/);
  assert.match(html, /<a href="https:\/\/example.test\/path">Reference<\/a>/);
  assert.match(html, /src="images\/%E6%97%A5%E6%9C%AC%E8%AA%9E%20photo.png"/);
  assert.doesNotMatch(html, /\[ref\]:|\[photo\]:/);
});

test("standard Markdown retains nested emphasis, literal code and hard line breaks", () => {
  const html = markdownToHtml("Title\n=====\n\n**bold *italic* `C:\\temp\\file`**  \nnext\n\n> Quote\n\n---");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold <em>italic<\/em> <code>C:\\temp\\file<\/code><\/strong><br>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<hr>/);
});

test("loose lists, continuation paragraphs and nested lists follow Marked's grammar", () => {
  const html = markdownToHtml("3. First\n\n4. Second\n\n   Continuation\n\n   - Child\n   - [x] Done");
  assert.match(html, /<ol start="3">/);
  assert.equal((html.match(/<ol\b/g) ?? []).length, 1);
  assert.match(html, /<p>Continuation<\/p>\n<ul>/);
  assert.match(html, /<input checked="" disabled="" type="checkbox">/);
});

test("pipe tables and standard HTML tables use library parsers, not a second grammar", () => {
  const html = markdownToHtml([
    "| Value | Code |", "| --- | ---: |", "| a\\|b | `code` |", "",
    '<table><tr><th colspan="2">Summary</th></tr><tr><td rowspan="2"><strong>Area</strong></td><td>One</td></tr><tr><td>Two</td></tr></table>',
  ].join("\n"));
  assert.equal((html.match(/<table>/g) ?? []).length, 2);
  assert.match(html, /a\|b/);
  assert.match(html, /<td align="right"><code>code<\/code>/);
  assert.match(html, /rowspan="2"><strong>Area<\/strong>/);
});

test("code appendices are opt-in, linked, escaped and isolated per conversion", () => {
  const source = "Intro\n\n```ts\nconst x = '<tag>';\nconst y = 2;\n```\n\n~~~\nshort\n~~~";
  const original = markdownToHtml(source);
  assert.doesNotMatch(original, /Appendix|pagebreak/);
  const html = markdownToHtml(source, 1);
  assert.match(html, /href="#appendix-code-1">Appendix 1/);
  assert.match(html, /<!-- pagebreak -->/);
  assert.match(html, /<h3 id="appendix-code-1">Appendix 1<\/h3>/);
  assert.match(html, /&lt;tag&gt;/);
  assert.ok(html.indexOf("short") < html.indexOf("<h2>Appendix"));
  assert.equal(markdownToHtml(source), original);
  assert.doesNotMatch(markdownToHtml("    a\n    b", 1), /Appendix/);
});

test("appendix links remain unique beyond 26 code blocks", () => {
  const source = Array.from({ length: 28 }, () => "```\na\nb\n```").join("\n\n");
  const html = markdownToHtml(source, 1);
  assert.match(html, /href="#appendix-code-28">Appendix 28/);
  assert.equal((html.match(/<h3 id=/g) ?? []).length, 28);
});

test("invalid appendix thresholds are rejected", () => {
  for (const threshold of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => markdownToHtml("Text", threshold), /positive integer/);
  }
});
