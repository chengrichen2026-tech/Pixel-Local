# Image 2 visual-template prompt

Use Image 2 only for visual direction and layout exploration. Do not provide private source copy unless it is necessary.

```text
Use case: infographic-diagram
Asset type: visual template reference for an information infographic
Primary request: Create a polished visual system and layout reference for the supplied information structure. This is a STYLE AND LAYOUT REFERENCE ONLY; all final text will be added separately with HTML/CSS.
Subject: <describe the section count and relationship, not the final paragraphs>
Style/medium: <approved visual direction; if none is supplied, use the modern editorial-paper system in references/editorial-paper-default.md>
Composition/framing: <portrait or landscape canvas; reading direction; hierarchy>
Color palette: <approved palette; for the default system use warm paper #F7F2E8, black ink #171716, muted gray #6C685F, light rules #CFC4B3, and restrained vermilion #F04B16>
Text: only simple section numbers such as "01", "02", "03" when useful; no other text.
Constraints: blank text areas; clean hierarchy; no logos unless supplied and authorized; no watermark; no pseudo-text; no dense Chinese copy.
Avoid: illegible labels, fake writing, decorative clutter, arbitrary extra sections, retro newspaper distress, large vermilion fields, heavy shadows, and oversized rounded cards.
```

After generation, inspect the reference and use it to guide HTML/CSS. Do not treat the generated bitmap as the final information artifact.
