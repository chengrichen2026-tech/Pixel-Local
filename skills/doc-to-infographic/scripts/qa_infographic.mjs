#!/usr/bin/env node
/** Run fast per-artifact QA or full template regression in one browser session. */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

const parseArgs = (argv) => {
  const result = { mode: "fast", width: 3072, quality: 95, secondWidth: 1600, secondQuality: 88, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      result.force = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    index += 1;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[key] = value;
  }
  return result;
};

const integer = (value, field, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}`);
  }
  return parsed;
};

const loadPlaywright = () => {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright"];
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (globalRoot) candidates.push(path.join(globalRoot, "playwright"));
  } catch {}
  candidates.push(path.join(os.homedir(), ".local", "lib", "node_modules", "playwright"));
  for (const candidate of candidates.filter(Boolean)) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error("Playwright was not found. Install it or set PLAYWRIGHT_PATH to the playwright package directory.");
};

const jpegDimensions = (filePath) => {
  const data = readFileSync(filePath);
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error(`Not a valid JPEG: ${filePath}`);
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 1 >= data.length) break;
    const length = data.readUInt16BE(offset);
    if (sofMarkers.has(marker)) {
      return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
    }
    if (length < 2) break;
    offset += length;
  }
  throw new Error(`JPEG dimensions were not found: ${filePath}`);
};

const pngDimensions = (filePath) => {
  const data = readFileSync(filePath);
  const signature = "89504e470d0a1a0a";
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== signature) throw new Error(`Not a valid PNG: ${filePath}`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

const ensureWritable = (filePath, force) => {
  if (!filePath) return;
  if (existsSync(filePath) && !force) throw new Error(`Output exists; use a new path or --force: ${filePath}`);
  mkdirSync(path.dirname(filePath), { recursive: true });
};

const args = parseArgs(process.argv.slice(2));
if (!args.html || !args.outputJpg) throw new Error("--html and --output-jpg are required");
if (!new Set(["fast", "full"]).has(args.mode)) throw new Error("--mode must be fast or full");
const htmlPath = path.resolve(args.html);
const outputJpg = path.resolve(args.outputJpg);
const qaPng = args.qaPng ? path.resolve(args.qaPng) : null;
const savedHtml = args.savedHtml ? path.resolve(args.savedHtml) : null;
const secondJpg = args.secondJpg ? path.resolve(args.secondJpg) : null;
const width = integer(args.width, "--width", 512, 8192);
const quality = integer(args.quality, "--quality", 70, 100);
const secondWidth = integer(args.secondWidth, "--second-width", 512, 8192);
const secondQuality = integer(args.secondQuality, "--second-quality", 70, 100);
if (!existsSync(htmlPath)) throw new Error(`HTML does not exist: ${htmlPath}`);
if (args.mode === "full" && (!savedHtml || !secondJpg)) throw new Error("full mode requires --saved-html and --second-jpg");
[outputJpg, qaPng, savedHtml, secondJpg].forEach((filePath) => ensureWritable(filePath, args.force));

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });

const openEditable = async (filePath) => {
  const page = await context.newPage();
  await page.goto(`${pathToFileURL(filePath).href}?force-edit=1`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.html2canvas === "function");
  await page.waitForSelector("body.editing");
  return page;
};

const exportJpg = async (page, destination, exportWidth, exportQuality) => {
  await page.fill("#export-width", String(exportWidth));
  await page.fill("#jpg-quality", String(exportQuality));
  const expectedHeight = await page.evaluate((selectedWidth) => {
    const poster = document.getElementById("poster");
    return Math.round(selectedWidth * poster.offsetHeight / poster.offsetWidth);
  }, exportWidth);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    page.click("#export-jpg"),
  ]);
  await download.saveAs(destination);
  const dimensions = jpegDimensions(destination);
  if (dimensions.width !== exportWidth || dimensions.height !== expectedHeight) {
    throw new Error(`Unexpected JPEG dimensions: got ${dimensions.width}x${dimensions.height}, expected ${exportWidth}x${expectedHeight}`);
  }
  return { ...dimensions, quality: exportQuality };
};

const results = { mode: args.mode, html: htmlPath };
let page;
try {
  page = await openEditable(htmlPath);
  results.browser = await browser.version();
  results.fitLabel = await page.locator("#zoom-label").textContent();
  await page.click("#zoom-100");
  results.canvas = await page.evaluate(() => {
    const poster = document.getElementById("poster");
    return { width: poster.offsetWidth, height: poster.offsetHeight };
  });
  if (results.canvas.width !== 1536) throw new Error(`Base canvas width must be 1536, got ${results.canvas.width}`);

  if (qaPng) {
    const toolbar = page.locator(".editor-toolbar");
    await toolbar.evaluate((node) => { node.style.display = "none"; });
    await page.locator("#poster").screenshot({ path: qaPng, type: "png", animations: "disabled" });
    await toolbar.evaluate((node) => { node.style.display = ""; });
    results.qaPng = { path: qaPng, ...pngDimensions(qaPng) };
    if (results.qaPng.width !== results.canvas.width || results.qaPng.height !== results.canvas.height) {
      throw new Error(`Unexpected QA PNG dimensions: ${results.qaPng.width}x${results.qaPng.height}`);
    }
  }

  if (args.mode === "full") {
    const scrollMetrics = await page.evaluate(() => ({
      horizontal: document.body.scrollWidth > document.body.clientWidth,
      vertical: document.body.scrollHeight > document.body.clientHeight,
    }));
    if (!scrollMetrics.horizontal || !scrollMetrics.vertical) throw new Error(`Scrolling QA failed: ${JSON.stringify(scrollMetrics)}`);
    results.scrollMetrics = scrollMetrics;

    await page.evaluate(() => {
      document.body.scrollLeft = 120;
      document.body.scrollTop = 120;
    });
    const panBefore = await page.evaluate(() => ({ left: document.body.scrollLeft, top: document.body.scrollTop }));
    await page.keyboard.down("Space");
    await page.mouse.move(420, 460);
    await page.mouse.down();
    await page.mouse.move(320, 360, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const panAfter = await page.evaluate(() => ({ left: document.body.scrollLeft, top: document.body.scrollTop }));
    if (panAfter.left <= panBefore.left || panAfter.top <= panBefore.top) {
      throw new Error(`Space-drag panning QA failed: ${JSON.stringify({ panBefore, panAfter })}`);
    }
    results.panning = { before: panBefore, after: panAfter };

    const headline = page.locator(".headline");
    const originalHeadline = await headline.textContent();
    await headline.fill(`${originalHeadline}·QA`);
    await page.waitForTimeout(350);
    const autosave = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("doc-to-infographic-live-edit:") && !item.endsWith(":zoom"));
      return { key, payload: key ? localStorage.getItem(key) : null };
    });
    if (!autosave.payload?.includes("·QA")) throw new Error("Local autosave did not persist edited DOM text");
    await headline.fill(originalHeadline);
    await page.waitForTimeout(350);
    results.autosaveKey = autosave.key;

    await page.click("#toggle-edit");
    if (await page.locator("body").evaluate((node) => node.classList.contains("editing"))) throw new Error("Preview mode did not disable editing");
    await page.click("#toggle-edit");
  }

  results.finalJpg = { path: outputJpg, ...(await exportJpg(page, outputJpg, width, quality)) };

  if (args.mode === "full") {
    await page.evaluate(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }));
    const [htmlDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.click("#download-html"),
    ]);
    await htmlDownload.saveAs(savedHtml);
    await page.close();
    page = await openEditable(savedHtml);
    const vendorSrc = await page.locator('script[data-vendor="html2canvas-1.4.1"]').getAttribute("src");
    if (!vendorSrc?.startsWith("file://")) throw new Error(`Saved HTML vendor path is not absolute: ${vendorSrc}`);
    results.savedHtml = { path: savedHtml, vendorSrc };
    results.secondJpg = { path: secondJpg, ...(await exportJpg(page, secondJpg, secondWidth, secondQuality)) };
  }
} finally {
  await page?.close().catch(() => {});
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
