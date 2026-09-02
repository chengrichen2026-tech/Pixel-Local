# Pixel Local Chrome 扩展架构

## 目标

Pixel Local 同时提供两种运行入口，并共用同一份编辑器核心：

- localhost：用于开发、调试和原有安装流程。
- Chrome Manifest V3 扩展：用于普通用户离线编辑和更轻的安装体验。

## 运行边界

```text
Pixel Local 扩展页面
├── React + Fabric.js 编辑器
├── extension-origin IndexedDB
├── 图片导入与浏览器下载
└── 可选 WebSocket → 127.0.0.1:43127
                         ↓
                    Pixel Local Bridge
                         ↓
                    Codex MCP Server
```

扩展不依赖 localhost HTTP 服务。Bridge、MCP 与 Skill 只在需要 Codex 自动化时安装；它们不是普通编辑功能的前置条件。

## 源码与产物

- `app/page.tsx`：localhost 与扩展共同使用的 Editor Core。
- `extension/main.tsx`：扩展 React 入口。
- `extension/public/manifest.json`：MV3 清单源文件。
- `extension/public/background.js`：点击扩展图标时打开或聚焦编辑器。
- `vite.extension.config.ts`：扩展专用构建配置。
- `扩展程序/`：可加载产物，不作为手工开发入口，也不进入 Git。

## 数据迁移

localhost 与扩展拥有不同浏览器 origin，因此 IndexedDB 不共享。迁移必须使用 `.pixel.json`：

1. 在 localhost 版导出项目。
2. 在扩展版导入项目。
3. 回读页面、Frame、图层和关键图片数量。
4. 完成前保留旧数据，不做自动删除。

扩展加载目录应保持稳定。未来正式发布时需要固定 Chrome Web Store ID 或 Manifest key，避免用户数据因扩展 ID 改变而进入新的存储来源。

## Codex 自动化

扩展页面继续使用原有 WebSocket hello、revision、requestId 和 expectedRevision 协议。MCP `open_editor` 以插件为默认目标：

- 默认：使用 `PIXEL_LOCAL_EXTENSION_ID`，或复用 Bridge 已连接的插件 URL。
- 显式传入 `extensionId`：打开 `chrome-extension://<id>/index.html`。
- 显式传入 `target=localhost`：打开 `PIXEL_LOCAL_EDITOR_URL`。

无 Bridge 时，扩展仍可正常手动编辑；界面只显示 Codex 未连接状态。

## 验收

```bash
npm test
npm run doctor:extension
```

真实扩展验收还要覆盖：加载无 Manifest 错误、点击图标打开编辑器、创建临时 Frame、刷新后 IndexedDB 恢复、导出图片、可选 Bridge 连接与 MCP 写后回读。
