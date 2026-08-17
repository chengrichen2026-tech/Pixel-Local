import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manager = path.join(root, "scripts", "pixel-local-bridge-process.mjs");
const setup = path.join(root, "scripts", "pixel-local-setup.mjs");
const doctor = path.join(root, "scripts", "pixel-local-doctor.mjs");
const runScript = (script, args, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, env: { ...process.env, ...env } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});
const run = (args, env) => runScript(manager, args, env);
const freePort = async () => {
  const server = http.createServer(); server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};

test("managed Bridge starts when missing, becomes healthy and is idempotent", async (t) => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), "pixel-local-bridge-"));
  const port = await freePort();
  const env = {
    PIXEL_LOCAL_RUNTIME_DIR: runtime,
    PIXEL_LOCAL_BRIDGE_PORT: String(port),
    PIXEL_LOCAL_BRIDGE_URL: `http://127.0.0.1:${port}`,
    PIXEL_LOCAL_BRIDGE_START_TIMEOUT_MS: "3000",
  };
  t.after(async () => { await run(["stop"], env); });
  const first = await run(["ensure"], env);
  assert.equal(first.code, 0, first.stderr);
  const started = JSON.parse(first.stdout);
  assert.equal(started.started, true);
  assert.ok(started.pid > 0);
  assert.equal((await fetch(`${env.PIXEL_LOCAL_BRIDGE_URL}/health`)).status, 200);
  const second = await run(["ensure"], env);
  assert.equal(second.code, 0, second.stderr);
  const reused = JSON.parse(second.stdout);
  assert.equal(reused.started, false);
  assert.equal(reused.reason, "already-healthy");
  assert.equal(reused.record.pid, started.pid);
  const logInfo = JSON.parse((await run(["logs"], env)).stdout);
  assert.match(logInfo.logFile, /bridge-managed\.log$/);
  await readFile(logInfo.logFile, "utf8");
  const stopped = await run(["stop"], env);
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.equal(JSON.parse(stopped.stdout).stopped, true);
});

test("managed Bridge timeout fails clearly and removes its tracked process", async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), "pixel-local-bridge-timeout-"));
  const port = await freePort();
  const idleScript = path.join(runtime, "idle.mjs");
  await writeFile(idleScript, "setInterval(() => {}, 1000);\n");
  const env = {
    PIXEL_LOCAL_RUNTIME_DIR: runtime,
    PIXEL_LOCAL_BRIDGE_SCRIPT: idleScript,
    PIXEL_LOCAL_BRIDGE_URL: `http://127.0.0.1:${port}`,
    PIXEL_LOCAL_BRIDGE_PORT: String(port),
    PIXEL_LOCAL_BRIDGE_START_TIMEOUT_MS: "300",
  };
  const result = await run(["ensure"], env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /did not become healthy|bridge-managed\.log/i);
  const status = await run(["status"], env);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).running, false);
});

test("doctor repair starts Bridge but does not misreport an unconnected canvas", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pixel-local-doctor-repair-"));
  const runtime = path.join(directory, "runtime");
  const codex = path.join(directory, "codex");
  const port = await freePort();
  const editor = http.createServer((_request, response) => { response.writeHead(200); response.end("Pixel Local"); });
  editor.listen(0, "127.0.0.1"); await new Promise((resolve) => editor.once("listening", resolve));
  const env = {
    PIXEL_LOCAL_RUNTIME_DIR: runtime,
    PIXEL_LOCAL_BRIDGE_PORT: String(port),
    PIXEL_LOCAL_BRIDGE_URL: `http://127.0.0.1:${port}`,
    PIXEL_LOCAL_EDITOR_URL: `http://127.0.0.1:${editor.address().port}`,
    PIXEL_LOCAL_CODEX_HOME: codex,
    PIXEL_LOCAL_CONFIG_PATH: path.join(codex, "config.toml"),
    PIXEL_LOCAL_SKILL_DIR: path.join(codex, "skills", "pixel-local-editor"),
    PIXEL_LOCAL_SKIP_DEPENDENCIES: "1",
    PIXEL_LOCAL_SKIP_SERVICE: "1",
    PIXEL_LOCAL_SKIP_BRIDGE: "1",
    PIXEL_LOCAL_SKIP_EDITOR: "1",
    PIXEL_LOCAL_PLATFORM: "win32",
  };
  t.after(async () => { await run(["stop"], env); editor.close(); });
  const installed = await runScript(setup, ["--apply"], env);
  assert.equal(installed.code, 0, installed.stderr);
  const repaired = await runScript(doctor, ["--repair", "--json"], env);
  const report = JSON.parse(repaired.stdout);
  assert.equal(repaired.code, 1, repaired.stderr);
  assert.equal(report.checks.find((item) => item.name === "bridge").status, "ok");
  assert.equal(report.checks.find((item) => item.name === "bridge-service").status, "ok");
  assert.equal(report.checks.find((item) => item.name === "canvas").status, "fail");
});
