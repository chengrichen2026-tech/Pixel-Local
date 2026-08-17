# Interactive HTML and JPG export workflow

Read this only when modifying or troubleshooting the editor/export shell. Content-only artifacts should use the builder and fast QA without loading this reference.

## Stable package contract

```text
infographic-output/
├── content-outline.json
├── index.html
├── required-text.txt
├── vendor/
│   └── html2canvas.min.js
└── final-<width>x<height>.jpg
```

The browser editor must work without a network connection. Keep `html2canvas 1.4.1` beside the HTML. A saved HTML copy records the live vendor script as an absolute local URL so it can export elsewhere on the same machine.

## Stable editor/export contract

- Keep the layout canvas at `1536px` CSS width and derive its height from content.
- Keep intended copy in editable DOM nodes with stable field identifiers and `localStorage` autosave.
- Retain edit/preview mode, ordinary scrolling, Space-drag panning, 25%–200% zoom, fit view, and 100% view.
- Retain save-as-HTML, JPG width `512–8192px`, quality `70–100%`, calculated output dimensions, and opaque JPEG output.
- Temporarily render at 100%, then restore zoom and scroll.
- Default the final export to `3072px` width, calculated height, `95%` quality, and an opaque paper background.

## Fast per-artifact QA

Run once after the layout is selected:

```bash
node scripts/qa_infographic.mjs \
  --mode fast \
  --html <path/to/index.html> \
  --qa-png <path/to/qa.png> \
  --output-jpg <path/to/final.jpg> \
  --width 3072 \
  --quality 95
```

Fast QA checks the 1536px base canvas, optionally captures one native-width PNG, performs one browser JPG export, and verifies the JPEG signature and exact dimensions. Do not add a second export for content-only changes.

## Full template regression

Run only after changing template CSS, editor/export JavaScript, `html2canvas`, browser/machine environment, or after a related fast-QA failure:

```bash
node scripts/qa_infographic.mjs \
  --mode full \
  --html <path/to/index.html> \
  --output-jpg <path/to/final.jpg> \
  --saved-html <path/to/qa/saved-copy.html> \
  --second-jpg <path/to/qa/saved-copy.jpg>
```

Full regression additionally verifies fit and 100% views, horizontal/vertical scrolling, live editing and autosave, preview mode, save-as-HTML fallback, absolute local vendor resolution, and a second differently sized JPG export.

## Known failure modes

- `foreignObject → Canvas` can taint a canvas under `file://`; keep the bundled DOM renderer.
- Exporting while the display canvas is scaled can produce blank output; render at 100% and restore state afterward.
- Relative vendor paths break when a saved HTML file moves; preserve the live absolute local URL in saved copies.
- In headless QA, disable `showSaveFilePicker` before testing the ordinary download fallback.
- If Chrome writes an image but does not exit, inspect inherited updater subprocess pipes before assuming rendering failed.
- Long images can look soft when scaled down. Inspect the selected result both at 100% and as a full-image preview.
