---
name: markdown-to-docx
description: Create or update verified Word DOCX reports and resumes from Markdown, with merged tables, nested lists, Word-pasted images, and upper-right portrait cells.
---

# Markdown to DOCX

Use the bundled CLIs, not manual document reconstruction.

1. Read [Markdown authoring and verification](references/markdown.md) completely.
2. Confirm the requested document and inspect its complete Markdown source and referenced PNGs. Choose absolute input/output paths and an existing output directory. For a resume portrait, follow the reference's [photo-cell layout](references/markdown.md#resume-photo-layout).
3. Run from this skill directory:

```powershell
npm ci
uv sync --locked
node scripts/markdown-to-docx.ts C:\path\input.md C:\path\output.docx
uv run --locked python scripts/render-docx.py C:\path\output.docx
```

Existing output DOCX files are inspected first: missing body images are imported into Markdown before regeneration. Declared table-photo cells are verified and regenerated from Markdown; unknown DOCX-only table photos are rejected. Markdown text remains authoritative. Ambiguous or unsupported imports fail without changing the source or existing DOCX.

Add `--code-appendix-threshold N` only to move code blocks longer than `N` lines into linked appendices.

4. Follow the reference's verification checklist. Treat the renderer as a black box; inspect its implementation only if it fails.
