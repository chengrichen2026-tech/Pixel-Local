---
name: doc-to-infographic
description: "Convert information documents, reports, SOPs, research notes, meeting summaries, tutorials, or workflows into polished interactive infographics. Use when the user asks for an information graphic, information card, long image, process diagram, visual summary, or shareable Chinese poster. Default to the modern editorial-paper visual system and deliver editable HTML with live text editing, pan/zoom, local autosave, save-as-HTML, and configurable-width JPG export. Keep real copy in HTML/CSS DOM text; use Image 2 only for optional visual references."
---

# Document to Infographic

Turn source information into a reusable visual artifact without sacrificing factual accuracy, editable text, or delivery clarity.

## Default fast workflow

1. Read the source completely. Preserve it and identify whether it is raw material, an extraction, or an approved conclusion.
2. Write the content outline once. Separate facts, quotations, inferences, recommendations, actions, evidence, and boundaries. For dense or ambiguous material, use the executable schema in `references/content-contract.md`.
3. Choose the smallest readable format: one portrait card for compact material, numbered cards when one page would force tiny text, and landscape only for inherently horizontal relationships.
4. Reuse the bundled editorial template when the user supplies no visual direction. Do not reread the default style reference or invoke Image 2 for routine default-style work.
5. Generate the editable package from the outline instead of rewriting the full template:

```bash
python3 scripts/build_infographic.py \
  --outline <path/to/content-outline.json> \
  --output-dir <path/to/output-directory>
```

The builder creates `index.html`, `required-text.txt`, and the local `vendor/` dependency from one content source. For a custom layout, copy the template package and edit only the content/layout region; retain the existing editor and export shell.

6. Iterate with a native-width PNG. Do not generate high-resolution JPG drafts:

```bash
python3 scripts/render_infographic.py \
  --html <path/to/index.html> \
  --output <path/to/qa.png> \
  --height <base-canvas-height>
```

7. Validate required DOM copy, then run the fast browser QA once to create the selected JPG:

```bash
python3 scripts/validate_text_manifest.py \
  --html <path/to/index.html> \
  --manifest <path/to/required-text.txt>

node scripts/qa_infographic.mjs \
  --mode fast \
  --html <path/to/index.html> \
  --output-jpg <path/to/final.jpg> \
  --width 3072 \
  --quality 95
```

8. Inspect only the selected rendering at original detail and as a full-image preview. Verify hierarchy, wrapping, clipping, spacing, contrast, footer safety, and practical reading size. Fix HTML/CSS and rerender; never repair final text with an image editor.

## Conditional references and tools

- Read `references/editorial-paper-default.md` only when changing, auditing, or recreating the default visual system. The bundled template already implements it.
- Read `references/interactive-export-workflow.md` only when modifying or troubleshooting the editor, save-as-HTML, offline dependency, or JPG export shell.
- Read `references/image2-template-prompt.md` and invoke `$imagegen` only when the user requests alternatives or a materially different composition needs exploration. Request a style/layout reference only.
- Let an explicitly supplied or approved design system override the default for that artifact.

## Full template regression

Run full browser QA instead of fast QA only when:

- template CSS, editor/export JavaScript, or `html2canvas` changes;
- the artifact bypasses the builder and changes the editor/export shell;
- the browser or machine environment is new;
- fast QA exposes an interaction, offline-loading, blank-export, or save-as-HTML failure.

```bash
node scripts/qa_infographic.mjs \
  --mode full \
  --html <path/to/index.html> \
  --output-jpg <path/to/final.jpg> \
  --saved-html <path/to/qa/saved-copy.html> \
  --second-jpg <path/to/qa/saved-copy.jpg>
```

Full QA verifies editing, local autosave, preview mode, scrolling, panning, fit/100% zoom, save-as-HTML, offline vendor resolution, and a second JPG export. Do not repeat it for content-only changes on an already certified template.

## Canvas and export contract

- Build the CSS canvas at a native width of `1536px`; choose height from actual content.
- Start around `1536×2048` for compact, `1536×3072` for standard, and `1536×4096` or taller for long content, then adjust after visual inspection.
- Browser JPG export must accept a width from `512px` to `8192px`, calculate height from the base aspect ratio, and accept `70%` to `100%` quality.
- Default the one final browser export to `3072px` width and `95%` quality unless the user specifies otherwise.
- Never shrink essential copy to preserve a preset height. Reduce, regroup, or split content.
- Treat the native-width PNG as the deterministic iteration/QA image, not the only final format.
- When a messenger compresses previews, send the high-resolution JPG as a file attachment.

## Content and layout rules

- Lead with one exact title and one visual reading path.
- Prefer 3–6 sections. Use rails, arrows, timelines, or grids only when they clarify the source structure.
- Keep facts and inferences visually distinguishable.
- Retain important units, dates, thresholds, URLs, source boundaries, and stop conditions.
- Never invent missing facts, metrics, sources, or conclusions to fill the composition.
- Put every final title, number, label, source, and paragraph in real editable DOM text. Image-generated copy is not acceptable.
- Check body copy in a full-image preview. If it reads too small, enlarge it or split the output.

## Per-artifact QA gate

Do not declare completion until:

- source meaning is preserved and no unsupported claim was introduced;
- required text exists in the HTML and matches the approved copy;
- the HTML opens without external network dependencies;
- the selected JPG has the requested format and exact dimensions;
- no text is clipped, overlapped, distorted, or rendered as pseudo-text;
- numbers, dates, scores, labels, sources, and boundaries match the source;
- the selected final passes original-detail and full-image inspection;
- the default style still reads as modern editorial paper without large vermilion fields, heavy shadows, oversized rounded cards, or decorative clutter.

Deliver `content-outline.json`, `index.html`, `required-text.txt`, `vendor/html2canvas.min.js`, and the selected JPG. Report the base canvas, exported dimensions, JPG quality, and paths.

## Boundaries

- Do not send, publish, upload, or overwrite external content unless the user asks.
- Do not expose private source material inside an Image 2 prompt when a generic visual brief is sufficient.
- Do not overwrite an existing final; create a descriptive or versioned sibling filename.
- Keep discarded visual experiments separate from the selected final.
