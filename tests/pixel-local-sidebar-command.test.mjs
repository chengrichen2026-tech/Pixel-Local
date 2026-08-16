import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("documents and exposes frame sidebar collapse without changing visibility", async () => {
  const [source, api] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("COMMAND_API.md", root), "utf8"),
  ]);

  assert.match(source, /case "frame\.sidebarCollapse"/);
  assert.match(source, /sidebarCollapsed:/);
  assert.match(source, /sidebar: \{ collapsedFrameIds:/);
  assert.match(source, /commands\.every\(\(command\) => command\.op === "frame\.sidebarCollapse"\)/);
  assert.doesNotMatch(source.match(/case "frame\.sidebarCollapse":[\s\S]*?break;/)?.[0] || "", /\.hidden\s*=|visible:/);
  assert.match(api, /只收起或展开 Layers 侧栏/);
  assert.match(api, /不隐藏或修改 Frame 和内部对象，也不影响导出/);
});
