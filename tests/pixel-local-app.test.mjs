import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the Pixel Local editor instead of starter UI", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(layout, /Pixel Local｜本地图片编辑器/);
  assert.match(page, /window as PixelLocalWindow/);
  assert.match(page, /frame\.sidebarCollapse/);
  assert.match(page, /保存项目/);
  assert.match(page, /打开项目/);
  assert.doesNotMatch(page, /SkeletonPreview|Your site is taking shape/);
  assert.doesNotMatch(packageJson, /site-creator-vinext-starter/);
});

test("keeps private and generated assets outside the release scope", async () => {
  const ignore = await readFile(new URL(".gitignore", root), "utf8");
  for (const entry of ["/.pixel-qa/", "/.recovery-backups/", "/public/imports/", "/public/template-assets/", "/*.pixel.json"]) {
    assert.match(ignore, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
