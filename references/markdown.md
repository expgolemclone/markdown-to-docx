# Markdown authoring and verification

## Authoring

Use ordinary Markdown where possible; reserve HTML tables for merged cells or photo placement. Use the CLI's validation errors rather than maintaining a separate catalog of accepted syntax, formatting constants, or DOCX internals here. Runtime setup follows the envx repository's `RULES.md` and `runtimes/README.md`.

Keep images as local PNGs referenced relative to the Markdown file or by absolute path:

```markdown
![Architecture diagram](images/architecture.png)
```

## Merged tables

Set column widths and express merged regions with `rowspan` and `colspan`:

```html
<table style="break-inside:avoid">
  <colgroup><col width="120"><col width="260"><col width="100"></colgroup>
  <thead><tr><th colspan="2">Summary</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td rowspan="2">Area A</td><td>Task 1</td><td>Done</td></tr>
    <tr><td>Task 2</td><td>Open</td></tr>
  </tbody>
</table>
```

## Resume photo layout

Keep the title and date above the personal-information table. Put the portrait in its top-right body cell, spanning the short identity/address rows. Let long contact values span the remaining columns.

```html
<table style="break-inside:avoid">
  <colgroup><col width="120"><col width="280"><col width="120"></colgroup>
  <tbody>
    <tr><th>Name</th><td>Sample Person</td><td rowspan="2" valign="top"><img src="images/portrait.png" alt="Portrait" style="width:30mm;height:40mm"></td></tr>
    <tr><th>Address</th><td>Sample address</td></tr>
    <tr><th>Email</th><td colspan="2">sample@example.test</td></tr>
  </tbody>
</table>
```

Use `tbody` for a first-page-only photo. Move an existing standalone portrait into the cell instead of retaining both occurrences. Leave room for cell padding and check source resolution for the requested print size; do not generate, stretch, or retouch the portrait.

When intentionally restructuring or removing a photo table from an existing DOCX, choose a new output DOCX path. Do not bypass an ambiguous image-import error or guess where an image belongs.

## Verification

Confirm successful conversion and rendering. Read the renderer's JSON and confirm `page_count` equals the number of `pages`. Inspect every rendered PNG at 100 percent for clipping, list alignment, cell borders, merged cells, image scaling, fonts, and page breaks. For resumes, check that the photo appears once in the upper-right personal-information area, contact text is readable, and no image/text overlaps occur.

Use the bundled tests for parser and DOCX structure checks instead of manually repeating their XML assertions. Rendered inspection remains necessary for the actual document. Do not report completion until it passes.
