#!/usr/bin/env node

import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  PROJECT_DIR, backupAndWriteConfig, configPath, dependenciesReady,
  bridgeUrl, editorStatus, editorUrl, fetchStatus, installSkill, nodeVersionOk, platform, skillIsSynchronized, skillTarget,
} from "./pixel-local-install-lib.mjs";
import { ensureManagedBridge } from "./pixel-local-bridge-process.mjs";

const argv = process.argv.slice(2);
const args = new Set(argv);
const apply = args.has("--apply");
const extensionIdArg = argv.find((value) => value.startsWith("--extension-id="))?.split("=")[1] || (argv.includes("--extension-id") ? argv[argv.indexOf("--extension-id") + 1] : "");
if (extensionIdArg && !/^[a-p]{32}$/.test(extensionIdArg)) throw new Error("--extension-id must be the 32-letter Chrome extension id.");
if (args.has("--help")) {
  console.log("Usage: npm run setup:codex -- [--apply] [--extension-id <id>] [--with-localhost]\nThe Chrome extension is the default editor; --with-localhost also starts the development server.");
  process.exit(0);
}

const npmCommand = platform() === "win32" ? "npm.cmd" : "npm";
const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { cwd: PROJECT_DIR, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed`);
};

const startEditor = async () => {
  if ((await editorStatus()).ok) return "already running";
  if (process.env.PIXEL_LOCAL_SKIP_EDITOR === "1") return "skipped by environment";
  const runtime = path.join(PROJECT_DIR, ".runtime");
  await mkdir(runtime, { recursive: true });
  const log = openSync(path.join(runtime, "editor.log"), "a");
  const child = spawn(npmCommand, ["run", "dev"], { cwd: PROJECT_DIR, detached: true, stdio: ["ignore", log, log], windowsHide: true });
  child.unref(); closeSync(log);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if ((await editorStatus()).ok) return "started";
  }
  throw new Error(`Editor did not become available at ${editorUrl()}. Run npm run dev and inspect .runtime/editor.log.`);
};

const main = async () => {
  console.log(`Pixel Local Codex setup (${apply ? "APPLY" : "DRY-RUN"})`);
  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`OS: ${platform()} | Node: ${process.versions.node}${nodeVersionOk() ? "" : " (requires >=22.13)"}`);
  if (!nodeVersionOk()) throw new Error("Node.js 22.13 or newer is required.");
  const dependencies = await dependenciesReady();
  console.log(`Dependencies: ${dependencies ? "ready" : apply ? "will install with npm ci" : "missing; npm ci would run"}`);
  console.log(`Skill target: ${skillTarget()}${await skillIsSynchronized() ? " (already synchronized)" : ""}`);
  console.log(`MCP config: ${configPath()}`);
  console.log(`Bridge: ${platform() === "darwin" ? "macOS LaunchAgent" : "project-managed background process"}`);
  console.log(`Default editor: Chrome extension${extensionIdArg ? ` (${extensionIdArg})` : " (discover from connected PL canvas)"}`);
  if (!apply) {
    console.log("No changes made. Re-run with --apply to install.");
    return;
  }
  if (!dependencies && process.env.PIXEL_LOCAL_SKIP_DEPENDENCIES !== "1") run(npmCommand, ["ci"]);
  await installSkill();
  const config = await backupAndWriteConfig({ extensionId: extensionIdArg });
  console.log(config.changed ? `MCP config updated${config.backup ? `; backup: ${config.backup}` : ""}.` : "MCP config already current.");
  const bridgeHealthy = (await fetchStatus(`${bridgeUrl()}/health`, "json")).ok;
  if (platform() === "darwin" && process.env.PIXEL_LOCAL_SKIP_SERVICE !== "1" && !bridgeHealthy) run("zsh", ["scripts/pixel-local-bridge-launchd.sh", "install"]);
  else if (platform() === "darwin" && bridgeHealthy) console.log("Bridge already healthy; existing LaunchAgent reused.");
  else if (platform() !== "darwin" && process.env.PIXEL_LOCAL_SKIP_BRIDGE !== "1") {
    const bridge = await ensureManagedBridge();
    console.log(bridge.started ? `Bridge started in background (PID ${bridge.pid}); log: ${bridge.logFile}` : "Bridge already healthy; no duplicate process started.");
  }
  else if (platform() !== "darwin") console.log("Bridge background start skipped by environment.");
  else console.log("Bridge service installation skipped by environment.");
  if (args.has("--with-localhost")) console.log(`Development editor ${await startEditor()}.`);
  else console.log("Development localhost editor skipped; open the PL Chrome extension.");
  console.log("Installation files are ready. Close and reopen Codex or create a new Codex task, then run: npm run doctor");
  console.log("The final in-task check is editor_status followed by get_state on the real canvas.");
};

main().catch((error) => { console.error(`Setup failed: ${error.message}`); process.exitCode = 1; });
