import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Document, Packer } from "docx";
import { htmlToContent } from "docx/html";

import { resolveMarkdownImagePath } from "./image-path.ts";
import { markdownToHtml } from "./markdown-to-html.ts";
import { pythonExecutable } from "./python.ts";

const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 1440;
const CONTENT_WIDTH_PX = (PAGE_WIDTH - PAGE_MARGIN * 2) / 15;
const INSPECTOR_PATH = fileURLToPath(new URL("./images.py", import.meta.url));

const STYLESHEET = `
  p { margin: 0 0 4pt; }
  h1 { font-size: 20pt; color: #1F2328; border-bottom: 1px solid #0969DA; }
  h2 { font-size: 16pt; color: #0969DA; border-bottom: 1px solid #D1D9E0; }
  h3 { font-size: 13pt; }
  h4, h5, h6 { font-size: 11.5pt; }
  code, pre { font-family: Consolas; font-size: 9.5pt; background-color: #F6F8FA; }
  pre { padding: 6pt; border-left: 3px solid #0969DA; }
  blockquote { margin-left: 13pt; padding-left: 8pt; border-left: 3px solid #D1D9E0; color: #656D76; }
  table { width: 100%; }
  tr { break-inside: avoid; }
  td, th { padding: 4pt 6pt; }
  th { background-color: #EAF2FB; }
  img { max-height: ${(PAGE_HEIGHT - PAGE_MARGIN * 2 - 720) / 15}px; }
  p:has(> img:only-child) { text-align: center; }
`;

export async function convertMarkdownToDocx(
  inputPath: string,
  outputPath: string,
  options: { codeAppendixThreshold?: number } = {},
): Promise<void> {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  if (![".md", ".markdown"].includes(path.extname(input).toLowerCase())) {
    throw new Error(`Markdown input must use the .md or .markdown extension: ${input}`);
  }
  if (path.extname(output).toLowerCase() !== ".docx") {
    throw new Error(`DOCX output must use the .docx extension: ${output}`);
  }
  if (!existsSync(input) || !statSync(input).isFile()) {
    throw new Error(`Markdown input does not exist or is not a file: ${input}`);
  }
  const outputDirectory = path.dirname(output);
  if (!existsSync(outputDirectory) || !statSync(outputDirectory).isDirectory()) {
    throw new Error(`DOCX output directory does not exist: ${outputDirectory}`);
  }
  if (existsSync(output) && !statSync(output).isFile()) {
    throw new Error(`DOCX output path is not a file: ${output}`);
  }

  const markdown = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(input));
  const html = markdownToHtml(markdown, options.codeAppendixThreshold);
  const images = new Map<string, Buffer>();
  const children = htmlToContent(html, {
    stylesheet: STYLESHEET,
    maxImageWidth: CONTENT_WIDTH_PX,
    images(source) {
      const imagePath = resolveMarkdownImagePath(decodeURIComponent(source), path.dirname(input));
      const cached = images.get(imagePath);
      if (cached) return cached;
      const data = readFileSync(imagePath);
      const inspected = spawnSync(pythonExecutable, [INSPECTOR_PATH, "inspect"], {
        input: data, encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true,
      });
      if (inspected.error) throw new Error(`Unable to validate PNG ${imagePath}: ${inspected.error.message}`);
      if (inspected.status !== 0 || inspected.stderr.trim() !== "") {
        throw new Error(`Unable to validate PNG ${imagePath}: ${inspected.stderr.trim()}`);
      }
      images.set(imagePath, data);
      return data;
    },
    onWarning(warning) {
      throw new Error(`DOCX conversion would lose content (${warning.code}): ${warning.message}`);
    },
  });
  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: { ascii: "Segoe UI", hAnsi: "Segoe UI", eastAsia: "Yu Gothic UI" }, size: 21, color: "1F2328" },
          paragraph: { spacing: { line: 312 } },
        },
        listParagraph: { paragraph: { spacing: { after: 40 } } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
        },
      },
      children,
    }],
  });
  const data = await Packer.toBuffer(document);
  const temporary = path.join(outputDirectory, `.${path.basename(output)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, data, { flag: "wx" });
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "code-appendix-threshold": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help) {
    console.log("Usage: node scripts/markdown-to-docx.ts <input.md> <output.docx> [--code-appendix-threshold N]");
    return;
  }
  if (parsed.positionals.length !== 2) {
    throw new Error("Exactly one input path and one output path are required. Use --help for usage.");
  }
  const threshold = parsed.values["code-appendix-threshold"];
  if (threshold !== undefined && !/^\d+$/.test(threshold)) {
    throw new RangeError("--code-appendix-threshold must be a positive integer.");
  }
  await convertMarkdownToDocx(parsed.positionals[0]!, parsed.positionals[1]!, {
    codeAppendixThreshold: threshold === undefined ? undefined : Number(threshold),
  });
  console.log(`Converted: ${path.resolve(parsed.positionals[0]!)} -> ${path.resolve(parsed.positionals[1]!)}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
