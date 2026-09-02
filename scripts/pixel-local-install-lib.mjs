import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const platform = () => process.env.PIXEL_LOCAL_PLATFORM || process.platform;
export const codexHome = () => path.resolve(process.env.PIXEL_LOCAL_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
export const configPath = () => path.resolve(process.env.PIXEL_LOCAL_CONFIG_PATH || path.join(codexHome(), "config.toml"));
export const skillTarget = () => path.resolve(process.env.PIXEL_LOCAL_SKILL_DIR || path.join(codexHome(), "skills", "pixel-local-editor"));
export const skillSource = () => path.join(PROJECT_DIR, "ops", "pixel-local", "skill");
export const mcpServerPath = () => path.join(PROJECT_DIR, "tools", "pixel-local-mcp", "server.mjs");
export const bridgeUrl = () => process.env.PIXEL_LOCAL_BRIDGE_URL || "http://127.0.0.1:43127";
export const editorUrl = () => process.env.PIXEL_LOCAL_EDITOR_URL || "http://localhost:3000";
export const launchAgentPath = () => path.resolve(process.env.PIXEL_LOCAL_LAUNCH_AGENT_PATH || path.join(os.homedir(), "Library", "LaunchAgents", "com.pixel-local.bridge.plist"));

export const exists = async (target) => access(target).then(() => true, () => false);
export const nodeVersionOk = () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
};
export const dependenciesReady = () => exists(path.join(PROJECT_DIR, "node_modules", "vinext", "package.json"));

export const extensionIdFromConfig = (source) => String(source || "").match(/PIXEL_LOCAL_EXTENSION_ID\s*=\s*"([a-p]{32})"/)?.[1] || "";
export const mcpBlock = (extensionId = "") => [
  "[mcp_servers.pixel-local-editor]",
  'command = "node"',
  `args = [${JSON.stringify(mcpServerPath())}]`,
  `env = { PIXEL_LOCAL_DEFAULT_TARGET = "extension"${extensionId ? `, PIXEL_LOCAL_EXTENSION_ID = ${JSON.stringify(extensionId)}` : ""} }`,
].join("\n");

export const updateMcpConfig = (source, options = {}) => {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const header = "[mcp_servers.pixel-local-editor]";
  const start = lines.findIndex((line) => line.trim() === header);
  const extensionId = options.extensionId || extensionIdFromConfig(source);
  const replacement = mcpBlock(extensionId).split("\n");
  if (start < 0) {
    const base = lines.join("\n").trimEnd();
    return `${base}${base ? "\n\n" : ""}${mcpBlock(extensionId)}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[end])) end += 1;
  lines.splice(start, end - start, ...replacement, "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
};

const fileHash = async (target) => createHash("sha256").update(await readFile(target)).digest("hex");
export const skillIsSynchronized = async () => {
  const pairs = [
    [path.join(skillSource(), "SKILL.md"), path.join(skillTarget(), "SKILL.md")],
    [path.join(skillSource(), "agents", "openai.yaml"), path.join(skillTarget(), "agents", "openai.yaml")],
    [path.join(skillSource(), "scripts", "check_bridge.mjs"), path.join(skillTarget(), "scripts", "check_bridge.mjs")],
    [path.join(PROJECT_DIR, "COMMAND_API.md"), path.join(skillTarget(), "references", "command-api.md")],
  ];
  for (const [source, target] of pairs) {
    if (!(await exists(target)) || await fileHash(source) !== await fileHash(target)) return false;
  }
  return true;
};

export const installSkill = async () => {
  await mkdir(skillTarget(), { recursive: true });
  await cp(skillSource(), skillTarget(), { recursive: true, force: true });
  await mkdir(path.join(skillTarget(), "references"), { recursive: true });
  await cp(path.join(PROJECT_DIR, "COMMAND_API.md"), path.join(skillTarget(), "references", "command-api.md"), { force: true });
};

export const backupAndWriteConfig = async (options = {}) => {
  const target = configPath();
  const hadConfig = await exists(target);
  const before = hadConfig ? await readFile(target, "utf8") : "";
  const after = updateMcpConfig(before, options);
  if (before === after) return { changed: false, backup: null, target };
  await mkdir(path.dirname(target), { recursive: true });
  let backup = null;
  if (hadConfig) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = `${target}.backup-${stamp}`;
    await cp(target, backup, { force: false });
  }
  if (platform() === "win32") await writeFile(target, after, { encoding: "utf8", mode: 0o600 });
  else {
    const temporary = `${target}.pixel-local-${process.pid}.tmp`;
    await writeFile(temporary, after, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }
  return { changed: true, backup, target };
};

export const fetchStatus = async (url, responseType = null) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, status: response.status,
      ...(responseType === "json" || responseType === true ? { body: await response.json() } : {}),
      ...(responseType === "text" ? { body: await response.text() } : {}),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timer); }
};

export const editorStatus = async () => {
  const response = await fetchStatus(editorUrl(), "text");
  const identity = Boolean(response.ok && /Pixel Local|本地图片编辑器/.test(response.body || ""));
  return { ...response, ok: Boolean(response.ok && identity), identity };
};

export const listBackups = async () => {
  const directory = path.dirname(configPath());
  if (!(await exists(directory))) return [];
  const prefix = `${path.basename(configPath())}.backup-`;
  return (await readdir(directory)).filter((name) => name.startsWith(prefix)).sort();
};
