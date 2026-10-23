import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Document, Packer, UnderlineType } from "docx";
import { htmlToContent } from "docx/html";

import { resolveMarkdownImagePath } from "./image-path.ts";
import { markdownToHtml } from "./markdown-to-html.ts";
import { pythonExecutable } from "./python.ts";

const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 1440;
const CONTENT_WIDTH_PX = (PAGE_WIDTH - PAGE_MARGIN * 2) / 15;
const INSPECTOR_PATH = fileURLToPath(new URL("./images.py", import.meta.url));
const COLORS = {
  ink: "213247",
  accent: "166A73",
  muted: "5B6C7D",
  surface: "F3F7F8",
  line: "D9E3E8",
};

const STYLESHEET = `
  code, pre { font-family: Consolas; font-size: 9pt; background-color: #${COLORS.surface}; }
  pre { padding: 10pt 12pt; margin: 8pt 0 12pt; border: 0.5pt solid #${COLORS.surface}; }
  blockquote { margin: 10pt 0; padding-left: 12pt; border-left: 2pt solid #${COLORS.accent}; color: #${COLORS.muted}; }
  table { width: 100%; margin: 6pt 0 12pt; }
  tr { break-inside: avoid; }
  td, th { padding: 6pt 9pt; border-bottom: 0.5pt solid #${COLORS.line}; }
  td p, th p { margin: 0; }
  th { background-color: #${COLORS.surface}; color: #${COLORS.accent}; text-align: left; }
  hr { border-top: 0.5pt solid #${COLORS.line}; margin: 14pt 0; }
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
          run: { font: { ascii: "Noto Sans", hAnsi: "Noto Sans", eastAsia: "Noto Sans JP" }, size: 21, color: COLORS.ink },
          paragraph: { spacing: { before: 0, after: 140, line: 276 } },
        },
        ...Object.fromEntries(
          [[56, 0, 280], [30, 400, 160], [24, 280, 100], [21, 240, 80], [21, 240, 80], [21, 240, 80]].map(([size, before, after], index) => [
            `heading${index + 1}`, {
              run: { size, bold: true, color: index === 1 ? COLORS.accent : COLORS.ink },
              paragraph: { keepNext: true, keepLines: true, spacing: { before, after, line: 240 } },
            },
          ]),
        ),
        listParagraph: { paragraph: { spacing: { after: 60 } } },
        hyperlink: { run: { color: COLORS.accent, underline: { type: UnderlineType.SINGLE } } },
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
