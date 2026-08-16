#!/usr/bin/env node

import http from "node:http";
import process from "node:process";
import { WebSocketServer } from "ws";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PIXEL_LOCAL_BRIDGE_PORT || 43127);
const VERSION = 2;
const clients = new Map();
const tasks = new Map();
const pending = new Map();
let primaryClientId = null;

const setPrimary = (clientId) => {
  primaryClientId = clientId;
  for (const client of clients.values()) {
    if (client.socket.readyState === 1) client.socket.send(JSON.stringify({ type: "primary", primary: client.clientId === primaryClientId }));
  }
};

const json = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" });
  response.end(JSON.stringify(value));
};
const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (error) { reject(error); } });
  request.on("error", reject);
});
const publicClient = (client) => ({ clientId: client.clientId, projectId: client.projectId, title: client.title, url: client.url, ready: client.ready, revision: client.revision, lastSeen: client.lastSeen, primary: client.clientId === primaryClientId });
const activeClients = () => [...clients.values()].filter((client) => client.socket.readyState === 1 && Date.now() - client.lastSeenMs < 30_000);
const pickClient = ({ clientId, projectId } = {}) => {
  const active = activeClients();
  if (clientId) return active.find((client) => client.clientId === clientId);
  if (projectId) {
    const matches = active.filter((client) => client.projectId === projectId);
    if (matches.length !== 1) throw new Error(matches.length ? "Multiple tabs have this project open; select one exact clientId." : "No connected editor has this projectId.");
    return matches[0];
  }
  return active.find((client) => client.clientId === primaryClientId);
};
const pruneTasks = () => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, task] of tasks) if (task.updatedAtMs < cutoff) tasks.delete(id);
};

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return json(response, 204, {});
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, version: VERSION, ready: Boolean(pickClient()), primaryClientId, connectedClients: activeClients().map(publicClient) });
    }
    if (request.method === "POST" && url.pathname === "/primary") {
      const body = await readBody(request);
      const client = activeClients().find((item) => item.clientId === body.clientId);
      if (!client) return json(response, 404, { ok: false, error: "That editor tab is not connected." });
      setPrimary(client.clientId);
      return json(response, 200, { ok: true, primary: publicClient(client) });
    }
    if (request.method === "GET" && url.pathname.startsWith("/tasks/")) {
      const id = decodeURIComponent(url.pathname.slice(7));
      const task = tasks.get(id);
      return task ? json(response, 200, task) : json(response, 404, { ok: false, error: "Unknown requestId" });
    }
    if (request.method === "POST" && url.pathname === "/rpc") {
      pruneTasks();
      const body = await readBody(request);
      if (!body.requestId || !body.action) return json(response, 400, { ok: false, error: "requestId and action are required." });
      const existing = tasks.get(body.requestId);
      if (existing) {
        if (existing.status === "succeeded") return json(response, 200, existing);
        if (existing.status === "failed") return json(response, 409, existing);
        return json(response, 202, existing);
      }
      const client = pickClient(body);
      if (!client) return json(response, 503, { ok: false, error: "No primary editor is connected. Select a primary canvas first." });
      if (!client.ready) return json(response, 503, { ok: false, error: "The selected editor is connected but not ready." });
      if (body.action !== "getState" && Number.isInteger(body.expectedRevision) && body.expectedRevision !== client.revision) {
        return json(response, 409, { ok: false, error: `Revision conflict: expected ${body.expectedRevision}, current ${client.revision}. Read state again before writing.`, revision: client.revision });
      }
      const task = { ok: true, requestId: body.requestId, status: "running", action: body.action, clientId: client.clientId, projectId: client.projectId, createdAt: new Date().toISOString(), updatedAtMs: Date.now() };
      tasks.set(body.requestId, task);
      const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 30_000, 1_000), 120_000);
      const timer = setTimeout(() => {
        pending.delete(body.requestId);
        Object.assign(task, { ok: false, status: "failed", error: "Editor response timed out.", updatedAtMs: Date.now() });
        json(response, 504, task);
      }, timeoutMs);
      pending.set(body.requestId, { response, timer, task });
      client.socket.send(JSON.stringify({ type: "task", requestId: body.requestId, action: body.action, payload: body.payload || {}, expectedRevision: body.expectedRevision }));
      return;
    }
    return json(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return json(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const websocket = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url || "/", `http://${HOST}:${PORT}`).pathname !== "/editor") return socket.destroy();
  websocket.handleUpgrade(request, socket, head, (ws) => websocket.emit("connection", ws));
});
websocket.on("connection", (socket) => {
  let clientId = null;
  socket.on("message", (raw) => {
    let message; try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.type === "hello") {
      clientId = String(message.clientId || "");
      if (!clientId) return socket.close(1008, "clientId required");
      const client = { clientId, projectId: String(message.projectId || "unknown"), title: String(message.title || "Pixel Local"), url: String(message.url || ""), ready: Boolean(message.ready), revision: Number(message.revision) || 0, lastSeen: new Date().toISOString(), lastSeenMs: Date.now(), socket };
      clients.set(clientId, client);
      if (!primaryClientId || !activeClients().some((item) => item.clientId === primaryClientId)) setPrimary(clientId);
      socket.send(JSON.stringify({ type: "welcome", version: VERSION, primary: primaryClientId === clientId }));
      return;
    }
    const client = clientId && clients.get(clientId);
    if (!client) return;
    client.lastSeenMs = Date.now(); client.lastSeen = new Date().toISOString();
    if (message.type === "heartbeat" || message.type === "status") {
      client.ready = Boolean(message.ready); client.revision = Number(message.revision) || 0;
      return;
    }
    if (message.type === "result") {
      const entry = pending.get(message.requestId);
      if (!entry || entry.task.clientId !== clientId) return;
      clearTimeout(entry.timer); pending.delete(message.requestId);
      client.revision = Number(message.revision) || client.revision;
      Object.assign(entry.task, message.error ? { ok: false, status: "failed", error: message.error } : { ok: true, status: "succeeded", result: message.result }, { revision: client.revision, updatedAtMs: Date.now() });
      json(entry.response, message.error ? 409 : 200, entry.task);
    }
  });
  socket.on("close", () => {
    if (clientId && clients.get(clientId)?.socket === socket) clients.delete(clientId);
    if (clientId === primaryClientId) setPrimary(activeClients()[0]?.clientId || null);
  });
});

server.listen(PORT, HOST, () => process.stderr.write(`Pixel Local bridge v${VERSION} listening on http://${HOST}:${PORT}\n`));
const shutdown = () => {
  for (const client of clients.values()) client.socket.close(1001, "Plugin runtime stopping");
  websocket.close();
  server.close();
  const forceExit = setTimeout(() => process.exit(0), 500);
  forceExit.unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
