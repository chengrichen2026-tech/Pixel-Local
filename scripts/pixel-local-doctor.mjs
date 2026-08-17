#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  bridgeUrl, configPath, dependenciesReady, editorStatus, exists, fetchStatus, launchAgentPath,
  mcpBlock, mcpServerPath, nodeVersionOk, platform, skillIsSynchronized,
} from "./pixel-local-install-lib.mjs";
import { ensureManagedBridge, managedBridgeStatus } from "./pixel-local-bridge-process.mjs";

const jsonOutput = process.argv.includes("--json");
const repair = process.argv.includes("--repair");
const checks = [];
const add = (name, status, detail, fix = null) => checks.push({ name, status, detail, ...(fix ? { fix } : {}) });

const main = async () => {
  add("node", nodeVersionOk() ? "ok" : "fail", process.versions.node, "Install Node.js 22.13 or newer.");
  add("dependencies", await dependenciesReady() ? "ok" : "fail", "Project dependencies", "Run npm ci.");
  add("skill", await skillIsSynchronized() ? "ok" : "fail", "Installed Pixel Local Skill", "Run npm run setup:codex -- --apply.");
  const config = await exists(configPath()) ? await readFile(configPath(), "utf8") : "";
  const expected = mcpBlock().split("\n");
  const configOk = expected.every((line) => config.includes(line));
  add("mcp-config", configOk ? "ok" : "fail", configPath(), "Run npm run setup:codex -- --apply.");
  add("mcp-server", await exists(mcpServerPath()) ? "ok" : "fail", mcpServerPath(), "Restore the repository checkout.");
  let bridge = await fetchStatus(`${bridgeUrl()}/health`, "json");
  if (!bridge.ok && repair && platform() !== "darwin") {
    try { await ensureManagedBridge(); bridge = await fetchStatus(`${bridgeUrl()}/health`, "json"); }
    catch { /* report the failed health check and repair command below */ }
  }
  if (platform() === "darwin") {
    add("bridge-service", await exists(launchAgentPath()) ? "ok" : "fail", launchAgentPath(), "Run npm run bridge:install.");
  } else {
    const managed = await managedBridgeStatus();
    add("bridge-service", managed.running ? "ok" : bridge.ok ? "manual" : "fail", managed.running ? `Managed background PID ${managed.record.pid}; log: ${managed.logFile}` : bridge.ok ? "Bridge is healthy but not tracked by this checkout." : "No managed Bridge process is running.", "Run npm run bridge:ensure.");
  }
  add("bridge", bridge.ok ? "ok" : "fail", bridge.ok ? "Bridge is responding" : "Bridge is not responding", platform() === "darwin" ? "Run npm run bridge:install." : "Run npm run bridge:ensure, or npm run doctor -- --repair.");
  const editor = await editorStatus();
  add("editor", editor.ok ? "ok" : "fail", editor.ok ? `Pixel Local HTTP ${editor.status}` : "Pixel Local editor is not responding or the port belongs to another service", "Run npm run dev.");
  const ready = Boolean(bridge.ok && bridge.body?.ready && bridge.body?.connectedClients?.length);
  add("canvas", ready ? "ok" : "fail", ready ? `${bridge.body.connectedClients.length} connected editor(s); primary=${Boolean(bridge.body.primaryClientId)}` : "No ready editor canvas is connected", "Open the editor page and select the primary canvas.");
  add("codex-tools", "manual", "Tool mounting can only be confirmed inside a newly opened Codex task.", "Create a new task, then call editor_status and get_state.");
  const ok = !checks.some((check) => check.status === "fail");
  if (jsonOutput) console.log(JSON.stringify({ ok, checks }, null, 2));
  else {
    for (const check of checks) console.log(`${check.status === "ok" ? "✓" : check.status === "manual" ? "•" : "✗"} ${check.name}: ${check.detail}${check.status === "fail" && check.fix ? `\n  Fix: ${check.fix}` : ""}`);
    console.log(ok ? "Local installation is healthy. Confirm editor_status and get_state in a new Codex task." : "Pixel Local is not fully ready yet; apply the fixes above.");
  }
  if (!ok) process.exitCode = 1;
};

main().catch((error) => { console.error(jsonOutput ? JSON.stringify({ ok: false, error: error.message }) : `Doctor failed: ${error.message}`); process.exitCode = 1; });
