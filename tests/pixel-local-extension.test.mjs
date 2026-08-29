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
  assert.deepEqual(manifest.permissions, ["downloads"]);
  assert.match(manifest.content_security_policy.extension_pages, /ws:\/\/127\.0\.0\.1:43127/);
  assert.match(entry, /import Home from "\.\.\/app\/page"/);
  assert.match(config, /outDir: path\.join\(projectDir, "扩展程序"\)/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.match(doctor, /manifest_version must be 3/);
  assert.equal(packageJson.scripts["doctor:extension"], "node scripts/pixel-local-extension-doctor.mjs");
  assert.match(packageJson.scripts.test, /npm run build:extension/);
});

test("MCP can open either localhost or an explicitly selected extension editor", async () => {
  const server = await read("tools/pixel-local-mcp/server.mjs");

  assert.match(server, /PIXEL_LOCAL_EDITOR_URL/);
  assert.match(server, /extensionId/);
  assert.match(server, /chrome-extension:\/\//);
});
