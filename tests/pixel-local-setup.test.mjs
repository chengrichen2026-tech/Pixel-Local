import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const setupScript = path.join(root, "scripts", "pixel-local-setup.mjs");
const doctorScript = path.join(root, "scripts", "pixel-local-doctor.mjs");

const run = (script, args, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, env: { ...process.env, ...env } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});

const isolatedEnv = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pixel-local-setup-"));
  const codex = path.join(directory, "codex");
  const config = path.join(codex, "config.toml");
  const skill = path.join(codex, "skills", "pixel-local-editor");
  await mkdir(codex, { recursive: true });
  return { directory, config, skill, env: {
    PIXEL_LOCAL_CODEX_HOME: codex,
    PIXEL_LOCAL_CONFIG_PATH: config,
    PIXEL_LOCAL_SKILL_DIR: skill,
    PIXEL_LOCAL_SKIP_DEPENDENCIES: "1",
    PIXEL_LOCAL_SKIP_SERVICE: "1",
    PIXEL_LOCAL_SKIP_BRIDGE: "1",
    PIXEL_LOCAL_SKIP_EDITOR: "1",
    PIXEL_LOCAL_PLATFORM: "linux",
  } };
};

test("setup defaults to dry-run without writing", async () => {
  const fixture = await isolatedEnv();
  await writeFile(fixture.config, "[ui]\ntheme = \"dark\"\n");
  const before = await readFile(fixture.config, "utf8");
  const result = await run(setupScript, [], fixture.env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /DRY-RUN/);
  assert.match(result.stdout, /No changes made/);
  assert.equal(await readFile(fixture.config, "utf8"), before);
  await assert.rejects(readFile(path.join(fixture.skill, "SKILL.md")));
});

test("apply backs up config, installs Skill and remains idempotent", async () => {
  const fixture = await isolatedEnv();
  await writeFile(fixture.config, "[ui]\ntheme = \"dark\"\n\n[mcp_servers.pixel-local-editor]\ncommand = \"old-node\"\nargs = [\"old-server\"]\n\n[features]\napps = true\n");
  const first = await run(setupScript, ["--apply"], fixture.env);
  assert.equal(first.code, 0, first.stderr);
  const configured = await readFile(fixture.config, "utf8");
  assert.match(configured, /\[mcp_servers\.pixel-local-editor\]/);
  assert.match(configured, /PIXEL_LOCAL_DEFAULT_TARGET = "extension"/);
  assert.match(configured, /theme = "dark"/);
  assert.match(configured, /\[features\]\napps = true/);
  assert.doesNotMatch(configured, /old-node|old-server/);
  assert.match(await readFile(path.join(fixture.skill, "SKILL.md"), "utf8"), /Pixel Local Editor/);
  const backupsAfterFirst = (await readdir(path.dirname(fixture.config))).filter((name) => name.includes(".backup-"));
  assert.equal(backupsAfterFirst.length, 1);
  const second = await run(setupScript, ["--apply"], fixture.env);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /already current/);
  assert.equal(await readFile(fixture.config, "utf8"), configured);
  const backupsAfterSecond = (await readdir(path.dirname(fixture.config))).filter((name) => name.includes(".backup-"));
  assert.deepEqual(backupsAfterSecond, backupsAfterFirst);
});

test("setup stores and preserves the default Chrome extension id", async () => {
  const fixture = await isolatedEnv();
  await writeFile(fixture.config, "[ui]\ntheme = \"dark\"\n");
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  const first = await run(setupScript, ["--apply", "--extension-id", extensionId], fixture.env);
  assert.equal(first.code, 0, first.stderr);
  const configured = await readFile(fixture.config, "utf8");
  assert.match(configured, new RegExp(`PIXEL_LOCAL_EXTENSION_ID = "${extensionId}"`));
  const second = await run(setupScript, ["--apply"], fixture.env);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(await readFile(fixture.config, "utf8"), configured);
});

test("setup reuses a healthy macOS Bridge instead of reinstalling its LaunchAgent", async () => {
  const fixture = await isolatedEnv();
  const bridge = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, ready: false, connectedClients: [] }));
  });
  bridge.listen(0, "127.0.0.1"); await once(bridge, "listening");
  const result = await run(setupScript, ["--apply"], {
    ...fixture.env,
    PIXEL_LOCAL_PLATFORM: "darwin",
    PIXEL_LOCAL_SKIP_SERVICE: "0",
    PIXEL_LOCAL_BRIDGE_URL: `http://127.0.0.1:${bridge.address().port}`,
  });
  bridge.close();
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Bridge already healthy; existing LaunchAgent reused/);
});

test("doctor distinguishes failed installation from a ready canvas", async () => {
  const missing = await isolatedEnv();
  const failed = await run(doctorScript, ["--json"], {
    ...missing.env,
    PIXEL_LOCAL_BRIDGE_URL: "http://127.0.0.1:9",
    PIXEL_LOCAL_EDITOR_URL: "http://127.0.0.1:9",
  });
  assert.equal(failed.code, 1);
  const failedReport = JSON.parse(failed.stdout);
  assert.equal(failedReport.ok, false);
  assert.equal(failedReport.checks.find((item) => item.name === "canvas").status, "fail");
  assert.match(failedReport.checks.find((item) => item.name === "bridge").fix, /bridge:ensure/);

  const ready = await isolatedEnv();
  await writeFile(ready.config, "[ui]\ntheme = \"light\"\n");
  const applied = await run(setupScript, ["--apply"], ready.env);
  assert.equal(applied.code, 0, applied.stderr);
  const bridge = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, ready: true, primaryClientId: "primary", connectedClients: [{ clientId: "primary", primary: true, ready: true, url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/index.html" }] }));
  });
  const editor = http.createServer((_request, response) => { response.writeHead(200); response.end("Pixel Local"); });
  bridge.listen(0, "127.0.0.1"); editor.listen(0, "127.0.0.1");
  await Promise.all([once(bridge, "listening"), once(editor, "listening")]);
  const bridgePort = bridge.address().port; const editorPort = editor.address().port;
  const healthy = await run(doctorScript, ["--json"], {
    ...ready.env,
    PIXEL_LOCAL_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
    PIXEL_LOCAL_EDITOR_URL: `http://127.0.0.1:${editorPort}`,
  });
  bridge.close(); editor.close();
  assert.equal(healthy.code, 0, healthy.stderr);
  const healthyReport = JSON.parse(healthy.stdout);
  assert.equal(healthyReport.ok, true);
  assert.equal(healthyReport.checks.find((item) => item.name === "canvas").status, "ok");
  assert.equal(healthyReport.checks.find((item) => item.name === "bridge-service").status, "manual");
  assert.equal(healthyReport.checks.find((item) => item.name === "codex-tools").status, "manual");
});
