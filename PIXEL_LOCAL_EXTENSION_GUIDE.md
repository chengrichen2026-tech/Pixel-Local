# Pixel Local Chrome 插件使用说明

Pixel Local 是本地优先的营销图片编辑器。Chrome 插件可独立使用，不需要启动 localhost，也不要求安装 Codex、Bridge 或 MCP。

## 1. 使用前准备

- Chrome 或兼容 Chromium 的桌面浏览器。
- Git。
- Node.js 22.13 或更高版本，附带 npm。
- 从 GitHub 获取源码：[chengrichen2026-tech/Pixel-Local](https://github.com/chengrichen2026-tech/Pixel-Local)。

当前 GitHub 仓库发布的是源码。`扩展程序/` 是本机构建产物，不进入 Git，因此不能跳过构建直接加载仓库根目录。

## 2. 首次安装

### macOS / Linux

```bash
git clone https://github.com/chengrichen2026-tech/Pixel-Local.git
cd Pixel-Local
git switch codex/update-local-editor
npm ci
npm run build:extension
npm run doctor:extension
```

### Windows 10 / 11（PowerShell）

```powershell
git clone https://github.com/chengrichen2026-tech/Pixel-Local.git
Set-Location Pixel-Local
git switch codex/update-local-editor
npm ci
npm run build:extension
npm run doctor:extension
```

构建成功后，项目根目录会生成 `扩展程序/`。

## 3. 加载到 Chrome

1. 在地址栏打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `扩展程序/` 文件夹，不要选择仓库根目录或 `extension/` 源码目录。
5. 将 Pixel Local 固定到浏览器工具栏。图标是蓝底白色大字 `PL`。
6. 点击 `PL` 图标；浏览器会打开或聚焦 Pixel Local 全屏编辑器。

普通编辑、项目保存、图片导入、模板使用和 PNG/JPG 下载均可离线完成。项目数据默认保存在该扩展来源的浏览器 IndexedDB 中，不会自动上传到 GitHub 或其他服务器。

## 4. 基本使用

1. 在左侧 Pages 区域新建或切换页面。
2. 新建 Frame，或选择常用尺寸预设。
3. 导入图片，添加文字、矩形和其他设计元素。
4. 在 Layers 中调整顺序、显隐、名称和编组。
5. 选中 Frame 后导出 PNG 或 JPG。

建议在重要编辑后导出 `.pixel.json` 项目备份。图片文件和导出的成品也应保留独立副本。

## 5. 更新插件

更新前先从 Pixel Local 导出 `.pixel.json` 备份，然后在原项目目录运行：

```bash
git switch codex/update-local-editor
git pull --ff-only origin codex/update-local-editor
npm ci
npm run build:extension
npm run doctor:extension
```

再打开 `chrome://extensions`，找到 Pixel Local，点击“重新加载”。

只要继续使用同一个项目目录中的 `扩展程序/`，Chrome 通常会保留原扩展 ID 和 IndexedDB 数据。不要删除后重新加载另一个复制目录，也不要频繁更换加载路径；路径变化可能产生新的扩展 ID，使旧项目暂时不可见。

如果 `git pull --ff-only` 提示本地有修改或分支无法快进，请先保留自己的改动，不要运行会丢失文件的重置命令。

## 6. 从 localhost 版迁移

localhost 与 Chrome 插件属于不同浏览器来源，IndexedDB 不共享：

1. 在 localhost 版导出 `.pixel.json`。
2. 打开 Chrome 插件版并导入该文件。
3. 检查页面、Frame、图层和关键图片数量。
4. 确认迁移完整前，不要删除旧版数据或备份。

## 7. 可选：连接 Codex

只使用插件时可跳过本节。需要 Codex 读取和编辑真实画布时，在项目目录运行：

```bash
npm run setup:codex
npm run setup:codex -- --apply
npm run doctor
```

第一条命令是 dry-run；带 `--apply` 后才会安装和配置本机 Bridge、MCP 与 Skill。插件画布是 Codex 的默认目标，不会自动启动 localhost 开发服务器。

建议在 `chrome://extensions` 的 Pixel Local 详情中复制 32 位扩展 ID，再执行：

```bash
npm run setup:codex -- --apply --extension-id <你的扩展ID>
```

配置 ID 后，即使插件页面尚未打开，Codex 的 `open_editor` 也能直接打开它。未配置 ID 时，先手动点击一次工具栏 `PL` 图标；之后 `open_editor` 会复用 Bridge 已连接的插件地址。只有开发网页版本时才使用 `open_editor target=localhost` 或安装参数 `--with-localhost`。

重新打开 Codex 或创建新任务后，应通过 `editor_status` 和 `get_state` 回读真实插件画布，不能只用安装成功或 Bridge 启动作为完成依据。

## 8. 常见问题

### Chrome 提示 Manifest 文件缺失

确认选择的是运行 `npm run build:extension` 后生成的 `扩展程序/`，并检查其中存在 `manifest.json` 和 `index.html`。

### 点击图标没有打开编辑器

在 `chrome://extensions` 中确认 Pixel Local 已启用，点击“重新加载”，再运行：

```bash
npm run doctor:extension
```

### 更新后看不到原项目

先确认加载路径和扩展 ID 是否发生变化。不要卸载旧扩展或删除旧目录；重新加载原来的 `扩展程序/`，然后用之前导出的 `.pixel.json` 做恢复验证。

### 手动编辑时显示 Codex 未连接

这是正常状态。Bridge 和 Codex 自动化是可选能力，不影响普通编辑和导出。

## 9. 卸载

卸载前先导出 `.pixel.json` 备份。在 `chrome://extensions` 中移除 Pixel Local 后，该扩展来源下的浏览器本地数据可能无法继续访问。

如果安装过 Codex 集成，再根据 [README 的修复与卸载章节](README.md#修复与卸载) 停止 Bridge 并移除 MCP/Skill 配置。删除本地源码目录不会自动删除 GitHub 仓库，但会失去当前构建路径；确认备份可用后再处理。

## 10. 安全与隐私

- 编辑器项目默认只保存在本地浏览器 IndexedDB。
- 插件不需要远程账号才能完成普通编辑。
- `.pixel.json`、客户素材、运行日志、QA 截图和导出成品不应提交到公开仓库。
- 只导入和使用你有权处理的图片、字体和品牌素材。
