#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectDir, "扩展程序");
const checks = [];

const check = async (name, run, fix) => {
  try {
    const detail = await run();
    checks.push({ name, ok: true, detail });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error), fix });
  }
};

await check("manifest", async () => {
  const manifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
  if (manifest.background?.service_worker !== "background.js") throw new Error("background service worker is missing");
  return `${manifest.name} ${manifest.version}`;
}, "Run npm run build:extension.");

await check("editor", async () => {
  await access(path.join(outputDir, "index.html"));
  await access(path.join(outputDir, "assets", "index.js"));
  return path.join(outputDir, "index.html");
}, "Run npm run build:extension.");

await check("bridge-config", async () => {
  const manifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
  const csp = String(manifest.content_security_policy?.extension_pages || "");
  if (!csp.includes("ws://127.0.0.1:43127")) throw new Error("Bridge WebSocket is absent from extension CSP");
  return "optional Bridge origin allowed";
}, "Restore the Pixel Local Bridge CSP entry.");

for (const item of checks) {
  console.log(`${item.ok ? "✓" : "✗"} ${item.name}: ${item.detail}`);
  if (!item.ok) console.log(`  Fix: ${item.fix}`);
}

if (checks.some((item) => !item.ok)) process.exitCode = 1;
else console.log("Pixel Local extension build is ready to load from 扩展程序/.");
