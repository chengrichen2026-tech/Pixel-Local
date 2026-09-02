import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ships Pixel Local as a Manifest V3 extension using the shared editor core", async () => {
  const [manifestText, entry, config, background, doctor, packageText] = await Promise.all([
    read("extension/public/manifest.json"),
    read("extension/main.tsx"),
    read("vite.extension.config.ts"),
    read("extension/public/background.js"),
    read("scripts/pixel-local-extension-doctor.mjs"),
    read("package.json"),
  ]);
  const manifest = JSON.parse(manifestText);
  const packageJson = JSON.parse(packageText);

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Pixel Local");
  assert.deepEqual(manifest.action.default_icon, { "16": "icon-16.png", "32": "icon-32.png", "48": "icon-48.png", "128": "icon-128.png" });
  assert.deepEqual(manifest.icons, manifest.action.default_icon);
  assert.deepEqual(manifest.permissions, ["downloads"]);
  assert.match(manifest.content_security_policy.extension_pages, /ws:\/\/127\.0\.0\.1:43127/);
  assert.match(entry, /import Home from "\.\.\/app\/page"/);
  assert.match(config, /outDir: path\.join\(projectDir, "扩展程序"\)/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.match(doctor, /manifest_version must be 3/);
  assert.equal(packageJson.scripts["doctor:extension"], "node scripts/pixel-local-extension-doctor.mjs");
  assert.match(packageJson.scripts.test, /npm run build:extension/);
});

test("Pixel Local ships a complete large-letter blue PL icon set", async () => {
  const [source, ...pngs] = await Promise.all([
    read("extension/public/icon.svg"),
    ...[16, 32, 48, 128].map((size) => readFile(new URL(`extension/public/icon-${size}.png`, root))),
  ]);
  assert.match(source, /#217BFE/);
  assert.match(source, />PL<\/text>/);
  assert.match(source, /Arial Black/);
  assert.match(source, /font-size="68"/);
  assert.ok(pngs.every((file) => file.subarray(1, 4).toString() === "PNG"));
});

test("README routes ordinary users to the complete Chrome extension guide", async () => {
  const [readme, guide, ignore] = await Promise.all([
    read("README.md"),
    read("PIXEL_LOCAL_EXTENSION_GUIDE.md"),
    read(".gitignore"),
  ]);
  assert.match(readme, /\[Pixel Local Chrome 插件使用说明\]\(PIXEL_LOCAL_EXTENSION_GUIDE\.md\)/);
  assert.match(readme, /GitHub 仓库提供源码/);
  assert.match(guide, /npm run build:extension/);
  assert.match(guide, /chrome:\/\/extensions/);
  assert.match(guide, /git pull --ff-only origin codex\/update-local-editor/);
  assert.match(guide, /\.pixel\.json/);
  assert.match(guide, /扩展 ID/);
  assert.match(guide, /npm run setup:codex -- --apply/);
  assert.match(guide, /--extension-id/);
  assert.match(guide, /插件画布是 Codex 的默认目标/);
  assert.match(ignore, /\/扩展程序\//);
});

test("MCP defaults to a configured or connected extension and keeps localhost explicit", async () => {
  const server = await read("tools/pixel-local-mcp/server.mjs");

  assert.match(server, /PIXEL_LOCAL_EDITOR_URL/);
  assert.match(server, /extensionId/);
  assert.match(server, /PIXEL_LOCAL_DEFAULT_TARGET \|\| "extension"/);
  assert.match(server, /extensionClients/);
  assert.match(server, /target !== "localhost"/);
  assert.match(server, /chrome-extension:\/\//);
});
