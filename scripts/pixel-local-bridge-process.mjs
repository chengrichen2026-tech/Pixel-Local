#!/usr/bin/env node

import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROJECT_DIR, bridgeUrl, exists, fetchStatus } from "./pixel-local-install-lib.mjs";

export const runtimeDir = () => path.resolve(process.env.PIXEL_LOCAL_RUNTIME_DIR || path.join(PROJECT_DIR, ".runtime"));
export const managedPidFile = () => path.join(runtimeDir(), "bridge-managed.json");
export const managedLogFile = () => path.join(runtimeDir(), "bridge-managed.log");
const bridgeScript = () => path.resolve(process.env.PIXEL_LOCAL_BRIDGE_SCRIPT || path.join(PROJECT_DIR, "tools", "pixel-local-bridge", "daemon.mjs"));
const timeoutMs = () => Math.max(200, Number(process.env.PIXEL_LOCAL_BRIDGE_START_TIMEOUT_MS) || 10_000);

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const readRecord = async () => {
  try { return JSON.parse(await readFile(managedPidFile(), "utf8")); } catch { return null; }
};
const removeRecord = async () => { if (await exists(managedPidFile())) await unlink(managedPidFile()); };
const health = () => fetchStatus(`${bridgeUrl()}/health`, "json");
const waitForHealth = async (limit = timeoutMs()) => {
  const deadline = Date.now() + limit;
  do {
    const result = await health();
    if (result.ok) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return health();
};

export const managedBridgeStatus = async () => {
  const record = await readRecord();
  const running = Boolean(record && alive(Number(record.pid)));
  return { running, record: running ? record : null, pidFile: managedPidFile(), logFile: managedLogFile() };
};

export const stopManagedBridge = async () => {
  const record = await readRecord();
  if (!record || !alive(Number(record.pid))) {
    await removeRecord();
    return { stopped: false, reason: "not-running", logFile: managedLogFile() };
  }
  try { process.kill(Number(record.pid), "SIGTERM"); } catch { /* process exited between checks */ }
  for (let attempt = 0; attempt < 30 && alive(Number(record.pid)); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (alive(Number(record.pid))) {
    try { process.kill(Number(record.pid), "SIGKILL"); } catch { /* already stopped */ }
  }
  await removeRecord();
  return { stopped: true, pid: Number(record.pid), logFile: managedLogFile() };
};

export const ensureManagedBridge = async () => {
  const currentHealth = await health();
  if (currentHealth.ok) return { started: false, reason: "already-healthy", health: currentHealth.body, ...(await managedBridgeStatus()) };
  const previous = await managedBridgeStatus();
  if (previous.running) await stopManagedBridge(); else await removeRecord();
  await mkdir(runtimeDir(), { recursive: true });
  const log = openSync(managedLogFile(), "a");
  const url = new URL(bridgeUrl());
  const child = spawn(process.execPath, [bridgeScript()], {
    cwd: PROJECT_DIR,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PIXEL_LOCAL_BRIDGE_PORT: process.env.PIXEL_LOCAL_BRIDGE_PORT || url.port || "43127" },
  });
  child.unref(); closeSync(log);
  const record = { pid: child.pid, startedAt: new Date().toISOString(), script: bridgeScript(), url: bridgeUrl() };
  await writeFile(managedPidFile(), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const result = await waitForHealth();
  if (!result.ok) {
    await stopManagedBridge();
    throw new Error(`Bridge did not become healthy within ${timeoutMs()}ms. See ${managedLogFile()}`);
  }
  return { started: true, pid: child.pid, health: result.body, pidFile: managedPidFile(), logFile: managedLogFile() };
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const action = process.argv[2] || "ensure";
  const execute = action === "ensure" || action === "start" ? ensureManagedBridge
    : action === "stop" ? stopManagedBridge
      : action === "status" ? managedBridgeStatus
        : action === "logs" ? async () => ({ logFile: managedLogFile(), pidFile: managedPidFile() })
          : null;
  if (!execute) { console.error("Usage: node scripts/pixel-local-bridge-process.mjs {ensure|status|stop|logs}"); process.exitCode = 2; }
  else execute().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`Bridge ${action} failed: ${error.message}`); process.exitCode = 1; });
}
