# Content contract

Use one UTF-8 JSON outline as both the semantic contract and the input to `scripts/build_infographic.py`. Start from `assets/editorial-template/content-outline.json`.

## Core fields

```json
{
  "title": "Exact approved title",
  "subtitle": "Optional scope or date",
  "meta_left": "EDITORIAL INFOGRAPHIC",
  "meta_right": "NO. 001 / YYYY.MM.DD",
  "lead": "One-sentence reader value",
  "canvas_height": 2304,
  "audience": "Who will read it",
  "purpose": "What the reader should understand or do",
  "highlights": [
    { "eyebrow": "VALUE 01", "title": "Short value", "text": "Explanation" }
  ],
  "sections": [],
  "boundaries": ["What the graphic does not claim"],
  "required_text": ["Additional phrase that must remain exact"],
  "footer": {
    "source_label": "资料来源",
    "source": "Source name / date",
    "url": "https://example.com/source",
    "note": "Scope boundary",
    "mark": "SOURCE → INFOGRAPHIC"
  }
}
```

The builder automatically includes all visible outline copy in `required-text.txt`; use `required_text` only for extra verbatim phrases.

## Section types

Every section accepts `number`, `tag`, `title`, and optional `intro`.

### Callout

```json
{ "type": "callout", "callout": "Exact conclusion or instruction" }
```

### Steps

```json
{
  "type": "steps",
  "items": [
    { "stepno": "STEP 01", "title": "Step title", "text": "Step explanation" }
  ]
}
```

### Cards

```json
{
  "type": "cards",
  "items": [
    { "title": "Fact, evidence, boundary, or action", "text": "Content" }
  ]
}
```

### Split panels

```json
{
  "type": "split",
  "items": [
    {
      "title": "Panel title",
      "text": "Panel copy",
      "file": "Optional filename",
      "note": "Optional note",
      "palette": ["#f7f2e8", "#171716"]
    }
  ]
}
```

Use `"type": "text"` for a title plus introductory paragraphs without an extra component.

## Fact handling and compression

- Preserve units, denominators, time windows, sources, and channel boundaries.
- Label inference and recommendation instead of presenting them as facts.
- If the source contradicts itself, stop and surface the conflict before rendering.
- Compress by removing duplication, shortening labels, moving secondary evidence to the footer, then splitting cards. Never solve density with unreadably small type.
