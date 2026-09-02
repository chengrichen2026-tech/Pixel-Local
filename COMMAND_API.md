# Pixel Local Command API v1

Pixel Local 在页面加载完成后暴露 `window.pixelLocal`，供 Codex 或浏览器自动化稳定读取和修改编辑器状态。

Codex 已注册 `$pixel-local-editor` Skill 与独立版 `pixel-local-editor` MCP。默认目标是 Pixel Local Chrome 插件画布；localhost 仅用于显式开发模式。页面通过 WebSocket 自动连接 `127.0.0.1:43127` 常驻 Bridge，可使用 `open_editor`、`editor_status`、`select_editor`、`get_state`、`execute`、`get_task` 和 `export_frame`，无需通过鼠标操作画布。

`open_editor` 默认按“调用参数 `extensionId` → 环境变量 `PIXEL_LOCAL_EXTENSION_ID` → Bridge 当前已连接插件 URL”寻找插件。显式传 `target: "localhost"` 才打开 `PIXEL_LOCAL_EDITOR_URL`。

`get_state` 返回稳定的 `projectId` 和当前 `revision`。所有写操作必须携带：

- 唯一 `requestId`：同一个 ID 重复提交不会重复执行。
- `expectedRevision`：必须等于最近读取到的 revision，否则拒绝覆盖用户的新修改。
- 可选 `clientId` 或 `projectId`：需要精确定向时使用；没有显式目标时只操作用户选定的主画布。

用户点击“设为主画布”后，编辑器会在本地持久保存该标签页身份。刷新、桥重启或登录恢复后，该标签页会自动重新认领主画布，其他新标签页不会抢占。

任务超时后先调用 `get_task(requestId)` 查询状态，再决定是否使用新的 requestId 重试。

## 基本调用

```js
const state = await window.pixelLocal.getState();

const result = await window.pixelLocal.execute([
  { op: "page.create", id: "campaign", name: "活动页" },
  { op: "frame.create", id: "hero", pageId: "campaign", width: 1080, height: 1920, x: 0, y: 0 },
  { op: "text.create", id: "headline", pageId: "campaign", frameId: "hero", text: "新品上市", x: 60, y: 180, width: 760, fontSize: 120, fill: "#ffffff" },
]);
```

返回结构：

```js
{
  ok: true,
  changedIds: ["campaign", "hero", "headline"],
  warnings: [],
  snapshot: { version: 1, activePageId: "campaign", pages: [], objects: [] }
}
```

## 支持的命令

- 项目：`project.getState`、`project.save`
- 页面：`page.create`、`page.rename`、`page.activate`、`page.visibility`、`page.delete`
- Frame：`frame.create`、`frame.sidebarCollapse`、`frame.export`
- 矩形：`rectangle.create`（支持 `fill`、`stroke`、`strokeWidth`、`cornerRadius`）
- 文字：`text.create`
- 图片：`image.create`、`image.replace`、`image.scale`
- 图层：`layer.update`、`layer.move`、`layer.rename`、`layer.visibility`、`layer.delete`、`layer.reorder`
- 选择：`selection.set`（单个 `id` 或多个 `ids`）、`selection.align`（`left`、`center`、`right`、`top`、`middle`、`bottom`；只允许同一 Frame 内的多个图层）
- 历史：`history.undo`、`history.redo`

`execute()` 接受单条命令或命令数组。批量命令只保存一次；任意命令失败时，整批操作回滚。历史命令必须单独执行。

`frame.export` 的图片 Data URL 返回在 `result.data.export`，默认按 Frame 设计尺寸导出 JPG；可显式传入 `format: "png"` 或 `multiplier` 覆盖。

`frame.create` 可传入 `gridPreset: "0" | "4" | "8" | "12"`，分别表示关闭、4 列、8 列或 12 列网格。网格是编辑辅助层，不进入 Frame 导出图片。

## Frame 侧栏折叠

`frame.sidebarCollapse` 只收起或展开 Layers 侧栏中的 Frame 子图层列表，不隐藏或修改 Frame 和内部对象，也不影响导出。

```js
// 折叠单个 Frame
{ op: "frame.sidebarCollapse", id: "hero", collapsed: true }

// 展开全部 Frame
{ op: "frame.sidebarCollapse", scope: "all", collapsed: false }
```

使用 `scope: "all"` 时默认作用于所有页面的全部 Frame；可附加 `pageId` 只处理指定页面。`get_state` 会在 `sidebar.collapsedFrameIds` 返回全部折叠 ID，并在每个 Frame 对象上返回 `sidebarCollapsed`。该状态是本机界面偏好，不进入画布项目数据或导出。

## 图层更新示例

```js
await window.pixelLocal.execute({
  op: "layer.update",
  id: "headline",
  patch: {
    text: "今日上新",
    fontSize: 132,
    fill: "#fff7e8",
    shadow: { color: "#00000066", blur: 8, offsetX: 4, offsetY: 6 }
  }
});
```

图片命令的 `src` 支持 Data URL 或同源 URL；需要跨电脑写入 `.pixel.json` 时，优先使用 Data URL。

## 图片等比缩放

```js
await window.pixelLocal.execute({
  op: "image.scale",
  id: "product_image",
  factor: 1.25,
  anchor: "center"
});
```

- `factor > 1`：放大。
- `0 < factor < 1`：缩小。
- `anchor: "center"`（默认）：保持图片中心不动。
- `anchor: "top-left"`：保持图片左上角不动。

缩放始终保持图片宽高比，并继续使用所属 Frame 的裁切。
