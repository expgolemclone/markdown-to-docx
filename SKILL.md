---
name: markdown-to-docx
description: Create or update verified Word DOCX reports and resumes from Markdown, with merged tables, nested lists, Word-pasted images, and upper-right portrait cells.
---

# Markdown to DOCX

Use the bundled CLIs, not manual document reconstruction.

1. Read [Markdown authoring and verification](references/markdown.md) completely.
2. Confirm the requested document and inspect its complete Markdown source and referenced PNGs. Choose absolute input/output paths and an existing output directory. For a resume portrait, follow the reference's [photo-cell layout](references/markdown.md#resume-photo-layout).
3. Markdown and its referenced images are authoritative. Conversion replaces existing DOCX files without reading them and never edits Markdown. To preserve Word-pasted images, first export them with `uv run --locked --python (mise which python) python scripts/images.py extract C:\path\existing.docx C:\path\images`, using an existing image directory. Inspect the returned paths and alt text, and place the references in Markdown yourself.

Run from this skill directory:

```powershell
mise install
mise exec -- npm ci
uv sync --locked --python (mise which python)
mise exec -- node scripts/markdown-to-docx.ts C:\path\input.md C:\path\output.docx
uv run --locked --python (mise which python) python scripts/render-docx.py C:\path\output.docx
```

Add `--code-appendix-threshold N` only to move code blocks longer than `N` lines into linked appendices.

4. Follow the reference's verification checklist. Treat the renderer as a black box; inspect its implementation only if it fails.
