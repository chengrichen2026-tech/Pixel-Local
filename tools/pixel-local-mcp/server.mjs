#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const BRIDGE_URL = process.env.PIXEL_LOCAL_BRIDGE_URL || "http://127.0.0.1:43127";
const EDITOR_URL = process.env.PIXEL_LOCAL_EDITOR_URL || "http://localhost:3000/";

const bridgeRequest = async (pathname, options = {}) => {
  let response;
  try {
    response = await fetch(`${BRIDGE_URL}${pathname}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw new Error("Pixel Local bridge is not running. Start it with npm run bridge:start or install its launchd service.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Pixel Local bridge request failed: ${response.status}`);
  return body;
};

const callEditor = async (action, payload = {}, options = {}) => {
  const requestId = options.requestId || crypto.randomUUID();
  return bridgeRequest("/rpc", {
    method: "POST",
    body: JSON.stringify({
      action,
      payload,
      requestId,
      clientId: options.clientId,
      projectId: options.projectId,
      expectedRevision: options.expectedRevision,
      timeoutMs: options.timeoutMs,
    }),
  });
};

const targetProperties = {
  clientId: { type: "string", description: "Optional exact editor tab id." },
  projectId: { type: "string", description: "Optional exact Pixel Local project id." },
};
const tools = [
  { name: "open_editor", description: "Open Pixel Local in the default browser. Pass extensionId to open the MV3 extension; otherwise the configured localhost editor is used.", inputSchema: { type: "object", properties: { extensionId: { type: "string", pattern: "^[a-p]{32}$", description: "Optional installed Chrome extension id." } }, additionalProperties: false } },
  { name: "editor_status", description: "Check the persistent bridge, connected editors, primary canvas and readiness.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "select_editor", description: "Select the only editor tab that automation may control by clientId.", inputSchema: { type: "object", properties: { clientId: { type: "string" } }, required: ["clientId"], additionalProperties: false } },
  { name: "get_task", description: "Read a previous request result before retrying after a timeout.", inputSchema: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"], additionalProperties: false } },
  { name: "get_state", description: "Read the selected Pixel Local canvas and its revision.", inputSchema: { type: "object", properties: targetProperties, additionalProperties: false } },
  { name: "execute", description: "Execute Pixel Local commands atomically and idempotently.", inputSchema: { type: "object", properties: { commands: { oneOf: [{ type: "object" }, { type: "array", items: { type: "object" }, minItems: 1 }] }, requestId: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 }, ...targetProperties }, required: ["commands", "requestId", "expectedRevision"], additionalProperties: false } },
  { name: "export_frame", description: "Export a frame from the selected canvas to an absolute local path.", inputSchema: { type: "object", properties: { frameId: { type: "string" }, outputPath: { type: "string" }, format: { type: "string", enum: ["png", "jpg"] }, multiplier: { type: "number", minimum: 0.1, maximum: 8 }, requestId: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 }, ...targetProperties }, required: ["frameId", "outputPath", "requestId", "expectedRevision"], additionalProperties: false } },
];

const textResult = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });

const callTool = async (name, args) => {
  if (name === "open_editor") {
    const url = args.extensionId ? `chrome-extension://${args.extensionId}/index.html` : EDITOR_URL;
    const command = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    const child = spawn(command[0], command[1], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return textResult({ ok: true, url });
  }
  if (name === "editor_status") return textResult(await bridgeRequest("/health"));
  if (name === "select_editor") return textResult(await bridgeRequest("/primary", { method: "POST", body: JSON.stringify({ clientId: args.clientId }) }));
  if (name === "get_task") return textResult(await bridgeRequest(`/tasks/${encodeURIComponent(args.requestId)}`));
  const target = { clientId: args.clientId, projectId: args.projectId };
  if (name === "get_state") return textResult(await callEditor("getState", {}, target));
  if (name === "execute") return textResult(await callEditor("execute", { commands: args.commands }, { ...target, requestId: args.requestId, expectedRevision: args.expectedRevision }));
  if (name === "export_frame") {
    if (!path.isAbsolute(args.outputPath)) throw new Error("outputPath must be absolute");
    const response = await callEditor("exportFrame", { frameId: args.frameId, format: args.format || "png", multiplier: args.multiplier || 1 }, { ...target, requestId: args.requestId, expectedRevision: args.expectedRevision, timeoutMs: 60_000 });
    const match = String(response.result?.dataUrl || "").match(/^data:image\/(?:png|jpeg);base64,(.+)$/);
    if (!match) throw new Error("Editor returned an invalid image Data URL");
    await mkdir(path.dirname(args.outputPath), { recursive: true });
    await writeFile(args.outputPath, Buffer.from(match[1], "base64"));
    return textResult({ ok: true, requestId: args.requestId, outputPath: args.outputPath, bytes: Buffer.byteLength(match[1], "base64"), revision: response.revision });
  }
  throw new Error(`Unknown tool: ${name}`);
};

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let request; try { request = JSON.parse(line); } catch { continue; }
    if (request.method === "notifications/initialized") continue;
    if (request.method === "initialize") { send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params?.protocolVersion || "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "pixel-local-editor", version: "2.0.0" } } }); continue; }
    if (request.method === "ping") { send({ jsonrpc: "2.0", id: request.id, result: {} }); continue; }
    if (request.method === "tools/list") { send({ jsonrpc: "2.0", id: request.id, result: { tools } }); continue; }
    if (request.method === "tools/call") {
      try { send({ jsonrpc: "2.0", id: request.id, result: await callTool(request.params?.name, request.params?.arguments || {}) }); }
      catch (error) { send({ jsonrpc: "2.0", id: request.id, result: textResult(error instanceof Error ? error.message : String(error), true) }); }
      continue;
    }
    if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } });
  }
});
