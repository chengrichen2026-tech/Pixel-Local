#!/usr/bin/env python3
"""Build the default editable infographic package from one JSON outline."""

from __future__ import annotations

import argparse
from html import escape
import json
from pathlib import Path
import re
import shutil


SKILL_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = SKILL_ROOT / "assets" / "editorial-template"
TEMPLATE_PATH = TEMPLATE_DIR / "template.html"
VENDOR_PATH = TEMPLATE_DIR / "vendor" / "html2canvas.min.js"
START_MARKER = "<!-- INFOGRAPHIC_CONTENT_START -->"
END_MARKER = "<!-- INFOGRAPHIC_CONTENT_END -->"


def text(value: object, field: str, *, required: bool = False) -> str:
    if value is None:
        if required:
            raise ValueError(f"missing required text field: {field}")
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = value.strip()
    if required and not cleaned:
        raise ValueError(f"{field} must not be empty")
    return cleaned


def escaped(value: object, field: str, *, required: bool = False) -> str:
    return escape(text(value, field, required=required))


def object_list(value: object, field: str) -> list[dict[str, object]]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"{field} must be a list of objects")
    return value


def strings(value: object, field: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{field} must be a string or list of strings")
    return [item.strip() for item in value if item.strip()]


def render_highlights(items: list[dict[str, object]]) -> str:
    if not items:
        return ""
    cards = []
    for index, item in enumerate(items, start=1):
        cards.append(
            "        <div class=\"benefit\">"
            f"<div class=\"eyebrow\">{escaped(item.get('eyebrow'), f'highlights[{index}].eyebrow')}</div>"
            f"<h2>{escaped(item.get('title'), f'highlights[{index}].title', required=True)}</h2>"
            f"<p>{escaped(item.get('text'), f'highlights[{index}].text', required=True)}</p></div>"
        )
    columns = min(4, max(1, len(items)))
    return (
        f"      <div class=\"benefits\" style=\"grid-template-columns:repeat({columns},1fr)\">\n"
        + "\n".join(cards)
        + "\n      </div>"
    )


def render_steps(items: list[dict[str, object]], field: str) -> str:
    if not items:
        raise ValueError(f"{field}.items must not be empty for type=steps")
    blocks = []
    for index, item in enumerate(items, start=1):
        stepno = escaped(item.get("stepno") or f"STEP {index:02d}", f"{field}.items[{index}].stepno")
        blocks.append(
            "            <div class=\"step\">"
            f"<div class=\"stepno\">{stepno}</div>"
            f"<h3>{escaped(item.get('title'), f'{field}.items[{index}].title', required=True)}</h3>"
            f"<p>{escaped(item.get('text'), f'{field}.items[{index}].text', required=True)}</p></div>"
        )
    columns = min(5, max(1, len(items)))
    return (
        f"          <div class=\"steps\" style=\"grid-template-columns:repeat({columns},1fr)\">\n"
        + "\n".join(blocks)
        + "\n          </div>"
    )


def render_cards(items: list[dict[str, object]], field: str) -> str:
    if not items:
        raise ValueError(f"{field}.items must not be empty for type=cards")
    blocks = []
    for index, item in enumerate(items, start=1):
        blocks.append(
            "            <div class=\"output\">"
            f"<strong>{escaped(item.get('title'), f'{field}.items[{index}].title', required=True)}</strong>"
            f"<span>{escaped(item.get('text'), f'{field}.items[{index}].text', required=True)}</span></div>"
        )
    columns = min(4, max(1, len(items)))
    return (
        f"          <div class=\"outputs\" style=\"grid-template-columns:repeat({columns},1fr)\">\n"
        + "\n".join(blocks)
        + "\n          </div>"
    )


def render_split(items: list[dict[str, object]], field: str) -> str:
    if not items:
        raise ValueError(f"{field}.items must not be empty for type=split")
    panels = []
    for index, item in enumerate(items, start=1):
        parts = [
            "            <div class=\"panel\">",
            f"              <h3>{escaped(item.get('title'), f'{field}.items[{index}].title', required=True)}</h3>",
        ]
        palette = strings(item.get("palette"), f"{field}.items[{index}].palette")
        if palette:
            swatches = "".join(
                f'<div class="swatch" style="background:{escape(color)}"></div>'
                for color in palette
            )
            parts.append(f'              <div class="palette">{swatches}</div>')
        if item.get("file"):
            parts.append(f'              <div class="file">{escaped(item.get("file"), f"{field}.items[{index}].file")}</div>')
        if item.get("text"):
            parts.append(f'              <p>{escaped(item.get("text"), f"{field}.items[{index}].text")}</p>')
        if item.get("note"):
            parts.append(f'              <div class="hash">{escaped(item.get("note"), f"{field}.items[{index}].note")}</div>')
        parts.append("            </div>")
        panels.append("\n".join(parts))
    columns = min(3, max(1, len(items)))
    return (
        f"          <div class=\"split\" style=\"grid-template-columns:repeat({columns},1fr)\">\n"
        + "\n".join(panels)
        + "\n          </div>"
    )


def render_section(section: dict[str, object], index: int) -> str:
    field = f"sections[{index}]"
    number = escaped(section.get("number") or f"{index:02d}", f"{field}.number")
    tag = escaped(section.get("tag"), f"{field}.tag", required=True)
    title_value = escaped(section.get("title"), f"{field}.title", required=True)
    intro_parts = strings(section.get("intro"), f"{field}.intro")
    intro_html = "\n".join(f"          <p>{escape(item)}</p>" for item in intro_parts)
    kind = text(section.get("type") or "text", f"{field}.type")
    items = object_list(section.get("items"), f"{field}.items")
    component = ""
    if kind == "callout":
        component = f'          <div class="prompt"><code>{escaped(section.get("callout"), f"{field}.callout", required=True)}</code></div>'
    elif kind == "steps":
        component = render_steps(items, field)
    elif kind == "cards":
        component = render_cards(items, field)
    elif kind == "split":
        component = render_split(items, field)
    elif kind != "text":
        raise ValueError(f"unsupported {field}.type: {kind}")
    body_parts = [f"          <h2>{title_value}</h2>"]
    if intro_html:
        body_parts.append(intro_html)
    if component:
        body_parts.append(component)
    return "\n".join(
        [
            "      <section class=\"section\">",
            f"        <div class=\"rail\"><div class=\"num\">{number}</div><div class=\"tag\">{tag}</div></div>",
            "        <div class=\"body\">",
            *body_parts,
            "        </div>",
            "      </section>",
        ]
    )


def visible_texts(data: dict[str, object]) -> list[str]:
    result: list[str] = []

    def add(value: object, field: str) -> None:
        result.extend(strings(value, field))

    for key in ("meta_left", "meta_right", "title", "subtitle", "lead"):
        add(data.get(key), key)
    for index, item in enumerate(object_list(data.get("highlights"), "highlights"), start=1):
        for key in ("eyebrow", "title", "text"):
            add(item.get(key), f"highlights[{index}].{key}")
    for index, section in enumerate(object_list(data.get("sections"), "sections"), start=1):
        for key in ("number", "tag", "title", "intro", "callout"):
            add(section.get(key), f"sections[{index}].{key}")
        for item_index, item in enumerate(object_list(section.get("items"), f"sections[{index}].items"), start=1):
            for key in ("stepno", "title", "text", "file", "note"):
                add(item.get(key), f"sections[{index}].items[{item_index}].{key}")
    footer = data.get("footer") or {}
    if not isinstance(footer, dict):
        raise ValueError("footer must be an object")
    for key in ("source_label", "source", "url", "note", "mark"):
        add(footer.get(key), f"footer.{key}")
    add(data.get("required_text"), "required_text")
    return list(dict.fromkeys(item for item in result if item))


def render_document(data: dict[str, object], template: str) -> tuple[str, list[str]]:
    title_value = escaped(data.get("title"), "title", required=True)
    subtitle = escaped(data.get("subtitle"), "subtitle")
    lead = escaped(data.get("lead"), "lead", required=True)
    meta_left = escaped(data.get("meta_left") or "EDITORIAL INFOGRAPHIC", "meta_left")
    meta_right = escaped(data.get("meta_right") or "NO. 001", "meta_right")
    sections = object_list(data.get("sections"), "sections")
    if not sections:
        raise ValueError("sections must contain at least one section")
    footer = data.get("footer") or {}
    if not isinstance(footer, dict):
        raise ValueError("footer must be an object")

    content = [
        "      <header class=\"masthead\">",
        f"        <div class=\"edition\"><span>{meta_left}</span><span>{meta_right}</span></div>",
        f"        <h1><span class=\"headline\">{title_value}</span>"
        + (f'<span class="subline">{subtitle}</span>' if subtitle else "")
        + "</h1>",
        f"        <p class=\"lead\">{lead}</p>",
        "      </header>",
    ]
    highlights = render_highlights(object_list(data.get("highlights"), "highlights"))
    if highlights:
        content.append(highlights)
    content.extend(render_section(section, index) for index, section in enumerate(sections, start=1))

    source_label = escaped(footer.get("source_label") or "资料来源", "footer.source_label")
    source = escaped(footer.get("source"), "footer.source")
    url = escaped(footer.get("url"), "footer.url")
    note = escaped(footer.get("note") or "本图为结构化视觉摘要，不替代完整原文。", "footer.note")
    mark = escaped(footer.get("mark") or "SOURCE → INFOGRAPHIC", "footer.mark")
    source_line = f"<b>{source_label}</b>"
    if source:
        source_line += f" · {source}"
    if url:
        source_line += f'<br/><span class="url">{url}</span>'
    if note:
        source_line += f"<br/>{note}"
    content.extend(
        [
            "      <footer>",
            f"        <div>{source_line}</div>",
            f"        <div class=\"mark\">{mark}</div>",
            "      </footer>",
        ]
    )

    canvas_height = data.get("canvas_height", 2304)
    if not isinstance(canvas_height, int) or canvas_height < 1024:
        raise ValueError("canvas_height must be an integer of at least 1024")
    replacement = START_MARKER + "\n" + "\n\n".join(content) + "\n      " + END_MARKER
    pattern = re.compile(re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER), re.DOTALL)
    html, count = pattern.subn(lambda _: replacement, template, count=1)
    if count != 1:
        raise RuntimeError("template content markers were not found exactly once")
    html = html.replace("--canvas-height: 2304px;", f"--canvas-height: {canvas_height}px;", 1)
    html = re.sub(r"<title>.*?</title>", f"<title>{title_value}</title>", html, count=1)
    return html, visible_texts(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outline", required=True, help="UTF-8 JSON content outline")
    parser.add_argument("--output-dir", required=True, help="Output package directory")
    parser.add_argument("--force", action="store_true", help="Replace generated files in an existing output directory")
    args = parser.parse_args()

    outline_path = Path(args.outline).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    if not outline_path.is_file():
        parser.error(f"outline does not exist: {outline_path}")
    data = json.loads(outline_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        parser.error("outline root must be a JSON object")

    generated_paths = [output_dir / "index.html", output_dir / "required-text.txt"]
    if not args.force and any(path.exists() for path in generated_paths):
        parser.error("generated output already exists; use a new directory or pass --force")

    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    html, required = render_document(data, template)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "vendor").mkdir(parents=True, exist_ok=True)
    (output_dir / "index.html").write_text(html, encoding="utf-8")
    (output_dir / "required-text.txt").write_text("\n".join(required) + "\n", encoding="utf-8")
    shutil.copy2(VENDOR_PATH, output_dir / "vendor" / VENDOR_PATH.name)
    destination_outline = output_dir / "content-outline.json"
    if outline_path != destination_outline:
        shutil.copy2(outline_path, destination_outline)

    print(
        json.dumps(
            {
                "created": True,
                "output_dir": str(output_dir),
                "canvas": f"1536x{data.get('canvas_height', 2304)}",
                "sections": len(object_list(data.get("sections"), "sections")),
                "required_text": len(required),
                "files": [str(path) for path in [destination_outline, *generated_paths, output_dir / "vendor" / VENDOR_PATH.name]],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
