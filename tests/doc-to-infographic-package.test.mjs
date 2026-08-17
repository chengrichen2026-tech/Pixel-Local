import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const skill = path.join(root, "skills", "doc-to-infographic");
const required = [
  "SKILL.md",
  "agents/openai.yaml",
  "assets/editorial-template/content-outline.json",
  "assets/editorial-template/template.html",
  "assets/editorial-template/vendor/html2canvas.min.js",
  "references/content-contract.md",
  "references/editorial-paper-default.md",
  "references/image2-template-prompt.md",
  "references/interactive-export-workflow.md",
  "scripts/build_infographic.py",
  "scripts/qa_infographic.mjs",
  "scripts/render_infographic.py",
  "scripts/validate_text_manifest.py",
];

test("doc-to-infographic package includes every referenced runtime resource", async () => {
  await Promise.all(required.map((entry) => stat(path.join(skill, entry))));
  const instructions = await readFile(path.join(skill, "SKILL.md"), "utf8");
  for (const reference of [
    "references/content-contract.md",
    "references/editorial-paper-default.md",
    "references/image2-template-prompt.md",
    "references/interactive-export-workflow.md",
    "scripts/build_infographic.py",
    "scripts/render_infographic.py",
    "scripts/validate_text_manifest.py",
    "scripts/qa_infographic.mjs",
  ]) assert.match(instructions, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const vendor = await readFile(path.join(skill, "assets/editorial-template/vendor/html2canvas.min.js"), "utf8");
  assert.match(vendor.slice(0, 500), /html2canvas 1\.4\.1/);
  assert.match(vendor.slice(0, 500), /Released under MIT License/);
});

test("doc-to-infographic builds its neutral template and validates required text", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "doc-to-infographic-package-"));
  const output = path.join(temporary, "output");
  execFileSync("python3", [
    path.join(skill, "scripts/build_infographic.py"),
    "--outline", path.join(skill, "assets/editorial-template/content-outline.json"),
    "--output-dir", output,
  ], { stdio: "pipe" });
  const validation = execFileSync("python3", [
    path.join(skill, "scripts/validate_text_manifest.py"),
    "--html", path.join(output, "index.html"),
    "--manifest", path.join(output, "required-text.txt"),
  ], { encoding: "utf8" });
  assert.match(validation, /TEXT_MANIFEST_OK required=64 missing=0/);
  await stat(path.join(output, "vendor/html2canvas.min.js"));
});
