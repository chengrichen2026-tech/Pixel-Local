"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ActiveSelection, Canvas, Control, FabricImage, FabricObject, FabricText, Group, Point, Rect, Shadow, Textbox, controlsUtils, util } from "fabric";
import { IconAlignCenter, IconAlignLeft, IconAlignRight, IconChevronDown, IconChevronRight, IconDeviceFloppy, IconDownload, IconEye, IconEyeOff, IconFile, IconFolder, IconFolderOpen, IconFolderPlus, IconFrame, IconLayoutAlignBottom, IconLayoutAlignCenter, IconLayoutAlignLeft, IconLayoutAlignMiddle, IconLayoutAlignRight, IconLayoutAlignTop, IconMask, IconPhoto, IconPlus, IconRefresh, IconSquare, IconTrash, IconTypography } from "@tabler/icons-react";

type EditorPage = { id: string; name: string; hidden?: boolean };
type ObjectMeta = FabricObject & { id?: string; name?: string; kind?: string; frameId?: string; pageId?: string; maskGroupId?: string; maskShapeId?: string; maskShapeName?: string; hidden?: boolean; nameFollowsText?: boolean; gridPreset?: string; lastLeft?: number; lastTop?: number; lastScaleX?: number; lastScaleY?: number; maskLeft?: number; maskTop?: number; maskWidth?: number; maskHeight?: number; maskRadius?: number; maskFill?: string; maskStroke?: string; maskStrokeWidth?: number };
type SelectedInfo = { id: string; type: string; name: string; x: number; y: number; text?: string; fontFamily?: string; fontStyle?: string; fontWeight?: number | string; fontSize?: number; charSpacing?: number; lineHeight?: number; textAlign?: string; fill?: string; stroke?: string; strokeWidth?: number; cornerRadius?: number; gridPreset?: string; shadowColor?: string; shadowBlur?: number; shadowOffsetX?: number; shadowOffsetY?: number; opacity: number; width: number; height: number } | null;
type ExportFormat = "png" | "jpg";
type LocalFontMetadata = { family: string; fullName?: string; postscriptName?: string; style?: string };
type LocalFontData = LocalFontMetadata & { blob: () => Promise<Blob> };
type FontVariant = { fontStyle: string; fontWeight: number; key: string; label: string };
type PixelProjectFile = { format: "pixel-local"; version: 1; exportedAt: string; pages: EditorPage[]; activePageId: string; canvas: unknown };
type PixelLocalCommand = { op: string; id?: string; pageId?: string; frameId?: string; name?: string; [key: string]: unknown };
type PixelLocalSnapshot = { version: 1; activePageId: string; pages: EditorPage[]; objects: Array<Record<string, unknown>>; sidebar: { collapsedFrameIds: string[] } };
type PixelLocalCommandResult = { ok: boolean; changedIds: string[]; warnings: string[]; snapshot: PixelLocalSnapshot; data?: Record<string, unknown>; error?: string };
type PixelLocalApi = { version: 1; getState: () => Promise<PixelLocalSnapshot>; execute: (commands: PixelLocalCommand | PixelLocalCommand[]) => Promise<PixelLocalCommandResult> };
type PixelLocalWindow = Window & { pixelLocal?: PixelLocalApi };
type FontAwareWindow = Window & { queryLocalFonts?: () => Promise<LocalFontData[]> };
type SerializedFabricValue = { clipPath?: unknown; kind?: unknown; objects?: SerializedFabricValue[]; type?: unknown; [key: string]: unknown };
type ClipPathContext = { width?: number; height?: number; cacheTranslationX?: number; cacheTranslationY?: number; zoomX?: number; zoomY?: number; parentClipPaths?: FabricObject[]; [key: string]: unknown };
type ClipPathPatchedPrototype = { createClipPathLayer?: (this: FabricObject, clipPath: FabricObject, context?: ClipPathContext) => unknown; __pixelLocalClipPatch?: boolean };
type FrameClipboardItem = { frame: ObjectMeta; children: ObjectMeta[] };
type FrameClipboard = { items: FrameClipboardItem[] };

const PROJECT_KEY = "pixel-local-project-v2";
const LEGACY_PROJECT_KEY = "pixel-local-project-v1";
const PAGES_KEY = "pixel-local-pages-v1";
const FONT_LIST_KEY = "pixel-local-fonts-v1";
const FONT_META_KEY = "pixel-local-font-meta-v1";
const FRAME_COLLAPSE_KEY = "pixel-local-collapsed-frame-ids-v1";
const DEFAULT_PAGE_ID = "page_default";
const MIN_CANVAS_ZOOM = 0.03;
const TRACKPAD_ZOOM_BASE = 0.99;
const TOUCH_PINCH_SENSITIVITY = 1.35;
const FRAME_PRESETS = [{ label: "方形", ratio: "1:1", width: 800, height: 800 }, { label: "竖版", ratio: "3:4", width: 750, height: 1000 }, { label: "竖屏", ratio: "9:16", width: 1080, height: 1920 }, { label: "横屏", ratio: "16:9", width: 1920, height: 1080 }];
const FALLBACK_FONTS = ["PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Arial", "Helvetica Neue", "Georgia", "Courier New", "Verdana"];
const FALLBACK_FONT_STYLES = ["Regular", "Light", "Medium", "Semibold", "Bold", "Italic", "Bold Italic"];

const readCollapsedFrameIds = () => {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const value = JSON.parse(localStorage.getItem(FRAME_COLLAPSE_KEY) || "[]");
    return new Set<string>(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set<string>(); }
};

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
const openLocalDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("pixel-local", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("data");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const localGet = async <T,>(key: string): Promise<T | undefined> => {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => { const request = db.transaction("data", "readonly").objectStore("data").get(key); request.onsuccess = () => resolve(request.result as T | undefined); request.onerror = () => reject(request.error); });
};
const localSet = async (key: string, value: unknown) => {
  const db = await openLocalDb();
  return new Promise<void>((resolve, reject) => { const transaction = db.transaction("data", "readwrite"); transaction.objectStore("data").put(value, key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
};
const isTransientSerializedObject = (value: SerializedFabricValue) => {
  const type = String(value.type || "").toLowerCase();
  const kind = String(value.kind || "").toLowerCase();
  return type === "activeselection" || kind === "activeselection" || kind === "frame-label" || kind === "grid-overlay" || kind === "drawing-preview" || kind === "mask-edit-overlay";
};
const cleanSerializedCanvasValue = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cleanSerializedCanvasValue).filter(Boolean);
  const object = value as SerializedFabricValue;
  if (isTransientSerializedObject(object)) return undefined;
  delete object.clipPath;
  if (Array.isArray(object.objects)) object.objects = object.objects.map(cleanSerializedCanvasValue).filter(Boolean) as SerializedFabricValue[];
  return object;
};
const sanitizeProjectJson = (json: string) => {
  try { return JSON.stringify(cleanSerializedCanvasValue(JSON.parse(json))); } catch { return json; }
};
const parseFontWeight = (fontWeight: number | string | undefined) => {
  if (typeof fontWeight === "number") return fontWeight;
  if (String(fontWeight).toLowerCase() === "bold") return 700;
  if (String(fontWeight).toLowerCase() === "normal") return 400;
  const numeric = Number(fontWeight);
  return Number.isFinite(numeric) ? numeric : 400;
};
const displayFontFamily = (text: Textbox & ObjectMeta) => String(text.fontFamily || FALLBACK_FONTS[0]);
const fontVariantFromStyle = (styleName = "Regular") => {
  const label = styleName.trim() || "Regular";
  const lower = label.toLowerCase();
  const fontStyle = lower.includes("italic") || lower.includes("oblique") ? "italic" : "normal";
  let fontWeight = 400;
  if (/(thin|hairline)/.test(lower)) fontWeight = 100;
  else if (/(extra|ultra)[ -]?light/.test(lower)) fontWeight = 200;
  else if (/light/.test(lower)) fontWeight = 300;
  else if (/regular|book|roman|normal|plain/.test(lower)) fontWeight = 400;
  else if (/medium/.test(lower)) fontWeight = 500;
  else if (/(semi|demi)[ -]?bold/.test(lower)) fontWeight = 600;
  else if (/(extra|ultra)[ -]?bold/.test(lower)) fontWeight = 800;
  else if (/bold/.test(lower)) fontWeight = 700;
  else if (/black|heavy/.test(lower)) fontWeight = 900;
  return { fontStyle, fontWeight, key: `${fontStyle}-${fontWeight}-${label}`, label };
};
const normalizeFontRecords = (records: LocalFontMetadata[]) => {
  const seen = new Set<string>();
  return records.map((record) => {
    const family = record.family?.trim();
    if (!family) return null;
    const fullName = record.fullName?.trim();
    const style = (record.style?.trim() || fullName?.replace(family, "").trim() || "Regular").replace(/^[-\s]+/, "") || "Regular";
    const next = { family, fullName, postscriptName: record.postscriptName?.trim(), style };
    const key = `${next.family}::${next.style}::${next.postscriptName || ""}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return next;
  }).filter(Boolean) as LocalFontMetadata[];
};
const ensureFabricClipPathContext = () => {
  const proto = FabricObject.prototype as unknown as ClipPathPatchedPrototype;
  if (!proto.createClipPathLayer || proto.__pixelLocalClipPatch) return;
  const original = proto.createClipPathLayer;
  proto.createClipPathLayer = function patchedCreateClipPathLayer(clipPath, context = {}) {
    const fallbackWidth = Math.max(1, Math.ceil(this.getScaledWidth?.() || this.width || 1));
    const fallbackHeight = Math.max(1, Math.ceil(this.getScaledHeight?.() || this.height || 1));
    const nextContext: ClipPathContext = {
      width: fallbackWidth,
      height: fallbackHeight,
      cacheTranslationX: 0,
      cacheTranslationY: 0,
      zoomX: 1,
      zoomY: 1,
      parentClipPaths: [],
      ...context,
    };
    if (!Array.isArray(nextContext.parentClipPaths)) nextContext.parentClipPaths = [];
    if (!Number.isFinite(nextContext.width)) nextContext.width = fallbackWidth;
    if (!Number.isFinite(nextContext.height)) nextContext.height = fallbackHeight;
    if (!Number.isFinite(nextContext.cacheTranslationX)) nextContext.cacheTranslationX = 0;
    if (!Number.isFinite(nextContext.cacheTranslationY)) nextContext.cacheTranslationY = 0;
    if (!Number.isFinite(nextContext.zoomX)) nextContext.zoomX = 1;
    if (!Number.isFinite(nextContext.zoomY)) nextContext.zoomY = 1;
    return original.call(this, clipPath, nextContext);
  };
  proto.__pixelLocalClipPatch = true;
};
ensureFabricClipPathContext();

export default function Home() {
  const htmlCanvas = useRef<HTMLCanvasElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const editor = useRef<Canvas | null>(null);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const restoring = useRef(false);
  const isPanning = useRef(false);
  const spacePressed = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const frameClipboard = useRef<FrameClipboard | null>(null);
  const framePresetCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFrameWorldOrigins = useRef(new Map<string, { left: number; top: number }>());
  const handlingMultiFrameMove = useRef(false);
  const textToolActiveRef = useRef(false);
  const rectangleToolActiveRef = useRef(false);
  const pagesRef = useRef<EditorPage[]>([{ id: DEFAULT_PAGE_ID, name: "页面 1" }]);
  const activePageIdRef = useRef(DEFAULT_PAGE_ID);
  const [selected, setSelected] = useState<SelectedInfo>(null);
  const [selectedFrameCount, setSelectedFrameCount] = useState(0);
  const [selectedLayerCount, setSelectedLayerCount] = useState(0);
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());
  const [selectedAncestorFrameIds, setSelectedAncestorFrameIds] = useState<Set<string>>(new Set());
  const [editingMaskGroupId, setEditingMaskGroupId] = useState<string | null>(null);
  const [layers, setLayers] = useState<FabricObject[]>([]);
  const [, setSavedState] = useState("已自动保存");
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dropLayerId, setDropLayerId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [layerNameDraft, setLayerNameDraft] = useState("");
  const [fontFamilies, setFontFamilies] = useState(FALLBACK_FONTS);
  const [localFontRecords, setLocalFontRecords] = useState<LocalFontMetadata[]>([]);
  const [fontLoadLabel, setFontLoadLabel] = useState("加载本机字体");
  const localFontDataRef = useRef<LocalFontData[]>([]);
  const registeredLocalFontFaces = useRef(new Set<string>());
  const [exportFormat, setExportFormat] = useState<ExportFormat>("jpg");
  const [pages, setPages] = useState<EditorPage[]>(pagesRef.current);
  const [activePageId, setActivePageId] = useState(DEFAULT_PAGE_ID);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageNameDraft, setPageNameDraft] = useState("");
  const [textToolActive, setTextToolActive] = useState(false);
  const [rectangleToolActive, setRectangleToolActive] = useState(false);
  const [framePresetOpen, setFramePresetOpen] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const collapsedFrameIdsRef = useRef<Set<string>>(new Set());
  const [collapsedFrameIds, setCollapsedFrameIds] = useState<Set<string>>(() => new Set());
  const [codexConnection, setCodexConnection] = useState("Codex 正在连接");

  const openFramePresetMenu = () => {
    if (framePresetCloseTimer.current) clearTimeout(framePresetCloseTimer.current);
    framePresetCloseTimer.current = null;
    setFramePresetOpen(true);
  };
  const scheduleFramePresetClose = () => {
    if (framePresetCloseTimer.current) clearTimeout(framePresetCloseTimer.current);
    framePresetCloseTimer.current = setTimeout(() => { setFramePresetOpen(false); framePresetCloseTimer.current = null; }, 220);
  };

  const updateCollapsedFrameIds = (next: Set<string>) => {
    collapsedFrameIdsRef.current = next;
    setCollapsedFrameIds(new Set(next));
    localStorage.setItem(FRAME_COLLAPSE_KEY, JSON.stringify([...next]));
  };

  useEffect(() => { updateCollapsedFrameIds(readCollapsedFrameIds()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (framePresetCloseTimer.current) clearTimeout(framePresetCloseTimer.current); }, []);

  const isTransientObject = (object: ObjectMeta) => {
    const type = String(object.type || "").toLowerCase();
    const kind = String(object.kind || "").toLowerCase();
    return type === "activeselection" || kind === "activeselection" || kind === "frame-label" || kind === "frame-selection-outline" || kind === "grid-overlay" || kind === "drawing-preview" || kind === "mask-edit-overlay";
  };
  const serialize = () => JSON.stringify(cleanSerializedCanvasValue(editor.current?.toObject(["id", "name", "kind", "frameId", "pageId", "maskGroupId", "hidden", "lastLeft", "lastTop", "lastScaleX", "lastScaleY", "maskShapeId", "maskShapeName", "maskLeft", "maskTop", "maskWidth", "maskHeight", "maskRadius", "maskFill", "maskStroke", "maskStrokeWidth"])));
  const frames = () => editor.current?.getObjects().filter((item) => { const meta = item as ObjectMeta; return !isTransientObject(meta) && meta.kind === "frame" && (meta.pageId || DEFAULT_PAGE_ID) === activePageIdRef.current; }) as ObjectMeta[] || [];
  const frameDesignWidth = (frame: ObjectMeta) => Math.round((frame.width || 0) * (frame.scaleX || 1));
  const frameDesignHeight = (frame: ObjectMeta) => Math.round((frame.height || 0) * (frame.scaleY || 1));
  const objectDesignWidth = (object: ObjectMeta) => object.kind === "frame" ? frameDesignWidth(object) : Math.round(object.getScaledWidth());
  const objectDesignHeight = (object: ObjectMeta) => object.kind === "frame" ? frameDesignHeight(object) : Math.round(object.getScaledHeight());
  const applyObjectSelectionStyle = (object: FabricObject) => object.set({ borderColor: "#6f3cff", borderScaleFactor: 1.4, cornerColor: "#fbfcff", cornerStrokeColor: "#6f3cff", cornerSize: 10, transparentCorners: false });
  const fitPageFrames = (pageId: string) => {
    const canvas = editor.current;
    if (!canvas) return;
    const pageFrames = canvas.getObjects().filter((item) => {
      const meta = item as ObjectMeta;
      return meta.kind === "frame" && (meta.pageId || DEFAULT_PAGE_ID) === pageId && !meta.hidden;
    }) as ObjectMeta[];
    if (!pageFrames.length) return;
    const left = Math.min(...pageFrames.map((frame) => frame.left));
    const top = Math.min(...pageFrames.map((frame) => frame.top));
    const right = Math.max(...pageFrames.map((frame) => frame.left + frameDesignWidth(frame)));
    const bottom = Math.max(...pageFrames.map((frame) => frame.top + frameDesignHeight(frame)));
    const width = Math.max(1, right - left); const height = Math.max(1, bottom - top);
    const padding = 96;
    const zoom = Math.max(MIN_CANVAS_ZOOM, Math.min(1, (canvas.width - padding * 2) / width, (canvas.height - padding * 2) / height));
    canvas.setViewportTransform([zoom, 0, 0, zoom, canvas.width / 2 - (left + width / 2) * zoom, canvas.height / 2 - (top + height / 2) * zoom]);
    syncAllFrameLabels();
  };
  const applyActivePageVisibility = () => {
    const canvas = editor.current;
    if (!canvas) return;
    const activePage = pagesRef.current.find((page) => page.id === activePageIdRef.current);
    const pageVisible = !activePage?.hidden;
    const active = canvas.getActiveObject() as ObjectMeta | undefined;
    const activeFrameIds = new Set(active instanceof ActiveSelection
      ? active.getObjects().filter((object) => (object as ObjectMeta).kind === "frame").map((object) => String((object as ObjectMeta).id))
      : active?.kind === "frame" ? [String(active.id)] : active?.frameId ? [String(active.frameId)] : []);
    canvas.getObjects().forEach((item) => {
      const meta = item as ObjectMeta;
      const belongs = (meta.pageId || DEFAULT_PAGE_ID) === activePageIdRef.current;
      const parentFrame = meta.frameId ? canvas.getObjects().find((candidate) => (candidate as ObjectMeta).id === meta.frameId) as ObjectMeta | undefined : undefined;
      const visible = belongs && pageVisible && !meta.hidden && !parentFrame?.hidden;
      const helper = isTransientObject(meta);
      const childEnabled = !meta.frameId || activeFrameIds.has(String(meta.frameId));
      item.set({ visible, selectable: helper ? false : visible && childEnabled, evented: helper ? false : visible && childEnabled });
    });
  };
  const normalizeFonts = (families: string[]) => Array.from(new Set([...FALLBACK_FONTS, ...families].map((font) => font.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const activeFontOptions = selected?.fontFamily && !fontFamilies.includes(selected.fontFamily) ? [selected.fontFamily, ...fontFamilies] : fontFamilies;
  const getFontVariants = (family: string) => {
    const localStyles = localFontRecords.filter((font) => font.family === family).map((font) => font.style || "Regular");
    const styles = localStyles.length ? localStyles : FALLBACK_FONT_STYLES;
    const seen = new Set<string>();
    return styles.map(fontVariantFromStyle).filter((variant) => {
      const key = `${variant.fontStyle}-${variant.fontWeight}-${variant.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const selectedFontVariants = selected?.fontFamily ? getFontVariants(selected.fontFamily) : [];
  const selectedFontVariantKey = selectedFontVariants.find((variant) => variant.fontStyle === (selected?.fontStyle || "normal") && variant.fontWeight === parseFontWeight(selected?.fontWeight))?.key || selectedFontVariants[0]?.key || "";

  const createFrameClip = (frame: ObjectMeta) => new Rect({
    left: frame.left, top: frame.top,
    width: frameDesignWidth(frame), height: frameDesignHeight(frame),
    fill: "#000000", strokeWidth: 0,
    originX: "left", originY: "top", absolutePositioned: true,
    objectCaching: true,
  });
  const applyMaskGroupClip = (group: ObjectMeta, frame?: ObjectMeta) => {
    const sourceLeft = Number(group.maskLeft || 0);
    const sourceTop = Number(group.maskTop || 0);
    const sourceWidth = Math.max(1, Number(group.maskWidth || 1));
    const sourceHeight = Math.max(1, Number(group.maskHeight || 1));
    const left = frame ? Math.max(sourceLeft, frame.left) : sourceLeft;
    const top = frame ? Math.max(sourceTop, frame.top) : sourceTop;
    const right = frame ? Math.min(sourceLeft + sourceWidth, frame.left + frameDesignWidth(frame)) : sourceLeft + sourceWidth;
    const bottom = frame ? Math.min(sourceTop + sourceHeight, frame.top + frameDesignHeight(frame)) : sourceTop + sourceHeight;
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const radius = Math.max(0, Math.min(Number(group.maskRadius || 0), width / 2, height / 2));
    const center = group.getCenterPoint();
    const scaleX = Math.max(.0001, Math.abs(group.scaleX || 1));
    const scaleY = Math.max(.0001, Math.abs(group.scaleY || 1));
    const mask = new Rect({
      left: (left + width / 2 - center.x) / scaleX,
      top: (top + height / 2 - center.y) / scaleY,
      width: width / scaleX, height: height / scaleY,
      rx: radius / scaleX, ry: radius / scaleY, fill: "#000000", strokeWidth: 0,
      originX: "center", originY: "center", objectCaching: true,
    });
    group.set({ objectCaching: true, dirty: true });
    group.clipPath = mask;
    group.frameId = frame?.id;
  };
  const syncMaskFromOverlay = (overlay: Rect & ObjectMeta) => {
    const canvas = editor.current;
    const group = canvas?.getObjects().find((item) => (item as ObjectMeta).id === overlay.maskGroupId) as ObjectMeta | undefined;
    if (!canvas || !group || group.kind !== "mask-group") return;
    const width = Math.max(1, overlay.width * overlay.scaleX);
    const height = Math.max(1, overlay.height * overlay.scaleY);
    const radius = Math.max(0, Math.min(Number(overlay.rx || 0) * Math.min(overlay.scaleX, overlay.scaleY), width / 2, height / 2));
    overlay.set({ width, height, scaleX: 1, scaleY: 1, rx: radius, ry: radius, dirty: true });
    overlay.setCoords();
    Object.assign(group, { maskLeft: overlay.left, maskTop: overlay.top, maskWidth: width, maskHeight: height, maskRadius: radius });
    const frame = group.frameId ? frames().find((item) => item.id === group.frameId) : undefined;
    applyMaskGroupClip(group, frame);
    canvas.requestRenderAll();
  };
  const editMaskShape = (group: Group & ObjectMeta) => {
    const canvas = editor.current;
    if (!canvas || group.kind !== "mask-group") return;
    canvas.discardActiveObject();
    canvas.getObjects().filter((item) => (item as ObjectMeta).kind === "mask-edit-overlay").forEach((item) => canvas.remove(item));
    const frame = group.frameId ? frames().find((item) => item.id === group.frameId) : findContainingFrame(group);
    const sourceWidth = Math.max(1, Number(group.maskWidth || 1));
    const sourceHeight = Math.max(1, Number(group.maskHeight || 1));
    let sourceLeft = Number(group.maskLeft || 0);
    let sourceTop = Number(group.maskTop || 0);
    if (frame && sourceLeft >= 0 && sourceLeft <= frameDesignWidth(frame) && sourceTop >= 0 && sourceTop <= frameDesignHeight(frame)) {
      sourceLeft += frame.left; sourceTop += frame.top;
      group.maskLeft = sourceLeft; group.maskTop = sourceTop; group.frameId = frame.id;
      applyMaskGroupClip(group, frame);
    }
    let shape = canvas.getObjects().find((item) => (item as ObjectMeta).kind === "mask-shape" && (item as ObjectMeta).maskGroupId === group.id) as (Rect & ObjectMeta) | undefined;
    if (!shape) {
      shape = new Rect({ left: sourceLeft, top: sourceTop, width: sourceWidth, height: sourceHeight, rx: Number(group.maskRadius || 0), ry: Number(group.maskRadius || 0), fill: "rgba(47,124,255,0.001)", stroke: "rgba(47,124,255,0)", strokeWidth: 0, originX: "left", originY: "top", objectCaching: false }) as Rect & ObjectMeta;
      Object.assign(shape, { id: group.maskShapeId || newId("rectangle"), name: group.maskShapeName || "蒙版矩形", kind: "mask-shape", maskGroupId: group.id, frameId: frame?.id || group.frameId, pageId: group.pageId });
      canvas.add(shape);
    }
    attachRectangleRadiusControl(shape); applyObjectSelectionStyle(shape); shape.set({ visible: true, selectable: true, evented: true }); shape.setCoords();
    canvas.bringObjectToFront(shape); canvas.setActiveObject(shape);
    setEditingMaskGroupId(String(group.id));
    canvas.requestRenderAll(); commit();
  };
  const applyFrameClip = (child: ObjectMeta, frame: ObjectMeta) => {
    if (child.kind === "mask-group") { applyMaskGroupClip(child, frame); return; }
    const clip = createFrameClip(frame);
    child.set({ objectCaching: true, dirty: true });
    child.clipPath = clip;
    child.frameId = frame.id;
  };
  const syncGroupMemberFrame = (group: Group & ObjectMeta, frame?: ObjectMeta) => {
    group.getObjects().forEach((child) => {
      const meta = child as ObjectMeta;
      meta.frameId = frame?.id;
      meta.pageId = group.pageId;
      meta.clipPath = undefined;
      child.set({ visible: !meta.hidden, dirty: true });
      if (child instanceof Group) syncGroupMemberFrame(child as Group & ObjectMeta, frame);
    });
    group.set({ dirty: true });
  };

  const cloneCanvasObject = async (source: ObjectMeta) => {
    if (!(source instanceof FabricImage)) return await source.clone() as ObjectMeta;
    const element = source.getElement() as HTMLImageElement;
    const src = element.currentSrc || element.src || "";
    if (!src.startsWith("blob:")) return await source.clone() as ObjectMeta;
    const nativeWidth = element.naturalWidth || element.width || source.width;
    const nativeHeight = element.naturalHeight || element.height || source.height;
    const buffer = document.createElement("canvas"); buffer.width = nativeWidth; buffer.height = nativeHeight;
    buffer.getContext("2d")?.drawImage(element, 0, 0, nativeWidth, nativeHeight);
    const clone = await FabricImage.fromURL(buffer.toDataURL("image/png")) as ObjectMeta;
    clone.set({ width: source.width, height: source.height, scaleX: source.scaleX, scaleY: source.scaleY, angle: source.angle, flipX: source.flipX, flipY: source.flipY, opacity: source.opacity, cropX: source.cropX, cropY: source.cropY });
    return clone;
  };

  const copySelectedFrame = () => {
    const canvas = editor.current;
    const active = canvas?.getActiveObject() as ObjectMeta | ActiveSelection | undefined;
    if (!canvas || !active) return;
    const selectedFrames = (active instanceof ActiveSelection ? active.getObjects() : [active]).filter((item) => (item as ObjectMeta).kind === "frame") as ObjectMeta[];
    if (!selectedFrames.length) { setSavedState("请先选中要复制的 Frame"); return; }
    const items = selectedFrames.map((frame) => ({ frame, children: canvas.getObjects().filter((item) => {
      const meta = item as ObjectMeta;
      if (isTransientObject(meta) || meta.kind === "frame" || (meta.pageId || DEFAULT_PAGE_ID) !== (frame.pageId || DEFAULT_PAGE_ID)) return false;
      if (String(meta.frameId || "") === String(frame.id)) return true;
      const bounds = meta.getBoundingRect();
      const centerX = bounds.left + bounds.width / 2; const centerY = bounds.top + bounds.height / 2;
      return centerX >= frame.left && centerX <= frame.left + frameDesignWidth(frame) && centerY >= frame.top && centerY <= frame.top + frameDesignHeight(frame);
    }) as ObjectMeta[] }));
    frameClipboard.current = { items };
    setSavedState(`已复制 ${selectedFrames.length} 个 Frame，可切换页面粘贴`);
  };

  const pasteCopiedFrame = async () => {
    const canvas = editor.current; const clipboard = frameClipboard.current;
    if (!canvas || !clipboard) { setSavedState("剪贴板中没有 Frame"); return; }
    try {
      const existingFrames = frames();
      const baseLeft = existingFrames.length ? Math.max(...existingFrames.map((item) => item.left + frameDesignWidth(item))) + 80 : clipboard.items[0].frame.left;
      const baseTop = existingFrames.length ? existingFrames.reduce((best, item) => item.left > best.left ? item : best).top : clipboard.items[0].frame.top;
      const pastedFrames: ObjectMeta[] = [];
      for (const [index, item] of clipboard.items.entries()) {
        const sourceFrame = item.frame;
        const frame = await cloneCanvasObject(sourceFrame);
        const left = baseLeft + index * (frameDesignWidth(sourceFrame) + 80);
        const top = baseTop;
        const dx = left - sourceFrame.left; const dy = top - sourceFrame.top;
        const nextFrameId = newId("frame");
        Object.assign(frame, { id: nextFrameId, name: `${sourceFrame.name || "Frame"} 副本`, kind: "frame", pageId: activePageIdRef.current, frameId: undefined, hidden: false, lastLeft: left, lastTop: top });
        frame.set({ left, top, visible: true, selectable: true, evented: true, hasControls: false, lockMovementX: false, lockMovementY: false, lockScalingX: true, lockScalingY: true, lockRotation: true });
        const resetIdentity = (object: ObjectMeta) => {
          object.id = newId(object.kind || "layer"); object.pageId = activePageIdRef.current; object.frameId = nextFrameId; object.hidden = false;
          object.set({ visible: true, selectable: true, evented: true });
          if (object instanceof Group) object.getObjects().forEach((child) => resetIdentity(child as ObjectMeta));
        };
        canvas.add(frame); canvas.sendObjectToBack(frame); applyObjectSelectionStyle(frame); syncFrameLabel(frame); syncFrameGrid(frame);
        const children = await Promise.all(item.children.map(async (source) => { const clone = await cloneCanvasObject(source); Object.assign(clone, { name: source.name, kind: source.kind, nameFollowsText: source.nameFollowsText, maskShapeId: source.maskShapeId, maskShapeName: source.maskShapeName, maskLeft: source.maskLeft, maskTop: source.maskTop, maskWidth: source.maskWidth, maskHeight: source.maskHeight, maskRadius: source.maskRadius, maskFill: source.maskFill, maskStroke: source.maskStroke, maskStrokeWidth: source.maskStrokeWidth }); return clone; }));
        children.forEach((child) => { resetIdentity(child); child.set({ left: child.left + dx, top: child.top + dy }); applyObjectSelectionStyle(child); if (child.kind === "mask-group") { child.maskLeft = Number(child.maskLeft || 0) + dx; child.maskTop = Number(child.maskTop || 0) + dy; child.lastLeft = child.left; child.lastTop = child.top; child.lastScaleX = child.scaleX; child.lastScaleY = child.scaleY; } if (child instanceof Rect && child.kind === "rectangle") attachRectangleRadiusControl(child as Rect & ObjectMeta); if (child instanceof Group) syncGroupMemberFrame(child as Group & ObjectMeta, frame); applyFrameClip(child, frame); child.setCoords(); canvas.add(child); });
        pastedFrames.push(frame);
      }
      canvas.setActiveObject(pastedFrames.length === 1 ? pastedFrames[0] : new ActiveSelection(pastedFrames, { canvas })); canvas.requestRenderAll(); commit();
      setSavedState(`已粘贴 ${pastedFrames.length} 个 Frame 到 ${pagesRef.current.find((page) => page.id === activePageIdRef.current)?.name || "当前页面"}`);
    } catch (error) {
      console.error("[Pixel Local] Frame paste failed", error);
      setSavedState("粘贴失败，请重新复制 Frame");
    }
  };

  const syncFrameChildren = (frame: ObjectMeta, dx = 0, dy = 0) => {
    editor.current?.getObjects().forEach((item) => {
      const child = item as ObjectMeta;
      if (child.frameId !== frame.id || isTransientObject(child)) return;
      if (dx || dy) {
        child.set({ left: child.left + dx, top: child.top + dy });
        if (child.kind === "mask-group") { child.maskLeft = Number(child.maskLeft || 0) + dx; child.maskTop = Number(child.maskTop || 0) + dy; child.lastLeft = child.left; child.lastTop = child.top; }
      }
      applyFrameClip(child, frame); child.setCoords();
    });
  };

  const moveFrameChildrenRealtime = (frame: ObjectMeta, dx: number, dy: number) => {
    if (!dx && !dy) return;
    editor.current?.getObjects().forEach((item) => {
      const child = item as ObjectMeta;
      if (child.frameId !== frame.id || isTransientObject(child)) return;
      child.set({ left: child.left + dx, top: child.top + dy });
      if (child.clipPath instanceof Rect) child.clipPath.set({ left: frame.left, top: frame.top, width: frameDesignWidth(frame), height: frameDesignHeight(frame) });
      child.setCoords();
    });
  };

  // Frame helper overlays are visual-only and must never block canvas editing.
  // The recovered document data remains authoritative even when no helper overlay is present.
  const syncFrameLabel = (frame: ObjectMeta) => {
    const canvas = editor.current;
    if (!canvas || !frame.id) return;
    const zoom = Math.max(MIN_CANVAS_ZOOM, canvas.getZoom());
    const labelFontSize = 12 / zoom;
    const labelOffset = 8 / zoom;
    let label = canvas.getObjects().find((item) => {
      const meta = item as ObjectMeta;
      return meta.kind === "frame-label" && meta.frameId === frame.id;
    }) as (FabricText & ObjectMeta) | undefined;
    if (!label) {
      label = new FabricText(frame.name || "Frame", {
        left: frame.left,
        top: frame.top - labelOffset,
        fontSize: labelFontSize,
        fontFamily: "Inter",
        fontWeight: 600,
        fill: "#68635c",
        originX: "left",
        originY: "bottom",
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        excludeFromExport: true,
        objectCaching: false,
      }) as FabricText & ObjectMeta;
      Object.assign(label, {
        id: `frame-label-${frame.id}`,
        name: `${frame.name || "Frame"} 标签`,
        kind: "frame-label",
        frameId: frame.id,
        pageId: frame.pageId,
      });
      canvas.add(label);
    }
    label.pageId = frame.pageId;
    const fullLabel = frame.name || "Frame";
    const maxLabelWidth = Math.max(24 / zoom, frameDesignWidth(frame) - 8 / zoom);
    const characters = Array.from(fullLabel);
    const measureLabel = (text: string) => { label!.set({ text, fontSize: labelFontSize, scaleX: 1, scaleY: 1 }); label!.initDimensions(); return label!.getScaledWidth(); };
    let displayLabel = fullLabel;
    if (measureLabel(fullLabel) > maxLabelWidth) {
      let low = 0; let high = characters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (measureLabel(`${characters.slice(0, middle).join("")}...`) <= maxLabelWidth) low = middle;
        else high = middle - 1;
      }
      displayLabel = `${characters.slice(0, low).join("")}...`;
    }
    label.set({
      text: displayLabel,
      left: frame.left,
      top: frame.top - labelOffset,
      fontSize: labelFontSize,
      scaleX: 1,
      scaleY: 1,
      opacity: .6,
      visible: frame.visible && !frame.hidden,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
    });
    label.setCoords();
    canvas.bringObjectToFront(label);
  };
  const syncAllFrameLabels = () => {
    const canvas = editor.current;
    if (!canvas) return;
    canvas.getObjects().filter((item) => (item as ObjectMeta).kind === "frame").forEach((item) => syncFrameLabel(item as ObjectMeta));
  };
  const syncFrameGrid = (frame: ObjectMeta) => {
    const canvas = editor.current;
    if (!canvas || !frame.id) return;
    const spacing = Number(frame.gridPreset || 0);
    const existing = canvas.getObjects().find((item) => {
      const meta = item as ObjectMeta;
      return meta.kind === "grid-overlay" && meta.frameId === frame.id;
    }) as (Group & ObjectMeta) | undefined;
    if (existing) canvas.remove(existing);
    if (!spacing || frame.hidden || (frame.pageId || DEFAULT_PAGE_ID) !== activePageIdRef.current) return;
    const width = frameDesignWidth(frame); const height = frameDesignHeight(frame);
    const lineColor = "rgba(50,105,235,.34)";
    const lines: Rect[] = [new Rect({ left: 0, top: 0, width, height, fill: "rgba(0,0,0,0)", strokeWidth: 0, originX: "left", originY: "top", selectable: false, evented: false })];
    for (let x = width / 2; x > 0; x -= spacing) lines.push(new Rect({ left: x, top: 0, width: 1, height, fill: lineColor, strokeWidth: 0, originX: "center", originY: "top", selectable: false, evented: false }));
    for (let x = width / 2 + spacing; x < width; x += spacing) lines.push(new Rect({ left: x, top: 0, width: 1, height, fill: lineColor, strokeWidth: 0, originX: "center", originY: "top", selectable: false, evented: false }));
    for (let y = height / 2; y > 0; y -= spacing) lines.push(new Rect({ left: 0, top: y, width, height: 1, fill: lineColor, strokeWidth: 0, originX: "left", originY: "center", selectable: false, evented: false }));
    for (let y = height / 2 + spacing; y < height; y += spacing) lines.push(new Rect({ left: 0, top: y, width, height: 1, fill: lineColor, strokeWidth: 0, originX: "left", originY: "center", selectable: false, evented: false }));
    const grid = new Group(lines, { left: frame.left, top: frame.top, originX: "left", originY: "top", selectable: false, evented: false, subTargetCheck: false, interactive: false, hasControls: false, hasBorders: false, excludeFromExport: true, objectCaching: true }) as Group & ObjectMeta;
    Object.assign(grid, { id: `grid-${frame.id}`, name: `${spacing}px 参考网格`, kind: "grid-overlay", frameId: frame.id, pageId: frame.pageId });
    grid.clipPath = new Rect({ left: frame.left, top: frame.top, width, height, fill: "#000", strokeWidth: 0, originX: "left", originY: "top", absolutePositioned: true, objectCaching: true });
    canvas.add(grid);
    const frameIndex = canvas.getObjects().indexOf(frame); if (frameIndex >= 0) canvas.moveObjectTo(grid, frameIndex + 1);
    syncFrameLabel(frame);
  };
  const syncFrameSelectionOutlines = () => {
    const canvas = editor.current;
    if (!canvas) return;
    const existing = canvas.getObjects().filter((item) => (item as ObjectMeta).kind === "frame-selection-outline") as (Rect & ObjectMeta)[];
    const selectedFrames = canvas.getActiveObjects().filter((item) => (item as ObjectMeta).kind === "frame") as ObjectMeta[];
    const selectedIds = new Set(selectedFrames.map((frame) => frame.id));
    existing.filter((outline) => !selectedIds.has(outline.frameId)).forEach((outline) => canvas.remove(outline));
    selectedFrames.forEach((frame) => {
      let outline = existing.find((item) => item.frameId === frame.id);
      if (!outline) {
        outline = new Rect({
        left: frame.left,
        top: frame.top,
        width: frameDesignWidth(frame),
        height: frameDesignHeight(frame),
        originX: "left",
        originY: "top",
        fill: "rgba(111,60,255,.09)",
        stroke: "#6f3cff",
        strokeWidth: 10,
        strokeUniform: true,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: true,
        objectCaching: false,
        }) as Rect & ObjectMeta;
        Object.assign(outline, {
          id: `frame-selection-outline-${frame.id}`,
          name: `${frame.name || "Frame"} 选中轮廓`,
          kind: "frame-selection-outline",
          frameId: frame.id,
          pageId: frame.pageId,
        });
        canvas.add(outline);
      } else {
        outline.set({ left: frame.left, top: frame.top, width: frameDesignWidth(frame), height: frameDesignHeight(frame), visible: frame.visible && !frame.hidden, dirty: true });
        outline.setCoords();
      }
      canvas.bringObjectToFront(outline);
    });
  };
  const attachRectangleRadiusControl = (rectangle: Rect & ObjectMeta) => {
    const radiusControlVisualRadius = 5.6;
    rectangle.controls = controlsUtils.createObjectDefaultControls();
    const cornerCursors = { tl: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", br: "nwse-resize" } as const;
    Object.entries(cornerCursors).forEach(([key, cursor]) => {
      const control = rectangle.controls[key]; if (!control) return;
      control.cursorStyle = cursor; control.cursorStyleHandler = () => cursor; control.sizeX = 14; control.sizeY = 14; control.touchSizeX = 20; control.touchSizeY = 20;
    });
    const corners = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
    corners.forEach((corner) => {
      const isLeft = corner.endsWith("Left"); const isTop = corner.startsWith("top");
      rectangle.controls[`cornerRadius${corner}`] = new Control({
        x: isLeft ? -.5 : .5,
        y: isTop ? -.5 : .5,
        cursorStyle: isLeft === isTop ? "nwse-resize" : "nesw-resize",
        actionName: "changeCornerRadius",
        positionHandler: (dim, finalMatrix, target) => {
          const rect = target as Rect;
          // Fabric's control matrix expects viewport-space dimensions here.
          // Using the rectangle's unscaled width/height makes the handle drift
          // away whenever the canvas is zoomed or the object has been scaled.
          const radiusX = rect.width ? Number(rect.rx || 0) / rect.width * dim.x : 0;
          const radiusY = rect.height ? Number(rect.ry || 0) / rect.height * dim.y : 0;
          const localX = (isLeft ? -1 : 1) * (dim.x / 2 - radiusX);
          const localY = (isTop ? -1 : 1) * (dim.y / 2 - radiusY);
          return util.transformPoint(new Point(localX, localY), finalMatrix);
        },
        actionHandler: (_event, transform, x, y) => {
          const target = transform.target as Rect;
          const local = controlsUtils.getLocalPoint(transform, "center", "center", x, y);
          const horizontalInset = isLeft ? local.x + target.width / 2 : target.width / 2 - local.x;
          const verticalInset = isTop ? local.y + target.height / 2 : target.height / 2 - local.y;
          const radius = Math.max(0, Math.min(Math.round(Math.min(horizontalInset, verticalInset)), Math.floor(Math.min(target.width, target.height) / 2)));
          const changed = Math.abs(target.rx - radius) >= 1;
          target.set({ rx: radius, ry: radius, dirty: true });
          return changed;
        },
        render: (ctx, left, top) => {
          ctx.save(); ctx.translate(left, top); ctx.fillStyle = "#fbfcff"; ctx.strokeStyle = "#6f3cff"; ctx.lineWidth = 1.5; ctx.shadowColor = "rgba(111,60,255,.22)"; ctx.shadowBlur = 4;
          ctx.beginPath(); ctx.arc(0, 0, radiusControlVisualRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        },
        sizeX: 13,
        sizeY: 13,
      });
    });
  };

  const findContainingFrame = (object: ObjectMeta) => {
    const bounds = object.getBoundingRect();
    let bestFrame: ObjectMeta | undefined;
    let bestOverlap = 0;
    [...frames()].reverse().forEach((frame) => {
      const left = Math.max(bounds.left, frame.left);
      const top = Math.max(bounds.top, frame.top);
      const right = Math.min(bounds.left + bounds.width, frame.left + frameDesignWidth(frame));
      const bottom = Math.min(bounds.top + bounds.height, frame.top + frameDesignHeight(frame));
      const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (overlap > bestOverlap) { bestOverlap = overlap; bestFrame = frame; }
    });
    return bestFrame;
  };

  const refresh = () => {
    const canvas = editor.current;
    if (!canvas) return;
    const currentActive = canvas.getActiveObject() as ObjectMeta | undefined;
    if (currentActive?.kind === "grid-overlay") {
      const parentFrame = canvas.getObjects().find((item) => (item as ObjectMeta).id === currentActive.frameId);
      canvas.discardActiveObject(); if (parentFrame) canvas.setActiveObject(parentFrame);
    }
    if (currentActive?.kind !== "mask-edit-overlay") {
      canvas.getObjects().filter((item) => (item as ObjectMeta).kind === "mask-edit-overlay").forEach((item) => canvas.remove(item));
    }
    setLayers(canvas.getObjects().filter((item) => { const meta = item as ObjectMeta; return !isTransientObject(meta) && (meta.pageId || DEFAULT_PAGE_ID) === activePageIdRef.current; }).reverse());
    const activeObjects = canvas.getActiveObjects() as ObjectMeta[];
    const activeMaskOverlay = activeObjects.find((item) => item.kind === "mask-edit-overlay" || item.kind === "mask-shape");
    setEditingMaskGroupId(activeMaskOverlay?.maskGroupId ? String(activeMaskOverlay.maskGroupId) : null);
    const activeLayerIds = new Set(activeObjects.flatMap((item) => item.id ? [String(item.id)] : []));
    const activeAncestorFrameIds = new Set(activeObjects.flatMap((item) => {
      const frameId = item.kind === "frame" ? item.id : item.frameId;
      return frameId ? [String(frameId)] : [];
    }));
    setSelectedLayerIds(activeLayerIds);
    setSelectedAncestorFrameIds(activeAncestorFrameIds);
    if ([...activeAncestorFrameIds].some((frameId) => collapsedFrameIdsRef.current.has(frameId))) {
      const expandedSelection = new Set(collapsedFrameIdsRef.current);
      activeAncestorFrameIds.forEach((frameId) => expandedSelection.delete(frameId));
      updateCollapsedFrameIds(expandedSelection);
    }
    const selectedFrames = activeObjects.filter((item) => item.kind === "frame");
    setSelectedFrameCount(selectedFrames.length);
    const selectedParentKeys = new Set(activeObjects.map((item) => `${item.pageId || DEFAULT_PAGE_ID}:${item.frameId || "outside"}`));
    const sameFrameLayers = activeObjects.length > 1 && selectedFrames.length === 0 && selectedParentKeys.size === 1;
    setSelectedLayerCount(sameFrameLayers ? activeObjects.length : 0);
    if (activeObjects.length > 1) {
      setSelected(null);
      return;
    }
    const active = canvas.getActiveObject() as ObjectMeta | undefined;
    const activeParentFrame = active?.frameId ? frames().find((frame) => frame.id === active.frameId) : undefined;
    setSelected(active ? {
      id: active.id || active.type,
      type: active.kind || active.type,
      name: active instanceof Textbox && active.nameFollowsText !== false ? active.text : active.name || active.type,
      x: Math.round(active.left - (activeParentFrame?.left || 0)),
      y: Math.round(active.top - (activeParentFrame?.top || 0)),
      text: active instanceof Textbox ? active.text : undefined,
      fontFamily: active instanceof Textbox ? String(active.fontFamily || FALLBACK_FONTS[0]) : undefined,
      fontStyle: active instanceof Textbox ? String(active.fontStyle || "normal") : undefined,
      fontWeight: active instanceof Textbox ? active.fontWeight : undefined,
      fontSize: active instanceof Textbox ? Number(active.fontSize || 36) : undefined,
      charSpacing: active instanceof Textbox ? Number(active.charSpacing || 0) : undefined,
      lineHeight: active instanceof Textbox ? Number(active.lineHeight || 1.16) : undefined,
      textAlign: active instanceof Textbox ? String(active.textAlign || "left") : undefined,
      fill: typeof active.fill === "string" ? active.fill : undefined,
      stroke: typeof active.stroke === "string" ? active.stroke : undefined,
      strokeWidth: Number(active.strokeWidth || 0),
      cornerRadius: active instanceof Rect && ["rectangle", "mask-edit-overlay", "mask-shape"].includes(String(active.kind)) ? Number(active.rx || 0) : undefined,
      gridPreset: active.kind === "frame" ? String(active.gridPreset || "0") : undefined,
      shadowColor: active instanceof Textbox && active.shadow instanceof Shadow ? active.shadow.color : undefined,
      shadowBlur: active instanceof Textbox && active.shadow instanceof Shadow ? active.shadow.blur : undefined,
      shadowOffsetX: active instanceof Textbox && active.shadow instanceof Shadow ? active.shadow.offsetX : undefined,
      shadowOffsetY: active instanceof Textbox && active.shadow instanceof Shadow ? active.shadow.offsetY : undefined,
      opacity: active.opacity,
      width: objectDesignWidth(active),
      height: objectDesignHeight(active),
    } : null);
  };

  const commit = () => {
    if (!editor.current || restoring.current) return;
    const json = serialize();
    history.current = history.current.slice(0, historyIndex.current + 1);
    if (history.current.at(-1) !== json) {
      history.current.push(json);
      if (history.current.length > 50) history.current.shift();
      historyIndex.current = history.current.length - 1;
    }
    localSet(PROJECT_KEY, json).then(() => setSavedState("刚刚已保存")).catch(() => setSavedState("本地保存失败"));
    localSet(PAGES_KEY, { pages: pagesRef.current, activePageId: activePageIdRef.current }).catch(() => undefined);
    refresh();
  };

  const cleanLoadedCanvas = (canvas: Canvas) => {
    const removable: FabricObject[] = [];
    canvas.getObjects().forEach((item) => {
      const meta = item as ObjectMeta;
      if (isTransientObject(meta)) {
        removable.push(item);
        return;
      }
      meta.pageId ||= DEFAULT_PAGE_ID;
      applyObjectSelectionStyle(meta);
      if (item instanceof Textbox && meta.nameFollowsText === undefined) meta.nameFollowsText = /^\s*文字(?:\s+\d+)?(?:\s+副本)?\s*$/.test(meta.name || "");
      meta.clipPath = undefined;
      if (item instanceof Textbox && Number(item.strokeWidth || 0) > 0) item.set({ paintFirst: "stroke" });
      if (meta.kind === "frame") item.set({ selectable: true, evented: true, hasControls: false, lockMovementX: false, lockMovementY: false, lockScalingX: true, lockScalingY: true, lockRotation: true });
      if (meta.kind === "mask-group") { meta.lastLeft = meta.left; meta.lastTop = meta.top; meta.lastScaleX = meta.scaleX; meta.lastScaleY = meta.scaleY; applyObjectSelectionStyle(meta); }
      if (item instanceof Rect && meta.kind === "rectangle") { const width = item.width * item.scaleX; const height = item.height * item.scaleY; const radius = Math.max(0, Math.min(Number(item.rx || 0), width / 2, height / 2)); item.set({ width, height, rx: radius, ry: radius, scaleX: 1, scaleY: 1 }); attachRectangleRadiusControl(item as Rect & ObjectMeta); }
    });
    removable.forEach((item) => canvas.remove(item));
    const loadedFrames = canvas.getObjects().filter((item) => {
      const meta = item as ObjectMeta;
      return !isTransientObject(meta) && meta.kind === "frame";
    }) as ObjectMeta[];
    loadedFrames.forEach((frame) => {
      frame.lastLeft = frame.left;
      frame.lastTop = frame.top;
      syncFrameChildren(frame);
      syncFrameLabel(frame);
    });
  };

  const getActiveFrame = () => {
    const active = editor.current?.getActiveObject() as ObjectMeta | undefined;
    if (active?.kind === "frame") return active;
    if (active?.frameId) return frames().find((frame) => frame.id === active.frameId);
    return frames()[0];
  };

  const addFrame = (width = 800, height = 800, label?: string, left?: number, top?: number) => {
    const canvas = editor.current;
    if (!canvas) return null;
    const vpt = canvas.viewportTransform;
    const centerX = (canvas.width / 2 - vpt[4]) / vpt[0];
    const centerY = (canvas.height / 2 - vpt[5]) / vpt[3];
    const existingFrames = frames();
    const automaticPlacement = left === undefined && top === undefined;
    let frameLeft = left ?? centerX - width / 2;
    let frameTop = top ?? centerY - height / 2;
    if (automaticPlacement && existingFrames.length) {
      const rightmost = existingFrames.reduce((current, item) => item.left + frameDesignWidth(item) > current.left + frameDesignWidth(current) ? item : current);
      frameLeft = rightmost.left + frameDesignWidth(rightmost) + 80;
      frameTop = rightmost.top;
    }
    const frame = new Rect({
      left: frameLeft,
      top: frameTop,
      width, height, fill: "#ffffff", stroke: "#c7c3ba", strokeWidth: 1,
      shadow: new Shadow({ color: "rgba(30,26,20,.13)", blur: 18, offsetX: 0, offsetY: 7 }),
      originX: "left", originY: "top",
      hasControls: false, lockMovementX: false, lockMovementY: false, lockScalingX: true, lockScalingY: true, lockRotation: true,
    }) as ObjectMeta;
    Object.assign(frame, { id: newId("frame"), name: label || `Frame ${frames().length + 1}`, kind: "frame", pageId: activePageIdRef.current, lastLeft: frame.left, lastTop: frame.top });
    canvas.add(frame); canvas.sendObjectToBack(frame); syncFrameLabel(frame); canvas.setActiveObject(frame);
    if (automaticPlacement) {
      const nextZoom = Math.max(MIN_CANVAS_ZOOM, Math.min(canvas.getZoom(), (canvas.width - 140) / width, (canvas.height - 140) / height, 1));
      canvas.setViewportTransform([nextZoom, 0, 0, nextZoom, canvas.width / 2 - (frameLeft + width / 2) * nextZoom, canvas.height / 2 - (frameTop + height / 2) * nextZoom]);
    }
    canvas.requestRenderAll(); commit();
    return frame;
  };

  const showPage = (pageId: string, persist = true) => {
    const canvas = editor.current;
    activePageIdRef.current = pageId; setActivePageId(pageId); setEditingPageId(null); setEditingLayerId(null);
    if (canvas) {
      canvas.discardActiveObject();
      canvas.getObjects().filter((item) => { const meta = item as ObjectMeta; return meta.kind === "frame" && (meta.pageId || DEFAULT_PAGE_ID) === pageId; }).forEach((item) => {
        const frame = item as ObjectMeta;
        syncFrameChildren(frame);
        syncFrameLabel(frame);
      });
      applyActivePageVisibility(); syncFrameSelectionOutlines();
      fitPageFrames(pageId);
      canvas.requestRenderAll(); refresh();
    }
    if (persist) localSet(PAGES_KEY, { pages: pagesRef.current, activePageId: pageId }).catch(() => undefined);
  };

  const startRenameLayer = (object: ObjectMeta) => {
    if (!object.id) return;
    setLayerNameDraft(object instanceof Textbox && object.nameFollowsText !== false ? object.text : object.name || object.type || "图层");
    setEditingLayerId(object.id);
  };

  const finishRenameLayer = (object: ObjectMeta) => {
    const name = layerNameDraft.trim();
    if (name && object.id) {
      object.name = name;
      if (object instanceof Textbox) object.nameFollowsText = false;
      if (object.kind === "frame") syncFrameLabel(object);
      editor.current?.requestRenderAll();
      commit();
    }
    setEditingLayerId(null);
  };

  const addPage = () => {
    const page = { id: newId("page"), name: `页面 ${pagesRef.current.length + 1}` };
    pagesRef.current = [...pagesRef.current, page]; setPages(pagesRef.current); showPage(page.id); setPageNameDraft(page.name); setEditingPageId(page.id);
  };

  const startRenamePage = (page: EditorPage) => { setPageNameDraft(page.name); setEditingPageId(page.id); };
  const finishRenamePage = (pageId: string) => {
    const name = pageNameDraft.trim();
    if (name) { pagesRef.current = pagesRef.current.map((page) => page.id === pageId ? { ...page, name } : page); setPages(pagesRef.current); localSet(PAGES_KEY, { pages: pagesRef.current, activePageId: activePageIdRef.current }).catch(() => undefined); }
    setEditingPageId(null);
  };
  const deletePage = (pageId: string) => {
    const canvas = editor.current;
    if (!canvas || pagesRef.current.length <= 1) return;
    canvas.getObjects().filter((item) => ((item as ObjectMeta).pageId || DEFAULT_PAGE_ID) === pageId).forEach((item) => canvas.remove(item));
    pagesRef.current = pagesRef.current.filter((page) => page.id !== pageId); setPages(pagesRef.current);
    const nextPageId = activePageIdRef.current === pageId ? pagesRef.current[0].id : activePageIdRef.current;
    showPage(nextPageId); commit();
  };
  const togglePageVisibility = (pageId: string) => {
    pagesRef.current = pagesRef.current.map((page) => page.id === pageId ? { ...page, hidden: !page.hidden } : page);
    setPages(pagesRef.current);
    if (pageId === activePageIdRef.current) applyActivePageVisibility();
    editor.current?.discardActiveObject(); editor.current?.requestRenderAll();
    commit();
  };
  const toggleLayerVisibility = (object: ObjectMeta) => {
    object.hidden = !object.hidden;
    if (object instanceof Group && object.kind === "group") {
      object.getObjects().forEach((child) => { const childMeta = child as ObjectMeta; childMeta.hidden = object.hidden; child.set({ visible: !object.hidden, dirty: true }); });
      object.set({ dirty: true });
      applyActivePageVisibility();
    } else if (object.group) {
      object.set({ visible: !object.hidden, dirty: true });
      object.group.set({ dirty: true });
    } else applyActivePageVisibility();
    if (object.hidden && editor.current?.getActiveObject() === object) editor.current.discardActiveObject();
    editor.current?.requestRenderAll(); commit();
  };
  const selectLayerFromSidebar = (layer: ObjectMeta, shiftKey: boolean) => {
    const canvas = editor.current;
    if (!canvas) return;
    if (!shiftKey) {
      canvas.setActiveObject(layer);
      syncFrameSelectionOutlines();
      canvas.requestRenderAll();
      refresh();
      return;
    }
    const current = canvas.getActiveObjects() as ObjectMeta[];
    const selectingFrames = layer.kind === "frame";
    const sameFrame = current.length > 0 && current.every((object) => selectingFrames
      ? object.kind === "frame" && (object.pageId || DEFAULT_PAGE_ID) === (layer.pageId || DEFAULT_PAGE_ID)
      : object.kind !== "frame" && object.frameId === layer.frameId);
    let next = sameFrame ? [...current] : [];
    const existingIndex = next.indexOf(layer);
    if (existingIndex >= 0) next.splice(existingIndex, 1); else next.push(layer);
    const active = canvas.getActiveObject();
    if (active instanceof ActiveSelection) active.removeAll();
    canvas.discardActiveObject();
    if (next.length === 1) canvas.setActiveObject(next[0]);
    else if (next.length > 1) canvas.setActiveObject(new ActiveSelection(next, { canvas }));
    canvas.requestRenderAll();
    refresh();
  };

  const registerLocalFontFamily = async (family: string, fontData = localFontDataRef.current) => {
    const matchingFonts = fontData.filter((font) => font.family?.trim() === family);
    await Promise.all(matchingFonts.map(async (font) => {
      const variant = fontVariantFromStyle(font.style || font.fullName?.replace(font.family, "").trim() || "Regular");
      const key = `${font.postscriptName || font.fullName || font.family}::${variant.fontStyle}::${variant.fontWeight}`;
      if (registeredLocalFontFaces.current.has(key)) return;
      const source = await (await font.blob()).arrayBuffer();
      const face = new FontFace(font.family, source, { style: variant.fontStyle, weight: String(variant.fontWeight) });
      await face.load();
      document.fonts.add(face);
      registeredLocalFontFaces.current.add(key);
    }));
  };

  const queryAndCacheLocalFonts = async () => {
    const queryLocalFonts = (window as FontAwareWindow).queryLocalFonts;
    if (!queryLocalFonts) throw new Error("unsupported");
    const fonts = await queryLocalFonts();
    localFontDataRef.current = fonts;
    return fonts;
  };

  const loadLocalFonts = async () => {
    const queryLocalFonts = (window as FontAwareWindow).queryLocalFonts;
    if (!queryLocalFonts) {
      setFontLoadLabel("当前浏览器不支持");
      setSavedState("当前浏览器不支持读取本机字体");
      return;
    }
    try {
      setFontLoadLabel("加载中");
      const fonts = await queryAndCacheLocalFonts();
      const nextFontRecords = normalizeFontRecords(fonts);
      const nextFonts = normalizeFonts(nextFontRecords.map((font) => font.family));
      setLocalFontRecords(nextFontRecords);
      setFontFamilies(nextFonts);
      setFontLoadLabel(`已加载 ${nextFonts.length} 个`);
      await localSet(FONT_LIST_KEY, nextFonts);
      await localSet(FONT_META_KEY, nextFontRecords);
      const active = editor.current?.getActiveObject();
      if (active instanceof Textbox) {
        await registerLocalFontFamily(String(active.fontFamily || FALLBACK_FONTS[0]), fonts);
        active.set({ dirty: true });
        active.initDimensions();
        active.setCoords();
        editor.current?.requestRenderAll();
      }
    } catch {
      setFontLoadLabel("未授权");
      setSavedState("未获得本机字体访问权限");
    }
  };

  useEffect(() => {
    if (!htmlCanvas.current || !canvasHost.current) return;
    const canvas = new Canvas(htmlCanvas.current, {
      width: canvasHost.current.clientWidth,
      height: canvasHost.current.clientHeight,
      backgroundColor: "transparent",
      preserveObjectStacking: true,
      selectionColor: "rgba(111,60,255,.1)", selectionBorderColor: "#6f3cff",
    });
    canvas.selectionKey = "shiftKey";
    editor.current = canvas;
    canvas.setViewportTransform([0.7, 0, 0, 0.7, 120, 80]);

    const resize = new ResizeObserver(() => {
      if (!canvasHost.current) return;
      canvas.setDimensions({ width: canvasHost.current.clientWidth, height: canvasHost.current.clientHeight });
      canvas.requestRenderAll();
    });
    resize.observe(canvasHost.current);

    const allowExternalImageDrop = (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types || []);
      if (!types.includes("Files") && !types.includes("text/uri-list") && !types.includes("text/plain")) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取图片"));
      reader.onerror = () => reject(reader.error || new Error("无法读取图片"));
      reader.readAsDataURL(file);
    });
    const importDroppedImage = async (source: string, name: string, left: number, top: number) => {
      const image = await FabricImage.fromURL(source) as ObjectMeta;
      image.set({ left, top, originX: "left", originY: "top" });
      Object.assign(image, { id: newId("image"), name, kind: "image", pageId: activePageIdRef.current, frameId: undefined });
      const frame = findContainingFrame(image);
      if (frame) applyFrameClip(image, frame);
      canvas.add(image); canvas.setActiveObject(image); canvas.requestRenderAll(); commit();
    };
    const handleExternalImageDrop = async (event: DragEvent) => {
      event.preventDefault(); event.stopPropagation();
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      const vpt = canvas.viewportTransform;
      const left = (event.clientX - rect.left - vpt[4]) / vpt[0];
      const top = (event.clientY - rect.top - vpt[5]) / vpt[3];
      const imageFiles = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length) {
        for (const [index, file] of imageFiles.entries()) {
          try { await importDroppedImage(await fileToDataUrl(file), file.name, left + index * 24, top + index * 24); }
          catch { setSavedState(`无法读取图片：${file.name}`); }
        }
        return;
      }
      const externalUrl = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain");
      if (/^(https?:|data:image\/)/.test(externalUrl || "")) {
        try { await importDroppedImage(externalUrl.trim(), "拖入图片", left, top); } catch { setSavedState("无法读取该外部图片"); }
      }
    };
    canvas.upperCanvasEl.addEventListener("dragenter", allowExternalImageDrop);
    canvas.upperCanvasEl.addEventListener("dragover", allowExternalImageDrop);
    canvas.upperCanvasEl.addEventListener("drop", handleExternalImageDrop);

    canvas.on("mouse:wheel", ({ e }) => {
      e.preventDefault(); e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        const next = Math.max(MIN_CANVAS_ZOOM, Math.min(3, canvas.getZoom() * Math.pow(TRACKPAD_ZOOM_BASE, e.deltaY)));
        canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), next); syncAllFrameLabels();
      } else {
        const vpt = canvas.viewportTransform; vpt[4] -= e.deltaX; vpt[5] -= e.deltaY;
        canvas.setViewportTransform(vpt); syncAllFrameLabels(); canvas.requestRenderAll();
      }
    });
    let commandDragOrigin: {
      source: ObjectMeta;
      left: number;
      top: number;
      children: Array<{ source: ObjectMeta; left: number; top: number }>;
    } | null = null;
    let commandDragDuplicated = false;
    let textBoxStart: Point | null = null;
    let textBoxPreview: Rect | null = null;
    canvas.on("mouse:down", ({ e, target }) => {
      if ((textToolActiveRef.current || rectangleToolActiveRef.current) && e.button === 0) {
        textBoxStart = canvas.getScenePoint(e);
        textBoxPreview = new Rect({ left: textBoxStart.x, top: textBoxStart.y, width: 1, height: 1, fill: rectangleToolActiveRef.current ? "rgba(180,180,180,.45)" : "rgba(66,105,245,.08)", stroke: "#4269f5", strokeWidth: 1, strokeDashArray: [6, 4], selectable: false, evented: false, excludeFromExport: true, originX: "left", originY: "top" });
        restoring.current = true; canvas.discardActiveObject(); canvas.selection = false; canvas.add(textBoxPreview); canvas.defaultCursor = "crosshair"; canvas.hoverCursor = "crosshair"; canvas.moveCursor = "crosshair"; canvas.requestRenderAll();
        return;
      }
      let source = target as ObjectMeta | undefined;
      canvas.uniformScaling = source?.kind !== "rectangle";
      if (source?.kind === "frame") { source.lastLeft = source.left; source.lastTop = source.top; }
      if (source instanceof ActiveSelection) source.getObjects().filter((item) => (item as ObjectMeta).kind === "frame").forEach((item) => { const frame = item as ObjectMeta; frame.lastLeft = frame.left; frame.lastTop = frame.top; });
      if ((e.metaKey || e.ctrlKey) && source && !isTransientObject(source)) {
        const children = source.kind === "frame" && source.id
          ? canvas.getObjects().filter((item) => {
              const meta = item as ObjectMeta;
              return !isTransientObject(meta) && meta.frameId === source.id;
            }).map((item) => ({ source: item as ObjectMeta, left: item.left, top: item.top }))
          : [];
        commandDragOrigin = { source, left: source.left, top: source.top, children };
      }
      if (spacePressed.current || e.button === 1 || e.altKey) {
        isPanning.current = true; canvas.selection = false; canvas.defaultCursor = "grabbing";
        lastPointer.current = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.on("mouse:move", ({ e }) => {
      if (textBoxStart && textBoxPreview) {
        const point = canvas.getScenePoint(e);
        textBoxPreview.set({ left: textBoxStart.x, top: textBoxStart.y, width: Math.max(1, point.x - textBoxStart.x), height: Math.max(1, point.y - textBoxStart.y) });
        textBoxPreview.setCoords(); canvas.requestRenderAll(); return;
      }
      if (!isPanning.current) return;
      const vpt = canvas.viewportTransform;
      vpt[4] += e.clientX - lastPointer.current.x; vpt[5] += e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY }; canvas.requestRenderAll();
    });
    canvas.on("mouse:up", () => {
      if (textBoxStart && textBoxPreview) {
        const { left, top, width, height } = textBoxPreview;
        const createRectangle = rectangleToolActiveRef.current;
        canvas.remove(textBoxPreview); textBoxStart = null; textBoxPreview = null; restoring.current = false;
        if (width >= 12 && height >= 12) {
          if (createRectangle) {
            const rectangle = new Rect({ left, top, width, height, fill: "#d9d9d9", stroke: "#1b1b1b", strokeWidth: 0, rx: 0, ry: 0, originX: "left", originY: "top" }) as ObjectMeta;
            Object.assign(rectangle, { id: newId("rectangle"), name: `矩形 ${canvas.getObjects().length}`, kind: "rectangle", pageId: activePageIdRef.current });
            attachRectangleRadiusControl(rectangle as Rect & ObjectMeta);
            const frame = findContainingFrame(rectangle); if (frame) applyFrameClip(rectangle, frame);
            canvas.add(rectangle); canvas.setActiveObject(rectangle); canvas.requestRenderAll(); commit();
          } else {
            const fontSize = Math.max(8, Math.min(72, Math.round(height * .55)));
            const text = new Textbox("输入文字", { left, top, width, fontSize, fontWeight: 400, fill: "#1b1b1b", textAlign: "left", fontFamily: "PingFang SC", originX: "left", originY: "top", splitByGrapheme: true }) as ObjectMeta;
            Object.assign(text, { id: newId("text"), name: text.text, nameFollowsText: true, kind: "text", pageId: activePageIdRef.current });
            const frame = findContainingFrame(text); if (frame) applyFrameClip(text, frame);
            canvas.add(text); canvas.setActiveObject(text); text.enterEditing(); text.selectAll(); canvas.requestRenderAll(); commit();
          }
        }
        textToolActiveRef.current = false; rectangleToolActiveRef.current = false; setTextToolActive(false); setRectangleToolActive(false); canvas.selection = true; canvas.defaultCursor = "default"; canvas.hoverCursor = "move"; canvas.moveCursor = "move";
        return;
      }
      isPanning.current = false; canvas.selection = true; canvas.defaultCursor = "default"; canvas.setViewportTransform(canvas.viewportTransform); commandDragOrigin = null; commandDragDuplicated = false;
    });
    canvas.on("object:moving", async ({ target, e }) => {
      const source = target as ObjectMeta | undefined;
      if (source instanceof ActiveSelection) {
        syncFrameSelectionOutlines(); canvas.requestRenderAll();
        return;
      }
      if (source && (e?.metaKey || e?.ctrlKey) && !commandDragDuplicated && commandDragOrigin?.source === source) {
        commandDragDuplicated = true;
        try {
          if (source.kind === "frame") {
            const frameClone = await cloneCanvasObject(source);
            const nextFrameId = newId("frame");
            Object.assign(frameClone, { id: nextFrameId, name: `${source.name || "Frame"} 副本`, kind: "frame", pageId: source.pageId, frameId: undefined, hidden: false, lastLeft: commandDragOrigin.left, lastTop: commandDragOrigin.top });
            frameClone.set({ left: commandDragOrigin.left, top: commandDragOrigin.top, visible: true, selectable: true, evented: true, hasControls: false, lockMovementX: false, lockMovementY: false, lockScalingX: true, lockScalingY: true, lockRotation: true });
            restoring.current = true;
            canvas.add(frameClone); canvas.sendObjectToBack(frameClone); applyObjectSelectionStyle(frameClone); syncFrameLabel(frameClone); syncFrameGrid(frameClone);
            for (const childOrigin of commandDragOrigin.children) {
              const childClone = await cloneCanvasObject(childOrigin.source);
              Object.assign(childClone, { id: newId(childOrigin.source.kind || "layer"), name: `${childOrigin.source.name || childOrigin.source.type} 副本`, kind: childOrigin.source.kind, nameFollowsText: childOrigin.source.nameFollowsText, frameId: nextFrameId, pageId: source.pageId, hidden: false });
              childClone.set({ left: childOrigin.left, top: childOrigin.top, visible: true, selectable: true, evented: true });
              if (childClone instanceof Rect && childClone.kind === "rectangle") attachRectangleRadiusControl(childClone as Rect & ObjectMeta);
              if (childClone instanceof Group) syncGroupMemberFrame(childClone as Group & ObjectMeta, frameClone);
              applyFrameClip(childClone, frameClone); childClone.setCoords(); canvas.add(childClone);
            }
            restoring.current = false;
            frameClone.setCoords(); canvas.requestRenderAll(); commit();
          } else {
            const clone = await cloneCanvasObject(source);
            Object.assign(clone, { id: newId(source.kind || "layer"), name: `${source.name || source.type} 副本`, kind: source.kind, nameFollowsText: source.nameFollowsText, frameId: source.frameId, pageId: source.pageId, hidden: false });
            clone.set({ left: commandDragOrigin.left, top: commandDragOrigin.top, visible: true, selectable: true, evented: true });
            const frame = source.frameId ? frames().find((item) => item.id === source.frameId) : undefined;
            if (clone instanceof Rect && clone.kind === "rectangle") attachRectangleRadiusControl(clone as Rect & ObjectMeta);
            if (clone instanceof Group) syncGroupMemberFrame(clone as Group & ObjectMeta, frame);
            if (frame) applyFrameClip(clone, frame);
            canvas.add(clone); canvas.sendObjectBackwards(clone); canvas.requestRenderAll();
          }
        } catch {
          restoring.current = false;
          commandDragDuplicated = false;
          setSavedState("复制失败，请重试");
        }
      }
      if (source?.kind === "frame") {
        const width = frameDesignWidth(source); const height = frameDesignHeight(source); const threshold = 8 / canvas.getZoom();
        const others = frames().filter((frame) => frame !== source && !frame.hidden);
        let bestX: { value: number; distance: number } | null = null; let bestY: { value: number; distance: number } | null = null;
        const movingX = [source.left, source.left + width / 2, source.left + width];
        const movingY = [source.top, source.top + height / 2, source.top + height];
        for (const frame of others) {
          const otherX = [frame.left, frame.left + frameDesignWidth(frame) / 2, frame.left + frameDesignWidth(frame)];
          const otherY = [frame.top, frame.top + frameDesignHeight(frame) / 2, frame.top + frameDesignHeight(frame)];
          movingX.forEach((movingValue, movingIndex) => otherX.forEach((targetValue) => { const distance = Math.abs(movingValue - targetValue); if (distance <= threshold && (!bestX || distance < bestX.distance)) bestX = { value: targetValue - [0, width / 2, width][movingIndex], distance }; }));
          movingY.forEach((movingValue, movingIndex) => otherY.forEach((targetValue) => { const distance = Math.abs(movingValue - targetValue); if (distance <= threshold && (!bestY || distance < bestY.distance)) bestY = { value: targetValue - [0, height / 2, height][movingIndex], distance }; }));
        }
        if (bestX) source.left = bestX.value; if (bestY) source.top = bestY.value;
        const dx = source.left - (source.lastLeft ?? source.left); const dy = source.top - (source.lastTop ?? source.top);
        moveFrameChildrenRealtime(source, dx, dy); source.lastLeft = source.left; source.lastTop = source.top; source.setCoords(); syncFrameLabel(source); syncFrameGrid(source); syncFrameSelectionOutlines(); canvas.requestRenderAll();
        return;
      }
    });

    let framePointerGesture: { frame: ObjectMeta; child?: ObjectMeta; startX: number; startY: number } | null = null;
    const beginFramePointerGesture = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const active = canvas.getActiveObject() as ObjectMeta | undefined;
      if (active?.kind !== "frame") return;
      const point = canvas.getScenePoint(event);
      if (!active.containsPoint(point)) return;
      const child = [...canvas.getObjects()].reverse().find((item) => {
        const meta = item as ObjectMeta;
        return meta.frameId === active.id && !isTransientObject(meta) && meta.visible && meta.evented && meta.containsPoint(point);
      }) as ObjectMeta | undefined;
      framePointerGesture = { frame: active, child, startX: event.clientX, startY: event.clientY };
      canvas.getObjects().forEach((item) => {
        const meta = item as ObjectMeta;
        if (meta.frameId === active.id) item.set({ selectable: false, evented: false });
      });
    };
    const finishFramePointerGesture = (event: MouseEvent) => {
      const gesture = framePointerGesture;
      if (!gesture) return;
      framePointerGesture = null;
      const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 3;
      setTimeout(() => {
        applyActivePageVisibility();
        if (!moved && gesture.child && canvas.getObjects().includes(gesture.child)) canvas.setActiveObject(gesture.child);
        else if (canvas.getObjects().includes(gesture.frame)) canvas.setActiveObject(gesture.frame);
        syncFrameSelectionOutlines();
        canvas.requestRenderAll(); refresh();
      }, 0);
    };
    canvas.upperCanvasEl.addEventListener("mousedown", beginFramePointerGesture, true);
    canvas.upperCanvasEl.addEventListener("mouseup", finishFramePointerGesture, true);

    const touchPoints = new Map<number, { x: number; y: number }>();
    let gestureStart: { distance: number; zoom: number; center: Point; vpt: number[] } | null = null;
    const touchPoint = (event: PointerEvent) => { const rect = canvas.upperCanvasEl.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const beginTouch = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touchPoints.set(event.pointerId, touchPoint(event));
      if (touchPoints.size === 2) {
        const [a,b] = [...touchPoints.values()];
        gestureStart = { distance: Math.hypot(b.x-a.x,b.y-a.y), zoom: canvas.getZoom(), center: new Point((a.x+b.x)/2,(a.y+b.y)/2), vpt: [...canvas.viewportTransform] };
      }
    };
    const moveTouch = (event: PointerEvent) => {
      if (!touchPoints.has(event.pointerId)) return;
      touchPoints.set(event.pointerId, touchPoint(event));
      if (touchPoints.size !== 2 || !gestureStart) return;
      event.preventDefault();
      const [a,b] = [...touchPoints.values()]; const center = new Point((a.x+b.x)/2,(a.y+b.y)/2);
      const distanceRatio = Math.hypot(b.x-a.x,b.y-a.y) / gestureStart.distance;
      const nextZoom = Math.max(MIN_CANVAS_ZOOM, Math.min(3, gestureStart.zoom * Math.pow(distanceRatio, TOUCH_PINCH_SENSITIVITY)));
      const worldX = (gestureStart.center.x - gestureStart.vpt[4]) / gestureStart.zoom;
      const worldY = (gestureStart.center.y - gestureStart.vpt[5]) / gestureStart.zoom;
      canvas.setViewportTransform([nextZoom,0,0,nextZoom,center.x-worldX*nextZoom,center.y-worldY*nextZoom]);
      syncAllFrameLabels(); syncFrameSelectionOutlines();
      canvas.requestRenderAll();
    };
    const endTouch = (event: PointerEvent) => { touchPoints.delete(event.pointerId); if (touchPoints.size < 2) gestureStart = null; };
    canvas.upperCanvasEl.addEventListener("pointerdown", beginTouch);
    canvas.upperCanvasEl.addEventListener("pointermove", moveTouch, { passive:false });
    canvas.upperCanvasEl.addEventListener("pointerup", endTouch); canvas.upperCanvasEl.addEventListener("pointercancel", endTouch);

    const afterChange = ({ target }: { target?: FabricObject }) => {
      const changed = target as ObjectMeta | undefined;
      if (restoring.current || handlingMultiFrameMove.current) return;
      if (changed instanceof Rect && (changed.kind === "mask-edit-overlay" || changed.kind === "mask-shape")) {
        syncMaskFromOverlay(changed);
        commit();
        return;
      }
      if (changed instanceof ActiveSelection) {
        const selectedFrames = (changed.getObjects() as ObjectMeta[]).filter((object) => object.kind === "frame");
        const movedFrames = selectedFrames.map((frame) => ({ frame, worldMatrix: frame.calcTransformMatrix(), origin: activeFrameWorldOrigins.current.get(String(frame.id)) }));
        handlingMultiFrameMove.current = true;
        restoring.current = true;
        try {
          changed.removeAll();
          canvas.discardActiveObject();
          movedFrames.forEach(({ frame, worldMatrix, origin }) => {
            util.applyTransformToObject(frame, worldMatrix);
            frame.setCoords();
            const bounds = frame.getBoundingRect();
            const dx = origin ? bounds.left - origin.left : 0;
            const dy = origin ? bounds.top - origin.top : 0;
            moveFrameChildrenRealtime(frame, dx, dy);
            frame.lastLeft = frame.left; frame.lastTop = frame.top;
            syncFrameLabel(frame); syncFrameGrid(frame);
            activeFrameWorldOrigins.current.delete(String(frame.id));
          });
          if (selectedFrames.length > 1) canvas.setActiveObject(new ActiveSelection(selectedFrames, { canvas }));
        } finally {
          restoring.current = false;
          handlingMultiFrameMove.current = false;
        }
        commit();
        return;
      }
      if (changed?.kind === "frame") {
        const dx = changed.left - (changed.lastLeft ?? changed.left);
        const dy = changed.top - (changed.lastTop ?? changed.top);
        changed.set({ width: changed.width * changed.scaleX, height: changed.height * changed.scaleY, scaleX: 1, scaleY: 1 });
        syncFrameChildren(changed, dx, dy);
        changed.lastLeft = changed.left; changed.lastTop = changed.top;
        syncFrameLabel(changed); syncFrameGrid(changed);
      } else if (changed) {
        if (changed instanceof Rect && changed.kind === "rectangle" && (Math.abs(changed.scaleX - 1) > .001 || Math.abs(changed.scaleY - 1) > .001)) {
          const width = Math.max(1, changed.width * changed.scaleX); const height = Math.max(1, changed.height * changed.scaleY); const radius = Math.min(changed.rx, width / 2, height / 2);
          changed.set({ width, height, rx: radius, ry: radius, scaleX: 1, scaleY: 1 }); changed.setCoords();
        }
        if (changed instanceof Textbox && (Math.abs(changed.scaleX - 1) > .001 || Math.abs(changed.scaleY - 1) > .001)) {
          changed.set({ fontSize: Math.max(1, changed.fontSize * changed.scaleY), width: Math.max(20, changed.width * changed.scaleX), scaleX: 1, scaleY: 1 });
          changed.initDimensions(); changed.setCoords();
        }
        if (changed.kind === "mask-group") {
          const previousLeft = changed.lastLeft ?? changed.left;
          const previousTop = changed.lastTop ?? changed.top;
          const ratioX = changed.scaleX / Math.max(.0001, changed.lastScaleX ?? 1);
          const ratioY = changed.scaleY / Math.max(.0001, changed.lastScaleY ?? 1);
          changed.maskLeft = changed.left + (Number(changed.maskLeft || 0) - previousLeft) * ratioX;
          changed.maskTop = changed.top + (Number(changed.maskTop || 0) - previousTop) * ratioY;
          changed.maskWidth = Math.max(1, Number(changed.maskWidth || 1) * ratioX);
          changed.maskHeight = Math.max(1, Number(changed.maskHeight || 1) * ratioY);
          changed.maskRadius = Math.max(0, Number(changed.maskRadius || 0) * Math.min(ratioX, ratioY));
          changed.lastLeft = changed.left; changed.lastTop = changed.top; changed.lastScaleX = changed.scaleX; changed.lastScaleY = changed.scaleY;
        }
        const destination = findContainingFrame(changed);
        if (destination) {
          applyFrameClip(changed, destination);
          if (changed instanceof Group && (changed.kind === "group" || changed.kind === "mask-group")) syncGroupMemberFrame(changed as Group & ObjectMeta, destination);
        } else {
          changed.frameId = undefined;
          if (changed.kind === "mask-group") applyMaskGroupClip(changed); else changed.clipPath = undefined;
          changed.set({ dirty: true });
          if (changed instanceof Group && (changed.kind === "group" || changed.kind === "mask-group")) syncGroupMemberFrame(changed as Group & ObjectMeta);
        }
      }
      commit();
    };
    canvas.on("object:modified", afterChange);
    canvas.on("object:added", () => commit());
    canvas.on("object:removed", () => commit());
    let normalizingFrameSelection = false;
    const refreshSelection = () => {
      const active = canvas.getActiveObject();
      if (!normalizingFrameSelection && active instanceof ActiveSelection) {
        const selectedObjects = active.getObjects() as ObjectMeta[];
        const selectedFrames = selectedObjects.filter((object) => object.kind === "frame");
        if (selectedFrames.length && selectedFrames.length !== selectedObjects.length) {
          normalizingFrameSelection = true;
          active.removeAll();
          canvas.discardActiveObject();
          canvas.setActiveObject(selectedFrames.length === 1 ? selectedFrames[0] : new ActiveSelection(selectedFrames, { canvas }));
          canvas.requestRenderAll();
          normalizingFrameSelection = false;
        }
        if (selectedFrames.length === selectedObjects.length) selectedFrames.forEach((frame) => { if (frame.id && !activeFrameWorldOrigins.current.has(String(frame.id))) { const bounds = frame.getBoundingRect(); activeFrameWorldOrigins.current.set(String(frame.id), { left: bounds.left, top: bounds.top }); } });
      }
      const styledActive = canvas.getActiveObject();
      if (styledActive) applyObjectSelectionStyle(styledActive);
      canvas.getActiveObjects().forEach((object) => applyObjectSelectionStyle(object));
      canvas.uniformScaling = (canvas.getActiveObject() as ObjectMeta | undefined)?.kind !== "rectangle";
      applyActivePageVisibility();
      syncFrameSelectionOutlines();
      canvas.requestRenderAll();
      refresh();
    };
    canvas.on("selection:created", refreshSelection); canvas.on("selection:updated", refreshSelection); canvas.on("selection:cleared", () => { activeFrameWorldOrigins.current.clear(); canvas.uniformScaling = true; applyActivePageVisibility(); syncFrameSelectionOutlines(); canvas.requestRenderAll(); refresh(); });

    const onKeyDown = (event: KeyboardEvent) => {
      const editing = ["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName);
      if (event.key === "Escape" && (textToolActiveRef.current || rectangleToolActiveRef.current)) {
        event.preventDefault();
        if (textBoxPreview) canvas.remove(textBoxPreview);
        textBoxStart = null; textBoxPreview = null; restoring.current = false; textToolActiveRef.current = false; rectangleToolActiveRef.current = false; setTextToolActive(false); setRectangleToolActive(false); canvas.selection = true; canvas.defaultCursor = "default"; canvas.hoverCursor = "move"; canvas.moveCursor = "move"; canvas.requestRenderAll();
        return;
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        restoreHistory(historyIndex.current + (event.shiftKey ? 1 : -1));
        return;
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault(); copySelectedFrame(); return;
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        event.preventDefault(); void pasteCopiedFrame(); return;
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelectedObject(); else groupSelectedObjects();
        return;
      }
      if (event.code === "Space" && !editing) { event.preventDefault(); spacePressed.current = true; canvas.defaultCursor = "grab"; }
      if ((event.key === "Backspace" || event.key === "Delete") && !editing) { event.preventDefault(); removeSelected(); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") { spacePressed.current = false; canvas.defaultCursor = "default"; } };
    window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp);

    const legacy = localStorage.getItem(LEGACY_PROJECT_KEY);
    Promise.all([localGet<string>(PROJECT_KEY), localGet<{ pages: EditorPage[]; activePageId: string }>(PAGES_KEY)]).then(([saved, pageState]) => {
    if (pageState?.pages?.length) { pagesRef.current = pageState.pages; setPages(pageState.pages); activePageIdRef.current = pageState.pages.some((page) => page.id === pageState.activePageId) ? pageState.activePageId : pageState.pages[0].id; setActivePageId(activePageIdRef.current); }
    if (saved) {
      restoring.current = true;
      const cleanSaved = sanitizeProjectJson(saved);
      canvas.loadFromJSON(cleanSaved).then(() => {
        canvas.backgroundColor = "transparent"; cleanLoadedCanvas(canvas); showPage(activePageIdRef.current, false); canvas.requestRenderAll(); history.current = [cleanSaved]; historyIndex.current = 0; restoring.current = false; commit();
      });
    } else {
      restoring.current = true;
      const frame = addFrame(800, 800, "主画板", 140, 100)!;
      if (legacy) {
        canvas.loadFromJSON(sanitizeProjectJson(legacy)).then(() => {
          cleanLoadedCanvas(canvas);
          canvas.getObjects().forEach((item) => { const obj = item as ObjectMeta; obj.pageId = DEFAULT_PAGE_ID; if (obj.kind !== "frame") { obj.id ||= newId(obj.kind || "layer"); obj.frameId = frame.id; obj.set({ left: obj.left + 140, top: obj.top + 100 }); applyFrameClip(obj, frame); } });
          canvas.add(frame); canvas.sendObjectToBack(frame); canvas.backgroundColor = "transparent"; restoring.current = false; commit();
        });
      } else {
        const title = new Textbox("让好图片，再表达一次", { left: 212, top: 192, width: 576, fontSize: 50, fontWeight: 700, fill: "#1b1b1b", textAlign: "center" }) as ObjectMeta;
        Object.assign(title, { id: newId("text"), name: "主标题", nameFollowsText: false, kind: "text", frameId: frame.id, pageId: DEFAULT_PAGE_ID }); applyFrameClip(title, frame); canvas.add(title); restoring.current = false; commit();
      }
    }});
    return () => { resize.disconnect(); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); canvas.upperCanvasEl.removeEventListener("dragenter", allowExternalImageDrop); canvas.upperCanvasEl.removeEventListener("dragover", allowExternalImageDrop); canvas.upperCanvasEl.removeEventListener("drop", handleExternalImageDrop); canvas.upperCanvasEl.removeEventListener("mousedown", beginFramePointerGesture, true); canvas.upperCanvasEl.removeEventListener("mouseup", finishFramePointerGesture, true); canvas.upperCanvasEl.removeEventListener("pointerdown", beginTouch); canvas.upperCanvasEl.removeEventListener("pointermove", moveTouch); canvas.upperCanvasEl.removeEventListener("pointerup", endTouch); canvas.upperCanvasEl.removeEventListener("pointercancel", endTouch); canvas.dispose(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Promise.all([localGet<string[]>(FONT_LIST_KEY), localGet<LocalFontMetadata[]>(FONT_META_KEY)]).then(([savedFonts, savedFontRecords]) => {
      const nextRecords = normalizeFontRecords(savedFontRecords || []);
      if (!nextRecords.length && !savedFonts?.length) return;
      const nextFonts = normalizeFonts(nextRecords.length ? nextRecords.map((font) => font.family) : savedFonts || []);
      setLocalFontRecords(nextRecords);
      setFontFamilies(nextFonts);
      setFontLoadLabel(`已加载 ${nextFonts.length} 个`);
    }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addText = () => {
    const canvas = editor.current; if (!canvas) return;
    const next = !textToolActiveRef.current;
    textToolActiveRef.current = next; rectangleToolActiveRef.current = false; setTextToolActive(next); setRectangleToolActive(false); canvas.discardActiveObject(); canvas.selection = !next; canvas.defaultCursor = next ? "crosshair" : "default"; canvas.hoverCursor = next ? "crosshair" : "move"; canvas.moveCursor = next ? "crosshair" : "move"; canvas.requestRenderAll();
  };
  const addRectangle = () => {
    const canvas = editor.current; if (!canvas) return;
    const next = !rectangleToolActiveRef.current;
    rectangleToolActiveRef.current = next; textToolActiveRef.current = false; setRectangleToolActive(next); setTextToolActive(false); canvas.discardActiveObject(); canvas.selection = !next; canvas.defaultCursor = next ? "crosshair" : "default"; canvas.hoverCursor = next ? "crosshair" : "move"; canvas.moveCursor = next ? "crosshair" : "move"; canvas.requestRenderAll();
  };

  const uploadImage = (event: ChangeEvent<HTMLInputElement>, kind: "image" | "logo") => {
    const file = event.target.files?.[0]; const canvas = editor.current; const frame = getActiveFrame(); if (!file || !canvas) return;
    const reader = new FileReader(); reader.onload = async () => {
      const image = await FabricImage.fromURL(String(reader.result)) as ObjectMeta;
      image.set({ left: (frame?.left ?? 80) + 50, top: (frame?.top ?? 100) + 180, scaleX: 1, scaleY: 1 });
      Object.assign(image, { id: newId(kind), name: kind === "logo" ? "Logo" : file.name, kind, frameId: frame?.id, pageId: activePageIdRef.current }); if (frame) applyFrameClip(image, frame);
      canvas.add(image); canvas.setActiveObject(image); canvas.requestRenderAll(); commit();
    }; reader.readAsDataURL(file); event.target.value = "";
  };

  const saveProjectFile = () => {
    if (!editor.current) return;
    const project: PixelProjectFile = { format: "pixel-local", version: 1, exportedAt: new Date().toISOString(), pages: pagesRef.current, activePageId: activePageIdRef.current, canvas: JSON.parse(serialize()) };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    link.download = `Pixel-Local-${stamp}.pixel.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setSavedState("项目文件已保存");
  };

  const openProjectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const canvas = editor.current;
    event.target.value = "";
    if (!file || !canvas) return;
    try {
      const project = JSON.parse(await file.text()) as Partial<PixelProjectFile>;
      if (project.format !== "pixel-local" || project.version !== 1 || !Array.isArray(project.pages) || !project.pages.length || !project.canvas) throw new Error("invalid project");
      const pagesFromFile = project.pages.filter((page) => page && typeof page.id === "string" && typeof page.name === "string");
      if (!pagesFromFile.length) throw new Error("invalid pages");
      const activeFromFile = pagesFromFile.some((page) => page.id === project.activePageId) ? String(project.activePageId) : pagesFromFile[0].id;
      const cleanJson = sanitizeProjectJson(JSON.stringify(project.canvas));
      restoring.current = true;
      pagesRef.current = pagesFromFile;
      activePageIdRef.current = activeFromFile;
      setPages(pagesFromFile);
      setActivePageId(activeFromFile);
      await canvas.loadFromJSON(cleanJson);
      canvas.backgroundColor = "transparent";
      cleanLoadedCanvas(canvas);
      showPage(activeFromFile, false);
      canvas.requestRenderAll();
      history.current = [serialize()];
      historyIndex.current = 0;
      restoring.current = false;
      await localSet(PROJECT_KEY, serialize());
      await localSet(PAGES_KEY, { pages: pagesFromFile, activePageId: activeFromFile });
      refresh();
      setSavedState(`已打开 ${file.name}`);
    } catch {
      restoring.current = false;
      setSavedState("无法打开：不是有效的 .pixel.json 项目文件");
    }
  };

  const updateSelected = (patch: Record<string, unknown>) => { const active = editor.current?.getActiveObject() as ObjectMeta | undefined; if (!active) return; if (active instanceof Textbox && ("stroke" in patch || "strokeWidth" in patch)) patch.paintFirst = "stroke"; active.set(patch); active.setCoords(); if (active.kind === "frame") syncFrameLabel(active); if (active instanceof Rect && (active.kind === "mask-edit-overlay" || active.kind === "mask-shape")) syncMaskFromOverlay(active); editor.current?.requestRenderAll(); commit(); };
  const updateTextShadow = (patch: Partial<{ color: string; blur: number; offsetX: number; offsetY: number }> | null) => {
    const active = editor.current?.getActiveObject();
    if (!(active instanceof Textbox)) return;
    if (patch === null) return updateSelected({ shadow: null });
    const current = active.shadow instanceof Shadow ? active.shadow : undefined;
    updateSelected({ shadow: new Shadow({ color: current?.color || "#00000066", blur: current?.blur ?? 8, offsetX: current?.offsetX ?? 4, offsetY: current?.offsetY ?? 4, ...patch }) });
  };
  const applySelectedFont = async (patch: { fontFamily?: string; fontStyle?: string; fontWeight?: number }) => {
    const active = editor.current?.getActiveObject();
    if (!(active instanceof Textbox)) return;
    const fontFamily = patch.fontFamily || String(active.fontFamily || FALLBACK_FONTS[0]);
    try {
      const fonts = localFontDataRef.current.length ? localFontDataRef.current : await queryAndCacheLocalFonts();
      await registerLocalFontFamily(fontFamily, fonts);
    } catch { /* Built-in fonts and denied local-font access continue through normal browser font matching. */ }
    try { await document.fonts.load(`${patch.fontStyle || active.fontStyle || "normal"} ${patch.fontWeight || active.fontWeight || 400} 16px "${fontFamily.replaceAll('"', '\\"')}"`); } catch { /* Fabric still gets the requested family and the browser may resolve it later. */ }
    active.set(patch); active.initDimensions(); active.set({ dirty: true }); active.setCoords();
    editor.current?.requestRenderAll(); refresh(); commit();
  };
  const updateSelectedFontFamily = async (fontFamily: string) => {
    const variants = getFontVariants(fontFamily);
    const currentWeight = parseFontWeight(selected?.fontWeight);
    const currentStyle = selected?.fontStyle || "normal";
    const variant = variants.find((item) => item.fontStyle === currentStyle && item.fontWeight === currentWeight) || variants[0];
    await applySelectedFont({ fontFamily, fontStyle: variant?.fontStyle || "normal", fontWeight: variant?.fontWeight || 400 });
  };
  const updateSelectedFontVariant = async (variantKey: string) => {
    const variant = selectedFontVariants.find((item) => item.key === variantKey);
    if (!variant) return;
    await applySelectedFont({ fontStyle: variant.fontStyle, fontWeight: variant.fontWeight });
  };
  const updateObjectDimension = (dimension: "width" | "height", rawValue: string, input: HTMLInputElement) => {
    // Inspector focus can clear Fabric's active object before blur fires. The
    // inspector's selected id remains stable, so use it as the write target.
    const object = findLayerById(selected?.id) || editor.current?.getActiveObject() as ObjectMeta | undefined;
    const value = Number(rawValue);
    if (!object) return;
    const minimum = object instanceof Rect && ["rectangle", "mask-edit-overlay", "mask-shape"].includes(String(object.kind)) ? Math.max(1, Math.round(object.rx) * 2) : 40;
    if (!Number.isFinite(value) || value < minimum || value > 10000) {
      input.value = String(dimension === "width" ? objectDesignWidth(object) : objectDesignHeight(object));
      setSavedState(`尺寸需在 ${minimum}–10000 之间`);
      return;
    }
    if (object.kind === "frame" || ["rectangle", "mask-edit-overlay", "mask-shape"].includes(String(object.kind))) object.set({ [dimension]: Math.round(value), scaleX: 1, scaleY: 1 });
    else if (object instanceof FabricImage || object instanceof Group) object.set({ [dimension === "width" ? "scaleX" : "scaleY"]: value / Math.max(1, dimension === "width" ? object.width : object.height) });
    else if (object instanceof Textbox && dimension === "width") object.set({ width: Math.round(value), scaleX: 1 });
    else if (object instanceof Textbox) object.set({ fontSize: Math.max(1, object.fontSize * value / Math.max(1, object.getScaledHeight())), scaleY: 1 });
    if (object.kind === "frame") { syncFrameChildren(object); syncFrameLabel(object); syncFrameGrid(object); }
    if (object instanceof Rect && ["rectangle", "mask-edit-overlay", "mask-shape"].includes(String(object.kind))) { const radius = Math.min(object.rx, object.width / 2, object.height / 2); object.set({ rx: radius, ry: radius }); }
    if (object instanceof Rect && (object.kind === "mask-edit-overlay" || object.kind === "mask-shape")) syncMaskFromOverlay(object);
    object.setCoords(); editor.current?.requestRenderAll(); commit();
  };
  const handleDimensionKeyDown = (event: KeyboardEvent<HTMLInputElement>, currentValue: number) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.value = String(currentValue);
      event.currentTarget.blur();
    }
  };
  const updateObjectPosition = (axis: "x" | "y", rawValue: string, input: HTMLInputElement) => {
    const object = editor.current?.getActiveObject() as ObjectMeta | undefined;
    const value = Number(rawValue);
    if (!object || !Number.isFinite(value)) { if (selected) input.value = String(axis === "x" ? selected.x : selected.y); return; }
    const frame = object.frameId ? frames().find((item) => item.id === object.frameId) : undefined;
    object.set({ [axis === "x" ? "left" : "top"]: Math.round(value) + (axis === "x" ? frame?.left || 0 : frame?.top || 0) });
    object.setCoords(); if (object instanceof Rect && (object.kind === "mask-edit-overlay" || object.kind === "mask-shape")) syncMaskFromOverlay(object); else if (frame) applyFrameClip(object, frame); editor.current?.requestRenderAll(); commit();
  };
  const updateRectangleRadius = (rawValue: string) => {
    const object = editor.current?.getActiveObject();
    if (!(object instanceof Rect) || !["rectangle", "mask-edit-overlay", "mask-shape"].includes(String((object as ObjectMeta).kind))) return;
    const radius = Math.max(0, Math.min(Math.round(Number(rawValue) || 0), Math.floor(Math.min(object.width, object.height) / 2)));
    object.set({ rx: radius, ry: radius, dirty: true }); object.setCoords(); if (["mask-edit-overlay", "mask-shape"].includes(String((object as ObjectMeta).kind))) syncMaskFromOverlay(object as Rect & ObjectMeta); editor.current?.requestRenderAll(); refresh(); commit();
  };
  const removeSelected = () => {
    const canvas = editor.current;
    const active = canvas?.getActiveObjects() as ObjectMeta[] | undefined;
    if (!canvas || !active?.length) return;
    const ids = new Set(active.filter((item) => item.kind === "frame").map((item) => item.id));
    restoring.current = true;
    try {
      canvas.discardActiveObject();
      canvas.getObjects().filter((item) => ids.has((item as ObjectMeta).frameId)).forEach((item) => canvas.remove(item));
      active.forEach((item) => canvas.remove(item));
    } finally {
      restoring.current = false;
    }
    canvas.requestRenderAll();
    commit();
  };
  const removeLayerObject = (object: ObjectMeta) => {
    const canvas = editor.current;
    if (!canvas) return;
    restoring.current = true;
    try {
      if (object.kind === "frame") canvas.getObjects().filter((item) => (item as ObjectMeta).frameId === object.id).forEach((item) => canvas.remove(item));
      canvas.discardActiveObject();
      if (object.group instanceof Group) {
        const parent = object.group;
        parent.remove(object);
        parent.set({ dirty: true }); parent.setCoords();
        if (parent.getObjects().length === 0) canvas.remove(parent);
      } else canvas.remove(object);
    } finally {
      restoring.current = false;
    }
    canvas.requestRenderAll();
    setEditingLayerId(null);
    commit();
  };
  const findLayerById = (id?: string): ObjectMeta | undefined => {
    if (!id) return undefined;
    const visit = (objects: FabricObject[]): ObjectMeta | undefined => {
      for (const object of objects) {
        const meta = object as ObjectMeta;
        if (meta.id === id) return meta;
        if (object instanceof Group) { const nested = visit(object.getObjects()); if (nested) return nested; }
      }
    };
    return visit(editor.current?.getObjects() || []);
  };
  const moveLayerIntoGroup = (layerId: string | null, targetGroup: Group & ObjectMeta) => {
    const canvas = editor.current;
    const object = findLayerById(layerId || undefined);
    if (!canvas || !object || object === targetGroup || object.kind === "frame" || object.kind === "group" || object.frameId !== targetGroup.frameId || object.group === targetGroup) return;
    restoring.current = true;
    canvas.discardActiveObject();
    if (object.group instanceof Group) object.group.remove(object); else canvas.remove(object);
    targetGroup.add(object);
    Object.assign(object, { frameId: targetGroup.frameId, pageId: targetGroup.pageId });
    object.set({ visible: !object.hidden, dirty: true });
    targetGroup.set({ dirty: true }); targetGroup.setCoords();
    restoring.current = false;
    setExpandedGroupIds((current) => new Set(current).add(String(targetGroup.id)));
    canvas.setActiveObject(targetGroup); canvas.requestRenderAll(); setDraggingLayerId(null); setDropLayerId(null); commit();
  };
  const moveLayerOutOfGroup = (layerId: string | null, beforeId?: string) => {
    const canvas = editor.current;
    const object = findLayerById(layerId || undefined);
    const parent = object?.group as (Group & ObjectMeta) | undefined;
    if (!canvas || !object || !(parent instanceof Group) || parent.kind !== "group") return undefined;
    restoring.current = true;
    canvas.discardActiveObject();
    parent.remove(object);
    Object.assign(object, { frameId: parent.frameId, pageId: parent.pageId });
    object.set({ visible: !object.hidden, dirty: true });
    canvas.add(object);
    const target = beforeId ? canvas.getObjects().find((item) => (item as ObjectMeta).id === beforeId) : undefined;
    if (target) canvas.moveObjectTo(object, canvas.getObjects().indexOf(target));
    parent.set({ dirty: true }); parent.setCoords(); object.setCoords();
    restoring.current = false;
    canvas.setActiveObject(object); canvas.requestRenderAll(); setDraggingLayerId(null); setDropLayerId(null); commit();
    return object;
  };
  const reorderLayer = (targetId: string, frameId?: string) => {
    const canvas = editor.current;
    if (!canvas || !draggingLayerId || draggingLayerId === targetId || !frameId) return;
    const nested = findLayerById(draggingLayerId);
    if (nested?.group instanceof Group) moveLayerOutOfGroup(draggingLayerId, targetId);
    const siblingsTopFirst = canvas.getObjects().filter((layer) => { const meta = layer as ObjectMeta; return !isTransientObject(meta) && meta.kind !== "frame" && meta.frameId === frameId; }).reverse();
    const dragged = siblingsTopFirst.find((layer) => (layer as ObjectMeta).id === draggingLayerId);
    const targetIndex = siblingsTopFirst.findIndex((layer) => (layer as ObjectMeta).id === targetId);
    if (!dragged || targetIndex < 0 || (dragged as ObjectMeta).frameId !== frameId) return;
    const nextTopFirst = siblingsTopFirst.filter((layer) => layer !== dragged);
    const insertionIndex = nextTopFirst.findIndex((layer) => (layer as ObjectMeta).id === targetId);
    nextTopFirst.splice(Math.max(0, insertionIndex), 0, dragged);
    const occupiedIndices = siblingsTopFirst.map((layer) => canvas.getObjects().indexOf(layer)).sort((a, b) => a - b);
    [...nextTopFirst].reverse().forEach((layer, index) => canvas.moveObjectTo(layer, occupiedIndices[index]));
    canvas.setActiveObject(dragged); canvas.requestRenderAll(); setDraggingLayerId(null); setDropLayerId(null); commit();
  };
  const alignSelectedObjects = (alignment: ObjectAlignment, save = true) => {
    const canvas = editor.current;
    const objects = canvas?.getActiveObjects().filter((item) => (item as ObjectMeta).kind !== "frame") as ObjectMeta[] || [];
    const frameId = objects[0]?.frameId;
    if (!canvas || objects.length < 2 || !frameId || objects.some((object) => object.frameId !== frameId)) return [];
    canvas.discardActiveObject();
    const bounds = objects.map((object) => object.getBoundingRect());
    const left = Math.min(...bounds.map((bound) => bound.left)); const top = Math.min(...bounds.map((bound) => bound.top));
    const right = Math.max(...bounds.map((bound) => bound.left + bound.width)); const bottom = Math.max(...bounds.map((bound) => bound.top + bound.height));
    objects.forEach((object, index) => {
      const bound = bounds[index]; let dx = 0; let dy = 0;
      if (alignment === "left") dx = left - bound.left;
      if (alignment === "center") dx = (left + right) / 2 - (bound.left + bound.width / 2);
      if (alignment === "right") dx = right - (bound.left + bound.width);
      if (alignment === "top") dy = top - bound.top;
      if (alignment === "middle") dy = (top + bottom) / 2 - (bound.top + bound.height / 2);
      if (alignment === "bottom") dy = bottom - (bound.top + bound.height);
      object.set({ left: object.left + dx, top: object.top + dy }); object.setCoords();
      if (object.frameId) { const frame = frames().find((item) => item.id === object.frameId); if (frame) applyFrameClip(object, frame); }
    });
    canvas.setActiveObject(new ActiveSelection(objects, { canvas })); canvas.requestRenderAll();
    if (save) commit(); else refresh();
    return objects.map((object) => String(object.id));
  };
  const groupSelectedObjects = () => {
    const canvas = editor.current;
    const active = canvas?.getActiveObject();
    const objects = canvas?.getActiveObjects() as ObjectMeta[] || [];
    const frameId = objects[0]?.frameId;
    const pageId = objects[0]?.pageId || activePageIdRef.current;
    if (!canvas || !(active instanceof ActiveSelection) || objects.length < 2 || objects.some((object) => object.kind === "frame" || object.frameId !== frameId || (object.pageId || DEFAULT_PAGE_ID) !== pageId)) {
      setSavedState("请选择同一 Frame 或同一画板外区域的至少两个图层");
      return;
    }
    const topIndex = Math.max(...objects.map((object) => canvas.getObjects().indexOf(object)));
    let group: Group & ObjectMeta;
    restoring.current = true;
    try {
      const members = active.removeAll() as ObjectMeta[];
      canvas.discardActiveObject();
      canvas.remove(...members);
      group = new Group(members, { subTargetCheck: true, interactive: false }) as Group & ObjectMeta;
      Object.assign(group, { id: newId("group"), name: `编组 ${canvas.getObjects().filter((item) => (item as ObjectMeta).kind === "group").length + 1}`, kind: "group", frameId, pageId });
      applyObjectSelectionStyle(group);
      canvas.add(group);
      canvas.moveObjectTo(group, Math.min(topIndex, canvas.getObjects().length - 1));
      Object.assign(rectangle, { kind: "mask-shape", maskGroupId: group.id, frameId, pageId, hidden: false });
      rectangle.set({ left: maskBounds.left, top: maskBounds.top, width: maskBounds.width, height: maskBounds.height, scaleX: 1, scaleY: 1, rx: group.maskRadius, ry: group.maskRadius, fill: "rgba(47,124,255,0.001)", stroke: "rgba(47,124,255,0)", strokeWidth: 0, visible: true, selectable: true, evented: true });
      attachRectangleRadiusControl(rectangle); applyObjectSelectionStyle(rectangle); rectangle.setCoords(); canvas.add(rectangle); canvas.bringObjectToFront(rectangle);
      setExpandedGroupIds((current) => new Set(current).add(String(group.id)));
      canvas.setActiveObject(group);
    } finally {
      restoring.current = false;
    }
    canvas.requestRenderAll();
    commit();
  };
  const ungroupSelectedObject = () => {
    const canvas = editor.current;
    const group = canvas?.getActiveObject() as (Group & ObjectMeta) | undefined;
    if (!canvas || !(group instanceof Group) || group.kind !== "group") {
      setSavedState("请先选择一个编组");
      return;
    }
    const groupIndex = canvas.getObjects().indexOf(group);
    const frameId = group.frameId;
    const pageId = group.pageId || activePageIdRef.current;
    restoring.current = true;
    try {
      canvas.discardActiveObject();
      const members = group.removeAll() as ObjectMeta[];
      canvas.remove(group);
      members.forEach((object, index) => {
        Object.assign(object, { frameId, pageId });
        object.clipPath = undefined;
        applyObjectSelectionStyle(object);
        canvas.add(object);
        canvas.moveObjectTo(object, Math.min(groupIndex + index, canvas.getObjects().length - 1));
        object.setCoords();
      });
      canvas.setActiveObject(new ActiveSelection(members, { canvas }));
    } finally {
      restoring.current = false;
    }
    canvas.requestRenderAll();
    commit();
  };
  const canCreateMask = () => {
    const objects = editor.current?.getActiveObjects() as ObjectMeta[] || [];
    return objects.length === 2
      && objects.some((object) => object instanceof Rect && object.kind === "rectangle")
      && objects.some((object) => object instanceof FabricImage)
      && objects[0].frameId === objects[1].frameId
      && (objects[0].pageId || DEFAULT_PAGE_ID) === (objects[1].pageId || DEFAULT_PAGE_ID);
  };
  const createMaskFromSelection = () => {
    const canvas = editor.current;
    const active = canvas?.getActiveObject();
    const objects = canvas?.getActiveObjects() as ObjectMeta[] || [];
    const rectangle = objects.find((object) => object instanceof Rect && object.kind === "rectangle") as (Rect & ObjectMeta) | undefined;
    const image = objects.find((object) => object instanceof FabricImage) as (FabricImage & ObjectMeta) | undefined;
    if (!canvas || !(active instanceof ActiveSelection) || objects.length !== 2 || !rectangle || !image || rectangle.frameId !== image.frameId || (rectangle.pageId || DEFAULT_PAGE_ID) !== (image.pageId || DEFAULT_PAGE_ID)) {
      setSavedState("请选择同一 Frame 内的一张图片和一个矩形");
      return;
    }
    if (Math.abs(rectangle.angle || 0) > 0.01) { setSavedState("第一版蒙版暂不支持旋转矩形"); return; }
    const maskBounds = rectangle.getBoundingRect();
    const topIndex = Math.max(...objects.map((object) => canvas.getObjects().indexOf(object)));
    const frameId = image.frameId;
    const pageId = image.pageId || activePageIdRef.current;
    let group: Group & ObjectMeta;
    restoring.current = true;
    try {
      active.removeAll();
      canvas.discardActiveObject();
      canvas.remove(rectangle, image);
      image.clipPath = undefined;
      group = new Group([image], { subTargetCheck: true, interactive: false }) as Group & ObjectMeta;
      Object.assign(group, {
        id: newId("mask"), name: `蒙版｜${image.name || "图片"}`, kind: "mask-group", frameId, pageId,
        maskLeft: maskBounds.left, maskTop: maskBounds.top, maskWidth: maskBounds.width, maskHeight: maskBounds.height,
        maskRadius: Math.max(0, Number(rectangle.rx || 0) * Number(rectangle.scaleX || 1)), maskShapeId: rectangle.id || newId("rectangle"), maskShapeName: rectangle.name || "矩形",
        maskFill: typeof rectangle.fill === "string" ? rectangle.fill : "#d9d9d9",
        maskStroke: typeof rectangle.stroke === "string" ? rectangle.stroke : "#1b1b1b",
        maskStrokeWidth: Number(rectangle.strokeWidth || 0),
        lastLeft: group.left, lastTop: group.top, lastScaleX: group.scaleX, lastScaleY: group.scaleY,
      });
      syncGroupMemberFrame(group, frameId ? frames().find((frame) => frame.id === frameId) : undefined);
      applyMaskGroupClip(group, frameId ? frames().find((frame) => frame.id === frameId) : undefined);
      applyObjectSelectionStyle(group);
      canvas.add(group);
      canvas.moveObjectTo(group, Math.min(topIndex, canvas.getObjects().length - 1));
      setExpandedGroupIds((current) => new Set(current).add(String(group.id)));
      canvas.setActiveObject(group);
    } finally { restoring.current = false; }
    canvas.requestRenderAll();
    commit();
  };
  const releaseSelectedMask = () => {
    const canvas = editor.current;
    const group = canvas?.getActiveObject() as (Group & ObjectMeta) | undefined;
    if (!canvas || !(group instanceof Group) || group.kind !== "mask-group") { setSavedState("请先选择一个蒙版组"); return; }
    const groupIndex = canvas.getObjects().indexOf(group);
    const frame = group.frameId ? frames().find((item) => item.id === group.frameId) : undefined;
    const pageId = group.pageId || activePageIdRef.current;
    restoring.current = true;
    try {
      canvas.discardActiveObject();
      group.clipPath = undefined;
      const worldTransforms = new Map(group.getObjects().map((object) => [object, object.calcTransformMatrix()]));
      const members = group.removeAll() as ObjectMeta[];
      canvas.remove(group);
      members.forEach((object, index) => {
        const worldTransform = worldTransforms.get(object);
        if (worldTransform) util.applyTransformToObject(object, worldTransform);
        Object.assign(object, { frameId: frame?.id, pageId });
        applyObjectSelectionStyle(object);
        if (frame) applyFrameClip(object, frame); else object.clipPath = undefined;
        canvas.add(object); canvas.moveObjectTo(object, Math.min(groupIndex + index, canvas.getObjects().length - 1)); object.setCoords();
      });
      let rectangle = canvas.getObjects().find((item) => (item as ObjectMeta).kind === "mask-shape" && (item as ObjectMeta).maskGroupId === group.id) as (Rect & ObjectMeta) | undefined;
      if (!rectangle) rectangle = new Rect({ left: Number(group.maskLeft || 0), top: Number(group.maskTop || 0), width: Number(group.maskWidth || 1), height: Number(group.maskHeight || 1), rx: Number(group.maskRadius || 0), ry: Number(group.maskRadius || 0), originX: "left", originY: "top" }) as Rect & ObjectMeta;
      const restoredShapeId = group.maskShapeId && !canvas.getObjects().some((item) => item !== rectangle && (item as ObjectMeta).id === group.maskShapeId) ? group.maskShapeId : newId("rectangle");
      Object.assign(rectangle, { id: restoredShapeId, name: group.maskShapeName || "矩形", kind: "rectangle", maskGroupId: undefined, frameId: frame?.id, pageId });
      rectangle.set({ fill: group.maskFill || "#d9d9d9", stroke: group.maskStroke || "#1b1b1b", strokeWidth: Number(group.maskStrokeWidth || 0), opacity: 1, visible: true });
      attachRectangleRadiusControl(rectangle);
      if (frame) applyFrameClip(rectangle, frame);
      if (!canvas.getObjects().includes(rectangle)) canvas.add(rectangle);
      canvas.moveObjectTo(rectangle, Math.min(groupIndex + members.length, canvas.getObjects().length - 1)); rectangle.setCoords();
      canvas.setActiveObject(new ActiveSelection([...members, rectangle], { canvas }));
    } finally { restoring.current = false; }
    canvas.requestRenderAll();
    commit();
  };
  const restoreHistory = async (next: number) => {
    const canvas = editor.current; const json = history.current[next];
    if (!canvas || !json) return;
    const cleanJson = sanitizeProjectJson(json);
    const currentViewport = [...canvas.viewportTransform];
    restoring.current = true; historyIndex.current = next;
    await canvas.loadFromJSON(cleanJson);
    canvas.backgroundColor = "transparent";
    cleanLoadedCanvas(canvas);
    showPage(activePageIdRef.current, false);
    canvas.setViewportTransform(currentViewport);
    syncFrameSelectionOutlines();
    canvas.requestRenderAll();
    restoring.current = false;
    await localSet(PROJECT_KEY, cleanJson);
    refresh();
  };

  const getPixelLocalSnapshot = (): PixelLocalSnapshot => ({
    version: 1,
    activePageId: activePageIdRef.current,
    pages: pagesRef.current.map((page) => ({ ...page })),
    objects: (editor.current?.getObjects() || []).filter((item) => !isTransientObject(item as ObjectMeta)).map((item) => {
      const object = item as ObjectMeta;
      return {
        id: object.id,
        name: object.name,
        kind: object.kind || object.type,
        pageId: object.pageId || DEFAULT_PAGE_ID,
        frameId: object.frameId,
        left: object.left,
        top: object.top,
        width: objectDesignWidth(object),
        height: objectDesignHeight(object),
        angle: object.angle,
        opacity: object.opacity,
        visible: object.visible,
        hidden: Boolean(object.hidden),
        ...(object.kind === "frame" ? { gridPreset: object.gridPreset || "0", sidebarCollapsed: collapsedFrameIdsRef.current.has(String(object.id)) } : {}),
        ...(item instanceof Textbox ? { text: item.text, fontFamily: displayFontFamily(item as Textbox & ObjectMeta), fontSize: Math.round(item.fontSize), fontWeight: item.fontWeight, fontStyle: item.fontStyle, charSpacing: item.charSpacing, lineHeight: item.lineHeight, textAlign: item.textAlign, fill: item.fill, stroke: item.stroke, strokeWidth: item.strokeWidth } : {}),
        ...(item instanceof Rect && object.kind === "rectangle" ? { cornerRadius: Math.round(item.rx), fill: item.fill, stroke: item.stroke, strokeWidth: item.strokeWidth, strokeAlignment: "center" } : {}),
        ...(item instanceof FabricImage ? { hasImageSource: Boolean(item.getSrc()) } : {}),
      };
    }),
    sidebar: { collapsedFrameIds: [...collapsedFrameIdsRef.current] },
  });

  const executePixelLocalCommands = async (input: PixelLocalCommand | PixelLocalCommand[]): Promise<PixelLocalCommandResult> => {
    const canvas = editor.current;
    const commands = Array.isArray(input) ? input : [input];
    const changedIds = new Set<string>();
    const warnings: string[] = [];
    const data: Record<string, unknown> = {};
    if (!canvas) return { ok: false, changedIds: [], warnings, snapshot: getPixelLocalSnapshot(), error: "Editor is not ready" };
    if (!commands.length) return { ok: true, changedIds: [], warnings, snapshot: getPixelLocalSnapshot() };
    const historyCommands = commands.filter((command) => command.op === "history.undo" || command.op === "history.redo");
    if (historyCommands.length && commands.length > 1) return { ok: false, changedIds: [], warnings, snapshot: getPixelLocalSnapshot(), error: "History commands must run alone" };
    if (historyCommands.length) {
      const delta = historyCommands[0].op === "history.undo" ? -1 : 1;
      const next = historyIndex.current + delta;
      if (next < 0 || next >= history.current.length) warnings.push("No history entry in that direction"); else await restoreHistory(next);
      return { ok: true, changedIds: [], warnings, snapshot: getPixelLocalSnapshot() };
    }
    const beforeJson = serialize();
    const beforePages = pagesRef.current.map((page) => ({ ...page }));
    const beforeActivePageId = activePageIdRef.current;
    const beforeCollapsedFrameIds = new Set(collapsedFrameIdsRef.current);
    const objectById = (id?: string) => canvas.getObjects().find((item) => (item as ObjectMeta).id === id) as ObjectMeta | undefined;
    const requireObject = (id?: string) => { const object = objectById(id); if (!object) throw new Error(`Object not found: ${id || "missing id"}`); return object; };
    const requirePage = (id?: string) => { const page = pagesRef.current.find((item) => item.id === id); if (!page) throw new Error(`Page not found: ${id || "missing pageId"}`); return page; };
    const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    restoring.current = true;
    try {
      for (const command of commands) {
        switch (command.op) {
          case "project.getState": break;
          case "project.save": break;
          case "page.create": {
            const id = command.id || newId("page");
            if (pagesRef.current.some((page) => page.id === id)) throw new Error(`Duplicate page id: ${id}`);
            const page = { id, name: String(command.name || `页面 ${pagesRef.current.length + 1}`) };
            pagesRef.current = [...pagesRef.current, page];
            setPages(pagesRef.current);
            changedIds.add(id);
            if (command.activate !== false) showPage(id, false);
            break;
          }
          case "page.rename": {
            const page = requirePage(command.id || command.pageId);
            const name = String(command.name || "").trim();
            if (!name) throw new Error("Page name cannot be empty");
            pagesRef.current = pagesRef.current.map((item) => item.id === page.id ? { ...item, name } : item);
            setPages(pagesRef.current);
            changedIds.add(page.id);
            break;
          }
          case "page.activate": {
            const page = requirePage(command.id || command.pageId);
            showPage(page.id, false);
            break;
          }
          case "page.visibility": {
            const page = requirePage(command.id || command.pageId);
            const visible = command.visible === undefined ? Boolean(page.hidden) : Boolean(command.visible);
            pagesRef.current = pagesRef.current.map((item) => item.id === page.id ? { ...item, hidden: !visible } : item);
            setPages(pagesRef.current); changedIds.add(page.id); applyActivePageVisibility();
            break;
          }
          case "page.delete": {
            const page = requirePage(command.id || command.pageId);
            if (pagesRef.current.length <= 1) throw new Error("Cannot delete the only page");
            canvas.getObjects().filter((item) => ((item as ObjectMeta).pageId || DEFAULT_PAGE_ID) === page.id).forEach((item) => canvas.remove(item));
            pagesRef.current = pagesRef.current.filter((item) => item.id !== page.id);
            setPages(pagesRef.current);
            changedIds.add(page.id);
            showPage(activePageIdRef.current === page.id ? pagesRef.current[0].id : activePageIdRef.current, false);
            break;
          }
          case "frame.create": {
            const pageId = String(command.pageId || activePageIdRef.current);
            requirePage(pageId);
            const id = command.id || newId("frame");
            if (objectById(id)) throw new Error(`Duplicate object id: ${id}`);
            const frame = new Rect({ left: number(command.x ?? command.left, 100), top: number(command.y ?? command.top, 100), width: number(command.width, 800), height: number(command.height, 800), fill: String(command.fill || "#ffffff"), stroke: String(command.stroke || "#c7c3ba"), strokeWidth: number(command.strokeWidth, 1), originX: "left", originY: "top", shadow: command.shadow ? new Shadow(command.shadow as ConstructorParameters<typeof Shadow>[0]) : null }) as ObjectMeta;
            Object.assign(frame, { id, name: String(command.name || "Frame"), kind: "frame", pageId, lastLeft: frame.left, lastTop: frame.top });
            canvas.add(frame); canvas.sendObjectToBack(frame); syncFrameLabel(frame); changedIds.add(id);
            break;
          }
          case "frame.sidebarCollapse": {
            const collapsed = command.collapsed === undefined ? true : Boolean(command.collapsed);
            const targetFrames = command.scope === "all" || command.all === true
              ? canvas.getObjects().filter((item) => {
                  const meta = item as ObjectMeta;
                  return meta.kind === "frame" && (!command.pageId || (meta.pageId || DEFAULT_PAGE_ID) === command.pageId);
                }) as ObjectMeta[]
              : [requireObject(command.id || command.frameId)];
            if (targetFrames.some((frame) => frame.kind !== "frame")) throw new Error(`Not a frame: ${command.id || command.frameId}`);
            const next = new Set(collapsedFrameIdsRef.current);
            targetFrames.forEach((frame) => {
              const id = String(frame.id);
              if (collapsed) next.add(id); else next.delete(id);
              changedIds.add(id);
            });
            updateCollapsedFrameIds(next);
            data.sidebar = { collapsed, frameIds: targetFrames.map((frame) => String(frame.id)) };
            break;
          }
          case "rectangle.create": {
            const pageId = String(command.pageId || activePageIdRef.current);
            requirePage(pageId);
            const frame = command.frameId ? requireObject(command.frameId) : undefined;
            if (frame && frame.kind !== "frame") throw new Error(`Not a frame: ${command.frameId}`);
            const id = command.id || newId("rectangle");
            if (objectById(id)) throw new Error(`Duplicate object id: ${id}`);
            const rectangleHeight = number(command.height, 160); const radius = Math.max(0, Math.min(Math.round(number(command.cornerRadius ?? command.rx, 0)), Math.floor(rectangleHeight / 2)));
            const rectangle = new Rect({ left: number(command.x ?? command.left, 100), top: number(command.y ?? command.top, 100), width: number(command.width, 240), height: rectangleHeight, fill: String(command.fill || "#d9d9d9"), stroke: String(command.stroke || "#1b1b1b"), strokeWidth: number(command.strokeWidth, 0), strokeUniform: false, rx: radius, ry: radius, opacity: number(command.opacity, 1), originX: "left", originY: "top" }) as ObjectMeta;
            Object.assign(rectangle, { id, name: String(command.name || "矩形"), kind: "rectangle", frameId: frame?.id, pageId });
            attachRectangleRadiusControl(rectangle as Rect & ObjectMeta);
            if (frame) applyFrameClip(rectangle, frame);
            canvas.add(rectangle); changedIds.add(id);
            break;
          }
          case "text.create": {
            const pageId = String(command.pageId || activePageIdRef.current);
            requirePage(pageId);
            const frame = command.frameId ? requireObject(command.frameId) : undefined;
            if (frame && frame.kind !== "frame") throw new Error(`Not a frame: ${command.frameId}`);
            const id = command.id || newId("text");
            if (objectById(id)) throw new Error(`Duplicate object id: ${id}`);
            const text = new Textbox(String(command.text || "文字"), { left: number(command.x ?? command.left, 100), top: number(command.y ?? command.top, 100), width: number(command.width, 360), fontSize: number(command.fontSize, 36), fontFamily: String(command.fontFamily || "PingFang SC"), fontWeight: command.fontWeight as number | string || 400, fontStyle: String(command.fontStyle || "normal"), lineHeight: number(command.lineHeight, 1.16), charSpacing: number(command.charSpacing, 0), textAlign: String(command.textAlign || "left"), fill: String(command.fill || "#1b1b1b"), stroke: command.stroke ? String(command.stroke) : null, strokeWidth: number(command.strokeWidth, 0), paintFirst: "stroke", opacity: number(command.opacity, 1), originX: "left", originY: "top", shadow: command.shadow ? new Shadow(command.shadow as ConstructorParameters<typeof Shadow>[0]) : null, splitByGrapheme: true }) as ObjectMeta;
            const explicitName = typeof command.name === "string" && command.name.trim();
            Object.assign(text, { id, name: explicitName ? String(command.name) : text.text, nameFollowsText: !explicitName, kind: "text", frameId: frame?.id, pageId });
            if (frame) applyFrameClip(text, frame);
            canvas.add(text); changedIds.add(id);
            break;
          }
          case "image.create": {
            const pageId = String(command.pageId || activePageIdRef.current);
            requirePage(pageId);
            const frame = command.frameId ? requireObject(command.frameId) : undefined;
            if (frame && frame.kind !== "frame") throw new Error(`Not a frame: ${command.frameId}`);
            const id = command.id || newId("image");
            if (objectById(id)) throw new Error(`Duplicate object id: ${id}`);
            if (typeof command.src !== "string" || !command.src) throw new Error("image.create requires src");
            const image = await FabricImage.fromURL(command.src) as ObjectMeta;
            if (command.width) image.scaleToWidth(number(command.width, image.width));
            if (command.height) image.scaleY = number(command.height, image.getScaledHeight()) / image.height;
            image.set({ left: number(command.x ?? command.left, 100), top: number(command.y ?? command.top, 100), originX: "left", originY: "top", opacity: number(command.opacity, 1) });
            Object.assign(image, { id, name: String(command.name || "图片"), kind: String(command.kind || "image"), frameId: frame?.id, pageId });
            if (frame) applyFrameClip(image, frame);
            canvas.add(image); changedIds.add(id);
            break;
          }
          case "image.replace": {
            const object = requireObject(command.id);
            if (!(object instanceof FabricImage) || typeof command.src !== "string") throw new Error("image.replace requires an image id and src");
            await object.setSrc(command.src);
            changedIds.add(String(object.id));
            break;
          }
          case "image.scale": {
            const object = requireObject(command.id);
            if (!(object instanceof FabricImage)) throw new Error("image.scale requires an image id");
            const factor = number(command.factor, Number.NaN);
            if (!Number.isFinite(factor) || factor <= 0) throw new Error("image.scale requires a positive factor");
            const anchor = String(command.anchor || "center");
            if (anchor !== "center" && anchor !== "top-left") throw new Error(`Unsupported image.scale anchor: ${anchor}`);
            const center = object.getCenterPoint();
            object.set({ scaleX: object.scaleX * factor, scaleY: object.scaleY * factor, dirty: true });
            if (anchor === "center") object.setPositionByOrigin(center, "center", "center");
            const frame = object.frameId ? objectById(object.frameId) : findContainingFrame(object);
            if (frame?.kind === "frame") applyFrameClip(object, frame);
            object.setCoords();
            changedIds.add(String(object.id));
            break;
          }
          case "mask.create": {
            const rectangle = requireObject(String(command.rectangleId || ""));
            const image = requireObject(String(command.imageId || ""));
            if (!(rectangle instanceof Rect) || rectangle.kind !== "rectangle" || !(image instanceof FabricImage)) {
              throw new Error("mask.create requires a rectangleId and imageId");
            }
            if (rectangle.frameId !== image.frameId || (rectangle.pageId || DEFAULT_PAGE_ID) !== (image.pageId || DEFAULT_PAGE_ID)) {
              throw new Error("mask.create objects must belong to the same Frame and page");
            }
            if (Math.abs(rectangle.angle || 0) > 0.01) throw new Error("mask.create does not support rotated rectangles");
            const id = String(command.id || newId("mask"));
            if (objectById(id)) throw new Error(`Duplicate object id: ${id}`);
            const maskBounds = rectangle.getBoundingRect();
            const topIndex = Math.max(canvas.getObjects().indexOf(rectangle), canvas.getObjects().indexOf(image));
            const frameId = image.frameId;
            const pageId = image.pageId || activePageIdRef.current;
            canvas.remove(rectangle, image);
            image.clipPath = undefined;
            const group = new Group([image], { subTargetCheck: true, interactive: false }) as Group & ObjectMeta;
            Object.assign(group, {
              id,
              name: String(command.name || `蒙版｜${image.name || "图片"}`),
              kind: "mask-group",
              frameId,
              pageId,
              maskLeft: maskBounds.left,
              maskTop: maskBounds.top,
              maskWidth: maskBounds.width,
              maskHeight: maskBounds.height,
              maskRadius: Math.max(0, Number(rectangle.rx || 0) * Number(rectangle.scaleX || 1)),
              maskShapeId: rectangle.id || newId("rectangle"),
              maskShapeName: rectangle.name || "矩形",
              maskFill: typeof rectangle.fill === "string" ? rectangle.fill : "#d9d9d9",
              maskStroke: typeof rectangle.stroke === "string" ? rectangle.stroke : "#1b1b1b",
              maskStrokeWidth: Number(rectangle.strokeWidth || 0),
              lastLeft: group.left,
              lastTop: group.top,
              lastScaleX: group.scaleX,
              lastScaleY: group.scaleY,
            });
            const frame = frameId ? frames().find((item) => item.id === frameId) : undefined;
            syncGroupMemberFrame(group, frame);
            applyMaskGroupClip(group, frame);
            applyObjectSelectionStyle(group);
            canvas.add(group);
            canvas.moveObjectTo(group, Math.min(topIndex, canvas.getObjects().length - 1));
            setExpandedGroupIds((current) => new Set(current).add(id));
            changedIds.add(id);
            changedIds.add(String(rectangle.id));
            changedIds.add(String(image.id));
            break;
          }
          case "layer.update": case "layer.move": case "layer.rename": {
            const object = requireObject(command.id);
            const previousLeft = object.left;
            const previousTop = object.top;
            const patch = { ...(command.patch && typeof command.patch === "object" ? command.patch as Record<string, unknown> : {}) };
            if (command.op === "layer.move") Object.assign(patch, { left: command.x ?? command.left ?? object.left, top: command.y ?? command.top ?? object.top });
            if (command.op === "layer.rename") patch.name = command.name;
            for (const key of ["id", "kind", "pageId", "frameId", "clipPath", "type"]) delete patch[key];
            if (patch.shadow && !(patch.shadow instanceof Shadow)) patch.shadow = new Shadow(patch.shadow as ConstructorParameters<typeof Shadow>[0]);
            if (object instanceof Textbox && ("stroke" in patch || "strokeWidth" in patch)) patch.paintFirst = "stroke";
            object.set(patch); object.setCoords();
            if (object instanceof Rect && object.kind === "mask-shape") {
              syncMaskFromOverlay(object);
              changedIds.add(String(object.id));
              break;
            }
            if (object.kind === "frame") {
              const dx = object.left - previousLeft;
              const dy = object.top - previousTop;
              if (dx || dy) syncFrameChildren(object, dx, dy);
              object.lastLeft = object.left;
              object.lastTop = object.top;
              syncFrameLabel(object);
              syncFrameGrid(object);
            }
            else {
              const frame = findContainingFrame(object);
              if (frame) {
                applyFrameClip(object, frame);
                if (object instanceof Group && object.kind === "group") syncGroupMemberFrame(object as Group & ObjectMeta, frame);
              } else {
                object.frameId = undefined; object.clipPath = undefined; object.set({ dirty: true });
                if (object instanceof Group && object.kind === "group") syncGroupMemberFrame(object as Group & ObjectMeta);
              }
            }
            changedIds.add(String(object.id));
            break;
          }
          case "layer.visibility": {
            const object = requireObject(command.id);
            object.hidden = command.visible === undefined ? !object.hidden : !Boolean(command.visible);
            applyActivePageVisibility(); changedIds.add(String(object.id));
            break;
          }
          case "layer.delete": {
            const object = requireObject(command.id);
            if (object.kind === "frame") canvas.getObjects().filter((item) => (item as ObjectMeta).frameId === object.id).forEach((item) => { changedIds.add(String((item as ObjectMeta).id)); canvas.remove(item); });
            changedIds.add(String(object.id)); canvas.remove(object);
            break;
          }
          case "layer.reorder": {
            const object = requireObject(command.id);
            const index = Math.max(0, Math.min(canvas.getObjects().length - 1, Math.round(number(command.index, canvas.getObjects().indexOf(object)))));
            canvas.moveObjectTo(object, index); changedIds.add(String(object.id));
            break;
          }
          case "selection.set": {
            if (Array.isArray(command.ids)) {
              const objects = command.ids.map((id) => requireObject(String(id)));
              if (!objects.length) canvas.discardActiveObject(); else if (objects.length === 1) canvas.setActiveObject(objects[0]); else canvas.setActiveObject(new ActiveSelection(objects, { canvas }));
            } else if (!command.id) canvas.discardActiveObject(); else canvas.setActiveObject(requireObject(command.id));
            canvas.uniformScaling = (canvas.getActiveObject() as ObjectMeta | undefined)?.kind !== "rectangle";
            break;
          }
          case "selection.align": {
            const alignment = String(command.alignment || "") as ObjectAlignment;
            if (!["left", "center", "right", "top", "middle", "bottom"].includes(alignment)) throw new Error(`Unsupported alignment: ${alignment}`);
            const alignedIds = alignSelectedObjects(alignment, false);
            if (!alignedIds.length) throw new Error("Alignment requires at least two layers inside the same frame");
            alignedIds.forEach((id) => changedIds.add(id));
            break;
          }
          case "frame.export": {
            const frame = requireObject(command.id || command.frameId);
            if (frame.kind !== "frame") throw new Error(`Not a frame: ${command.id || command.frameId}`);
            const previousActive = canvas.getActiveObject(); const oldVpt = [...canvas.viewportTransform];
            canvas.discardActiveObject(); canvas.setViewportTransform([1,0,0,1,0,0]);
            const oldStroke = frame.stroke; const oldShadow = frame.shadow; frame.set({ stroke: "transparent", shadow: null }); canvas.requestRenderAll();
            data.export = canvas.toDataURL({ format: command.format === "png" ? "png" : "jpeg", quality: number(command.quality, .95), multiplier: number(command.multiplier, 1), left: frame.left, top: frame.top, width: frameDesignWidth(frame), height: frameDesignHeight(frame) });
            frame.set({ stroke: oldStroke, shadow: oldShadow }); canvas.setViewportTransform(oldVpt); if (previousActive) canvas.setActiveObject(previousActive);
            break;
          }
          default: throw new Error(`Unsupported command: ${command.op}`);
        }
      }
      syncFrameSelectionOutlines();
      canvas.requestRenderAll();
      restoring.current = false;
      const sidebarOnly = commands.every((command) => command.op === "frame.sidebarCollapse");
      if (changedIds.size && !sidebarOnly) commit(); else { refresh(); await localSet(PAGES_KEY, { pages: pagesRef.current, activePageId: activePageIdRef.current }); }
      return { ok: true, changedIds: [...changedIds], warnings, snapshot: getPixelLocalSnapshot(), ...(Object.keys(data).length ? { data } : {}) };
    } catch (error) {
      await canvas.loadFromJSON(beforeJson);
      pagesRef.current = beforePages; setPages(beforePages); activePageIdRef.current = beforeActivePageId; setActivePageId(beforeActivePageId);
      updateCollapsedFrameIds(beforeCollapsedFrameIds);
      canvas.backgroundColor = "transparent"; cleanLoadedCanvas(canvas); showPage(beforeActivePageId, false); canvas.requestRenderAll(); restoring.current = false; refresh();
      return { ok: false, changedIds: [], warnings, snapshot: getPixelLocalSnapshot(), error: error instanceof Error ? error.message : String(error) };
    }
  };

  useEffect(() => {
    const api: PixelLocalApi = { version: 1, getState: async () => getPixelLocalSnapshot(), execute: executePixelLocalCommands };
    (window as PixelLocalWindow).pixelLocal = api;
    return () => { if ((window as PixelLocalWindow).pixelLocal === api) delete (window as PixelLocalWindow).pixelLocal; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const clientKey = "pixel-local-automation-client-id-v1";
    const projectKey = "pixel-local-automation-project-id-v1";
    const clientId = localStorage.getItem(clientKey) || `client_${crypto.randomUUID()}`;
    const projectId = localStorage.getItem(projectKey) || `project_${crypto.randomUUID()}`;
    localStorage.setItem(clientKey, clientId); localStorage.setItem(projectKey, projectId);
    let socket: WebSocket | null = null; let stopped = false; let retry = 500; let revision = 0; let heartbeat: ReturnType<typeof setInterval> | null = null;
    const send = (value: unknown) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket("ws://127.0.0.1:43127/editor");
      socket.addEventListener("open", () => {
        retry = 500;
        setCodexConnection("Codex 连接中");
        send({ type: "hello", clientId, projectId, title: document.title, url: location.href, ready: true, revision });
        heartbeat = setInterval(() => send({ type: "heartbeat", ready: true, revision }), 10_000);
      });
      socket.addEventListener("message", async (event) => {
        const job = JSON.parse(String(event.data)) as { type: string; primary?: boolean; requestId?: string; action?: string; payload?: Record<string, unknown> };
        if (job.type === "welcome" || job.type === "primary") {
          setCodexConnection(job.primary ? "Codex 已连接 · 主画布" : "Codex 已连接");
          return;
        }
        if (job.type !== "task" || !job.requestId) return;
        try {
          let result: unknown;
          if (job.action === "getState") result = getPixelLocalSnapshot();
          else if (job.action === "execute") {
            result = await executePixelLocalCommands(job.payload?.commands as PixelLocalCommand | PixelLocalCommand[]);
            if ((result as PixelLocalCommandResult).ok && (result as PixelLocalCommandResult).changedIds.length) revision += 1;
          } else if (job.action === "exportFrame") {
            const commandResult = await executePixelLocalCommands({ op: "frame.export", id: String(job.payload?.frameId || ""), format: job.payload?.format, multiplier: job.payload?.multiplier });
            if (!commandResult.ok) throw new Error(commandResult.error || "Frame export failed");
            result = { result: commandResult, dataUrl: (commandResult.data?.export as string | undefined) || "" };
          } else throw new Error(`Unsupported bridge action: ${job.action}`);
          send({ type: "result", requestId: job.requestId, result, revision });
        } catch (error) { send({ type: "result", requestId: job.requestId, error: error instanceof Error ? error.message : String(error), revision }); }
      });
      socket.addEventListener("error", () => setCodexConnection("Codex 连接异常"));
      socket.addEventListener("close", () => { if (heartbeat) clearInterval(heartbeat); heartbeat = null; if (!stopped) { setCodexConnection("Codex 已断开 · 正在重连"); setTimeout(connect, retry); retry = Math.min(retry * 2, 8000); } });
    };
    connect();
    return () => { stopped = true; if (heartbeat) clearInterval(heartbeat); socket?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const getSelectedFrames = () => {
    const canvas = editor.current;
    return canvas?.getActiveObjects().filter((item) => (item as ObjectMeta).kind === "frame") as ObjectMeta[] || [];
  };

  const exportFrames = () => {
    const canvas = editor.current;
    const exportTargets = getSelectedFrames();
    if (!canvas || exportTargets.length === 0) {
      setSavedState("请先选择一个或多个 Frame");
      return;
    }
    const previousActive = canvas.getActiveObject();
    const oldVpt = [...canvas.viewportTransform];
    const timestamp = Date.now();
    const canvasFormat = exportFormat === "jpg" ? "jpeg" : "png";
    canvas.discardActiveObject();
    canvas.setViewportTransform([1,0,0,1,0,0]);
    exportTargets.forEach((frame, index) => {
      const oldStroke = frame.stroke;
      const oldShadow = frame.shadow;
      frame.set({ stroke: "transparent", shadow: null });
      canvas.requestRenderAll();
      const link = document.createElement("a");
      link.download = `${frame.name || `Frame-${index + 1}`}-${timestamp}-${index + 1}.${exportFormat}`;
      link.href = canvas.toDataURL({ format: canvasFormat, quality: .95, multiplier: 1, left: frame.left, top: frame.top, width: frameDesignWidth(frame), height: frameDesignHeight(frame) });
      link.click();
      frame.set({ stroke: oldStroke, shadow: oldShadow });
    });
    canvas.setViewportTransform(oldVpt);
    if (previousActive && canvas.getObjects().includes(previousActive)) canvas.setActiveObject(previousActive);
    canvas.requestRenderAll();
    refresh();
  };

  const renderExportControls = (buttonLabel: string) => <div className="export-controls"><label className="export-format">导出格式<select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as ExportFormat)}><option value="png">PNG</option><option value="jpg">JPG</option></select></label><div className="inspector-actions"><button className="primary" onClick={exportFrames}><IconDownload size={14} />{buttonLabel}</button></div></div>;
  const renderAlignmentControls = () => {
    const controls = [
      ['left', '左对齐', IconLayoutAlignLeft], ['center', '水平居中', IconLayoutAlignCenter], ['right', '右对齐', IconLayoutAlignRight],
      ['top', '顶部对齐', IconLayoutAlignTop], ['middle', '垂直居中', IconLayoutAlignMiddle], ['bottom', '底部对齐', IconLayoutAlignBottom],
    ] as const;
    return <div className="alignment-panel"><h3>组件对齐</h3><div className="alignment-grid">{controls.map(([value,label,Icon]) => <button key={value} onClick={() => alignSelectedObjects(value)} aria-label={label} title={label}><Icon size={17} /></button>)}</div><div className="inspector-actions">{canCreateMask() && <button className="primary" onClick={createMaskFromSelection}><IconMask size={15} />创建蒙版</button>}<button className="group-action-button" onClick={groupSelectedObjects}><IconFolderPlus size={16} />编组</button></div></div>;
  };
  const renderSelectedProperties = () => selected && <div className="properties">
    <label>图层名称<input value={selected.name} onChange={(e) => updateSelected({ name: e.target.value })} /></label>
    <div className="split"><label>X 位置<input key={`${selected.id}-x-${selected.x}`} type="number" defaultValue={selected.x} onBlur={(e) => updateObjectPosition('x', e.currentTarget.value, e.currentTarget)} /></label><label>Y 位置<input key={`${selected.id}-y-${selected.y}`} type="number" defaultValue={selected.y} onBlur={(e) => updateObjectPosition('y', e.currentTarget.value, e.currentTarget)} /></label></div>
    <div className="split"><label>宽度<input aria-label="宽度" key={`${selected.id}-width-${selected.width}`} type="number" min="1" max="10000" step="1" defaultValue={selected.width} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => handleDimensionKeyDown(e, selected.width)} onBlur={(e) => updateObjectDimension('width', e.currentTarget.value, e.currentTarget)} /></label><label>高度<input aria-label="高度" key={`${selected.id}-height-${selected.height}`} type="number" min="1" max="10000" step="1" defaultValue={selected.height} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => handleDimensionKeyDown(e, selected.height)} onBlur={(e) => updateObjectDimension('height', e.currentTarget.value, e.currentTarget)} /></label></div>
    {selected.type === 'frame' && <><label>Frame 背景色<input type="color" value={selected.fill || '#ffffff'} onChange={(e) => updateSelected({ fill: e.target.value })} /></label><label>参考网格<select value={selected.gridPreset || '0'} onChange={(e) => { const frame = editor.current?.getActiveObject() as ObjectMeta | undefined; if (!frame) return; frame.gridPreset = e.target.value; syncFrameGrid(frame); refresh(); commit(); }}><option value="0">关闭</option><option value="8">8px</option><option value="10">10px</option><option value="20">20px</option><option value="40">40px</option><option value="80">80px</option><option value="100">100px</option></select></label></>}
    {selected.text !== undefined && <>
      <label>文案<textarea value={selected.text} onChange={(e) => updateSelected({ text: e.target.value })} /></label>
      <label className="font-field"><span className="field-title"><span>字体</span><button type="button" onClick={loadLocalFonts}><IconRefresh size={12} />{fontLoadLabel}</button></span><select value={selected.fontFamily || FALLBACK_FONTS[0]} onChange={(e) => void updateSelectedFontFamily(e.target.value)}>{activeFontOptions.map((font) => <option value={font} key={font}>{font}</option>)}</select></label>
      <label>字重 / 样式<select value={selectedFontVariantKey} onChange={(e) => void updateSelectedFontVariant(e.target.value)}>{selectedFontVariants.map((variant) => <option value={variant.key} key={variant.key}>{variant.label}</option>)}</select></label>
      <div className="split"><label>字号<input type="number" min="1" max="500" value={selected.fontSize || 36} onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })} /></label><label>颜色<input type="color" value={selected.fill || '#1b1b1b'} onChange={(e) => updateSelected({ fill: e.target.value })} /></label></div>
      <div className="split"><label>字间距<input type="number" value={selected.charSpacing || 0} onChange={(e) => updateSelected({ charSpacing: Number(e.target.value) })} /></label><label>行间距<input type="number" min="0.5" max="4" step="0.05" value={selected.lineHeight || 1.16} onChange={(e) => updateSelected({ lineHeight: Number(e.target.value) })} /></label></div>
      <label>文字对齐<div className="text-align-controls" role="group" aria-label="文字对齐">{([['left','左对齐',IconAlignLeft],['center','居中',IconAlignCenter],['right','右对齐',IconAlignRight]] as const).map(([value,label,Icon]) => <button type="button" key={value} className={(selected.textAlign || 'left') === value ? 'active' : ''} aria-pressed={(selected.textAlign || 'left') === value} aria-label={label} title={label} onClick={() => updateSelected({ textAlign:value })}><Icon size={18} /></button>)}</div></label>
      <div className="effect-block"><div className="effect-title"><span>外描边</span><input type="checkbox" checked={Boolean(selected.strokeWidth)} onChange={(e) => updateSelected({ stroke: e.target.checked ? (selected.stroke || '#ffffff') : null, strokeWidth: e.target.checked ? Math.max(2, selected.strokeWidth || 2) : 0 })} /></div>{Boolean(selected.strokeWidth) && <div className="split"><label>颜色<input type="color" value={selected.stroke || '#ffffff'} onChange={(e) => updateSelected({ stroke: e.target.value })} /></label><label>粗细<input type="number" min="0" max="50" value={selected.strokeWidth || 0} onChange={(e) => updateSelected({ strokeWidth: Number(e.target.value) })} /></label></div>}</div>
      <div className="effect-block"><div className="effect-title"><span>投影</span><input type="checkbox" checked={Boolean(selected.shadowColor)} onChange={(e) => updateTextShadow(e.target.checked ? {} : null)} /></div>{selected.shadowColor && <><label>颜色<input type="color" value={selected.shadowColor.slice(0,7)} onChange={(e) => updateTextShadow({ color: e.target.value })} /></label><div className="split"><label>模糊<input type="number" min="0" max="100" value={selected.shadowBlur || 0} onChange={(e) => updateTextShadow({ blur: Number(e.target.value) })} /></label><label>X 偏移<input type="number" value={selected.shadowOffsetX || 0} onChange={(e) => updateTextShadow({ offsetX: Number(e.target.value) })} /></label></div><label>Y 偏移<input type="number" value={selected.shadowOffsetY || 0} onChange={(e) => updateTextShadow({ offsetY: Number(e.target.value) })} /></label></>}</div>
    </>}
    {selected.type === 'rectangle' && <><div className="split"><label>填充<input type="color" value={selected.fill || '#d9d9d9'} onChange={(e) => updateSelected({ fill: e.target.value })} /></label><label>描边<input type="color" value={selected.stroke || '#1b1b1b'} onChange={(e) => updateSelected({ stroke: e.target.value })} /></label></div><div className="split"><label>描边粗细<input type="number" min="0" max="100" value={selected.strokeWidth || 0} onChange={(e) => updateSelected({ strokeWidth: Number(e.target.value) })} /></label><label>圆角<input type="number" min="0" max={Math.floor(Math.min(selected.width, selected.height) / 2)} step="1" value={Math.round(selected.cornerRadius || 0)} onChange={(e) => updateRectangleRadius(e.target.value)} /></label></div></>}
    {['mask-edit-overlay','mask-shape'].includes(selected.type) && <><div className="mask-edit-note">正在编辑蒙版形状；可在画布拖动、缩放或拖动圆角控制点。</div><label>圆角<input type="number" min="0" max={Math.floor(Math.min(selected.width, selected.height) / 2)} step="1" value={Math.round(selected.cornerRadius || 0)} onChange={(e) => updateRectangleRadius(e.target.value)} /></label></>}
    {!['mask-edit-overlay','mask-shape'].includes(selected.type) && <label>透明度<input type="range" min="0.05" max="1" step="0.05" value={selected.opacity} onChange={(e) => updateSelected({ opacity: Number(e.target.value) })} /></label>}
    {selected.type === 'group' && <div className="inspector-actions"><button onClick={ungroupSelectedObject}>取消编组</button></div>}
    {selected.type === 'mask-group' && <div className="inspector-actions"><button onClick={releaseSelectedMask}>释放蒙版</button></div>}
    {selected.type === 'frame' && renderExportControls('导出 Frame')}
  </div>;

  const layerTypeIcon = (object: ObjectMeta, size = 14) => object instanceof Textbox
    ? <IconTypography size={size} />
    : object instanceof Rect && object.kind === "rectangle"
      ? <IconSquare size={size} />
      : <IconPhoto size={size} />;
  const renderLayerTreeRow = (layer: FabricObject, index: number) => {
    const meta = layer as ObjectMeta;
    if (meta.kind === "mask-shape") return null;
    const isSelected = selectedLayerIds.has(String(meta.id));
    if (layer instanceof Group && (meta.kind === "group" || meta.kind === "mask-group")) {
      const groupId = String(meta.id);
      const expanded = expandedGroupIds.has(groupId);
      const children = layer.getObjects() as ObjectMeta[];
      return <div key={meta.id || `${meta.name}${index}`} className={`layer-row group-row ${meta.hidden ? "is-hidden" : ""} ${isSelected ? "active" : ""}`}>
        <button className="group-toggle" onClick={(e) => { e.stopPropagation(); setExpandedGroupIds((current) => { const next = new Set(current); if (next.has(groupId)) next.delete(groupId); else next.add(groupId); return next; }); }} aria-label={`${expanded ? "折叠" : "展开"}${meta.name || "编组"}`} title={expanded ? "折叠编组" : "展开编组"}>{expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</button>
        <button className="layer-main" onClick={(e) => selectLayerFromSidebar(meta, e.shiftKey)} onDoubleClick={() => startRenameLayer(meta)} title="双击重命名；Shift 点击多选">{meta.kind === "mask-group" ? <IconMask size={15} className="group-folder-icon" /> : expanded ? <IconFolderOpen size={15} className="group-folder-icon" /> : <IconFolder size={15} className="group-folder-icon" />}<span className="layer-name">{meta.name || (meta.kind === "mask-group" ? "蒙版组" : "编组")}</span></button>
        <button className="visibility-toggle layer-visibility" onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(meta); }} aria-label={`${meta.hidden ? "显示" : "隐藏"}${meta.name || "编组"}`} title={meta.hidden ? "显示编组" : "隐藏编组"}>{meta.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}</button>
        <button className="delete-layer" onClick={(e) => { e.stopPropagation(); removeLayerObject(meta); }} aria-label={`删除${meta.name || "编组"}`} title="删除"><IconTrash size={13} /></button>
        {expanded && <div className="group-children">{meta.kind === "mask-group" && <div className={`group-child-row ${editingMaskGroupId === String(meta.id) ? "active" : ""}`}><button className="group-child" onClick={() => editMaskShape(meta as Group & ObjectMeta)} title={`编辑${meta.maskShapeName || "蒙版矩形"}`}><IconSquare size={13} /><span>{meta.maskShapeName || "蒙版矩形"}</span></button></div>}{children.map((child, childIndex) => <div className={`group-child-row ${(child as ObjectMeta).hidden ? "is-hidden" : ""}`} key={(child as ObjectMeta).id || childIndex}>
          <button className="group-child" onClick={() => { editor.current?.setActiveObject(meta); editor.current?.requestRenderAll(); refresh(); }} title="编组内图层">{layerTypeIcon(child as ObjectMeta, 13)}<span>{(child as ObjectMeta).name || child.type}</span></button>
          <button className="group-child-visibility" onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(child as ObjectMeta); }} aria-label={`${(child as ObjectMeta).hidden ? "显示" : "隐藏"}${(child as ObjectMeta).name || child.type}`}>{(child as ObjectMeta).hidden ? <IconEyeOff size={12} /> : <IconEye size={12} />}</button>
          <button className="group-child-delete" onClick={(e) => { e.stopPropagation(); removeLayerObject(child as ObjectMeta); }} aria-label={`删除${(child as ObjectMeta).name || child.type}`}><IconTrash size={12} /></button>
        </div>)}</div>}
      </div>;
    }
    return <div draggable={editingLayerId !== meta.id} key={meta.id || `${meta.name}${index}`} className={`layer-row ${meta.hidden ? "is-hidden" : ""} ${isSelected ? "active" : ""} ${draggingLayerId === meta.id ? "dragging" : ""} ${dropLayerId === meta.id ? "drop-target" : ""}`} onDragStart={(e) => { if (!meta.id) return; setDraggingLayerId(meta.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", meta.id); }} onDragOver={(e) => { if (!draggingLayerId || draggingLayerId === meta.id) return; const dragged = layers.find((item) => (item as ObjectMeta).id === draggingLayerId) as ObjectMeta | undefined; if (dragged?.frameId === meta.frameId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropLayerId(meta.id || null); } }} onDrop={(e) => { e.preventDefault(); if (meta.id) reorderLayer(meta.id, meta.frameId); }} onDragEnd={() => { setDraggingLayerId(null); setDropLayerId(null); }}>
      {editingLayerId === meta.id ? <input autoFocus className="layer-rename" value={layerNameDraft} onChange={(e) => setLayerNameDraft(e.target.value)} onBlur={() => finishRenameLayer(meta)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingLayerId(null); }} /> : <><button className="layer-main" onClick={(e) => selectLayerFromSidebar(meta, e.shiftKey)} onDoubleClick={() => startRenameLayer(meta)} title="双击重命名；Shift 点击多选"><span className="drag-handle" title="拖动调整层级">⠿</span>{layerTypeIcon(meta)}<span className="layer-name">{meta.name || layer.type}</span></button><button className="visibility-toggle layer-visibility" onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(meta); }} aria-label={`${meta.hidden ? "显示" : "隐藏"}${meta.name || layer.type}`} title={meta.hidden ? "显示图层" : "隐藏图层"}>{meta.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}</button><button className="delete-layer" onClick={(e) => { e.stopPropagation(); removeLayerObject(meta); }} aria-label={`删除${meta.name || layer.type}`} title="删除"><IconTrash size={13} /></button></>}
    </div>;
  };

  return <main className="app-shell">
    <section className="workspace">
      <aside className="left-panel panel">
        <section className="sidebar-block pages-block">
          <div className="sidebar-heading"><h2>Pages</h2><button onClick={addPage} aria-label="新建页面" title="新建页面"><IconPlus size={16} /></button></div>
          <div className="page-list">{pages.map((page) => editingPageId === page.id ? <input key={page.id} autoFocus className="page-rename" value={pageNameDraft} onChange={(e) => setPageNameDraft(e.target.value)} onBlur={() => finishRenamePage(page.id)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingPageId(null); }} /> : <div className={`page-item ${page.hidden ? "is-hidden" : ""}`} key={page.id}><button className={activePageId === page.id ? "active" : ""} onClick={() => showPage(page.id)} onDoubleClick={() => startRenamePage(page)} title="双击重命名"><IconFile size={14} /><span>{page.name}</span></button><button className="visibility-toggle page-visibility" onClick={(e) => { e.stopPropagation(); togglePageVisibility(page.id); }} aria-label={`${page.hidden ? "显示" : "隐藏"}${page.name}`} title={page.hidden ? "显示页面" : "隐藏页面"}>{page.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}</button>{pages.length > 1 && <button className="delete-page" onClick={() => deletePage(page.id)} aria-label={`删除${page.name}`} title="删除页面"><IconTrash size={13} /></button>}</div>)}</div>
        </section>
        <section className="sidebar-block layers-block">
          <div className="sidebar-heading"><h2>Layers</h2><span>{layers.length}</span></div>
          <div className="layer-tree">{layers.some((layer) => { const meta = layer as ObjectMeta; return meta.kind !== "frame" && !meta.frameId; }) && <div className="outside-layers"><div className="outside-layers-title">画布外</div>{layers.filter((layer) => { const meta = layer as ObjectMeta; return meta.kind !== "frame" && !meta.frameId; }).map(renderLayerTreeRow)}</div>}{frames().length === 0 && <p className="empty layer-empty">当前页面还没有 Frame。</p>}{frames().map((frame) => { const frameSelected = selectedAncestorFrameIds.has(String(frame.id)); return <div className="frame-node" key={frame.id}><div className={`layer-row frame-row ${frame.hidden ? "is-hidden" : ""} ${frameSelected ? "active" : ""}`}><button className="frame-toggle" onClick={(e) => { e.stopPropagation(); const id = String(frame.id); const next = new Set(collapsedFrameIdsRef.current); if (next.has(id)) next.delete(id); else next.add(id); updateCollapsedFrameIds(next); }} aria-label={`${collapsedFrameIds.has(String(frame.id)) ? "展开" : "折叠"}${frame.name || "Frame"}`} title={collapsedFrameIds.has(String(frame.id)) ? "展开 Frame" : "折叠 Frame"}>{collapsedFrameIds.has(String(frame.id)) ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}</button>{editingLayerId === frame.id ? <input autoFocus className="layer-rename" value={layerNameDraft} onChange={(e) => setLayerNameDraft(e.target.value)} onBlur={() => finishRenameLayer(frame)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingLayerId(null); }} /> : <><button className="layer-main" onClick={(e) => selectLayerFromSidebar(frame, e.shiftKey)} onDoubleClick={() => startRenameLayer(frame)} title="双击重命名；Shift 点击多选"><IconFrame size={15} className="frame-icon" /><span className="layer-name">{frame.name}</span></button><button className="visibility-toggle layer-visibility" onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(frame); }} aria-label={`${frame.hidden ? "显示" : "隐藏"}${frame.name || "Frame"}`} title={frame.hidden ? "显示图层" : "隐藏图层"}>{frame.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}</button><button className="delete-layer" onClick={(e) => { e.stopPropagation(); removeLayerObject(frame); }} aria-label={`删除${frame.name || "Frame"}`} title="删除"><IconTrash size={13} /></button></>}</div>{!collapsedFrameIds.has(String(frame.id)) && <div className="frame-children">{layers.filter((layer) => (layer as ObjectMeta).frameId === frame.id).map(renderLayerTreeRow)}</div>}</div>; })}</div>
        </section>
      </aside>
      <section className="canvas-area" ref={canvasHost}>
        <canvas ref={htmlCanvas} />
        <div className={`codex-status ${codexConnection.startsWith("Codex 已连接") ? "connected" : ""}`}><span />{codexConnection}</div>
        <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadImage(e, "image")} /><input ref={projectInput} hidden type="file" accept=".pixel.json,application/json" onChange={openProjectFile} />
        <div className="editor-toolbar" role="toolbar" aria-label="编辑工具">
          <button onClick={() => projectInput.current?.click()} title="打开 .pixel.json 项目" aria-label="打开项目文件"><IconFolderOpen size={20} /></button>
          <button onClick={saveProjectFile} title="保存为 .pixel.json 项目" aria-label="保存项目文件"><IconDeviceFloppy size={20} /></button>
          <span className="toolbar-divider" />
          <button onClick={() => addFrame()} title="新建 Frame" aria-label="新建 Frame"><IconFrame size={20} /></button>
          <div className="ratio-picker" onMouseEnter={openFramePresetMenu} onMouseLeave={scheduleFramePresetClose}><button type="button" className={framePresetOpen ? "active" : ""} aria-label="Frame 比例" aria-haspopup="menu" aria-expanded={framePresetOpen} onFocus={openFramePresetMenu} onClick={() => setFramePresetOpen((open) => !open)}><span>比例</span><IconChevronDown size={14} /></button>{framePresetOpen && <div className="ratio-menu" role="menu" aria-label="选择 Frame 比例">{FRAME_PRESETS.map((preset) => <button type="button" role="menuitem" key={preset.ratio} onClick={() => { addFrame(preset.width, preset.height, preset.label); setFramePresetOpen(false); }}>{preset.ratio}</button>)}</div>}</div>
          <span className="toolbar-divider" />
          <button onClick={() => imageInput.current?.click()} title="添加图片" aria-label="添加图片"><IconPhoto size={20} /></button>
          <button className={textToolActive ? "active" : ""} onClick={addText} title={textToolActive ? "取消文字画框（Esc）" : "拖动画出文本框"} aria-label="文字画框工具"><IconTypography size={20} /></button>
          <button className={rectangleToolActive ? "active" : ""} onClick={addRectangle} title={rectangleToolActive ? "取消矩形绘制（Esc）" : "拖动画出矩形"} aria-label="矩形绘制工具"><IconSquare size={20} /></button>
          <span className="toolbar-divider" />
          <button onClick={createMaskFromSelection} disabled={!canCreateMask()} title={canCreateMask() ? "使用选中的矩形与图片创建蒙版" : "选择同一 Frame 内的一张图片和一个矩形"} aria-label="创建蒙版"><IconMask size={20} /></button>
          <button onClick={groupSelectedObjects} disabled={selectedLayerCount < 2} title={selectedLayerCount < 2 ? "选择同一 Frame 内至少两个图层" : "编组选中图层"} aria-label="编组选中图层"><IconFolderPlus size={20} /></button>
        </div>
      </section>
      <aside className="right-panel panel">
        <div className="inspector-heading"><h2>Design</h2><span>{selectedFrameCount > 1 ? `${selectedFrameCount} Frames` : selected?.type === "frame" ? "Frame" : selected ? "Layer" : ""}</span></div>
        {selectedFrameCount > 1 ? <div className="multi-selection"><div className="multi-count">已选择 {selectedFrameCount} 个 Frame</div>{renderExportControls(`导出 ${selectedFrameCount} 张`)}</div> : selectedLayerCount > 1 ? <div className="multi-selection"><div className="multi-count">已选择 {selectedLayerCount} 个图层</div>{renderAlignmentControls()}</div> : selected ? renderSelectedProperties() : <p className="empty big">选择 Frame 或图层，即可编辑属性。</p>}
      </aside>
    </section>
  </main>;
}
