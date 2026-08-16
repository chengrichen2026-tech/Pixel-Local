# Pixel Local

Pixel Local 是一个本地优先的轻量营销图片编辑器。它在浏览器中运行，支持页面、Frame、图片、文字、矩形、图层、编组、对齐、裁切、撤销与 Frame 导出。

普通用户无需 Codex 即可使用编辑器。Codex、MCP 和常驻 Bridge 都是可选的自动化能力。

## 系统要求

- Node.js 22.13 或更高版本
- npm
- 现代桌面浏览器

## 下载和启动

```bash
git clone https://github.com/chengrichen2026-tech/Pixel-Local.git
cd Pixel-Local
npm ci
npm run dev
```

开发服务显示本地地址后，在浏览器打开 `http://localhost:3000`。

生产构建与本地预览：

```bash
npm run build
npm run start
```

## 不使用 Codex 的基本操作

1. 在 Pages 区域新建或切换页面。
2. 新建 Frame，或选择常用尺寸预设。
3. 添加图片、文字和矩形，在右侧面板调整属性。
4. 在 Layers 中重命名、排序、显隐、编组或折叠 Frame 内容。
5. 选择 Frame 后导出 PNG 或 JPG。

项目和模板默认保存在浏览器 IndexedDB 中，不会自动上传。浏览器来源不同会使用不同的本地存储；建议定期使用 `.pixel.json` 保存功能备份重要项目。

不含品牌或商业素材的入门练习见 [中性演示流程](docs/neutral-demo.md)。

## 测试

```bash
npm test
```

该命令会完成生产构建，并运行编辑器源码契约、侧栏命令和 Bridge 回归测试。

## 可选：Codex 与 MCP 自动化

Pixel Local 提供结构化 Command API 和本机 MCP Server。Codex 自动化通过 MCP 读取与修改画布，不依赖浏览器鼠标操作。

### 1. 启动 Bridge

跨平台前台运行：

```bash
npm run bridge:start
```

macOS 可选择安装为当前用户的 LaunchAgent：

```bash
npm run bridge:install
```

Bridge 仅监听 `127.0.0.1:43127`，不要暴露到公网。

### 2. 注册 MCP

将 [MCP 配置示例](ops/pixel-local/config/codex-mcp.toml.example) 中的 `PROJECT_DIR` 替换为本机仓库绝对路径，再加入 Codex 配置。MCP Server 源码位于 `tools/pixel-local-mcp/server.mjs`。

### 3. 安装 Skill

本仓库在 `ops/pixel-local/skill/` 维护 Skill 源。当前用户可显式同步到 Codex：

```bash
npm run pixel:skill:sync
```

同步后新建 Codex 任务，确认 `pixel-local-editor` MCP 工具已加载。完整命令说明见 [Command API](COMMAND_API.md)。

## 数据与发布边界

- 浏览器画布、`.pixel.json`、运行日志、QA 截图和恢复备份不属于源码发布包。
- `public/imports/` 与 `public/template-assets/` 用于本机受控素材，默认不进入 Git。
- 仓库不包含品牌、客户或个人生成素材；请只导入你有权使用的内容。
- `.env*`、私钥、依赖目录和构建产物均已忽略。

## 许可证

Pixel Local 使用 [MIT License](LICENSE)。
