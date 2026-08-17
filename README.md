# Pixel Local

Pixel Local 是一个本地优先的轻量营销图片编辑器。它在浏览器中运行，支持页面、Frame、图片、文字、矩形、图层、编组、对齐、裁切、撤销与 Frame 导出。

普通用户无需 Codex 即可使用。安装配套 Skill 后，Codex 可通过本机 MCP 与 Bridge 读取和修改真实画布，不依赖浏览器鼠标自动化。

## 一键执行核心安装

需要 Node.js 22.13 或更高版本、npm 和现代桌面浏览器。

```bash
git clone https://github.com/chengrichen2026-tech/Pixel-Local.git
cd Pixel-Local
npm run setup:codex
npm run setup:codex -- --apply
```

第一条安装命令是 dry-run，只显示即将执行的操作；只有带 `--apply` 的命令才会安装依赖、同步 Skill、备份并更新 Codex MCP 配置，以及启动本地能力。

安装完成后关闭并重新打开 Codex，或新建一个 Codex 任务，再运行：

```bash
npm run doctor
```

最后在新任务中让 Codex 调用 `editor_status` 和 `get_state`。只有真实画布成功回读，才算完整启用。

### macOS

`--apply` 会安装并启动当前用户的 Bridge LaunchAgent，同时尝试启动编辑器服务。服务日志放在本地 `.runtime/`，不会进入 Git。

### Windows / Linux

安装器会配置 Skill 与 MCP、启动编辑器，并在 Bridge 不健康时启动项目内可追踪的后台 Bridge。健康实例会直接复用，重复安装不会启动第二份进程。

```bash
npm run bridge:ensure
npm run bridge:managed-status
npm run bridge:logs
```

PID 与日志保存在本地 `.runtime/`。该方式不会安装 Windows 服务、注册开机启动或修改全局系统设置。停止项目管理的 Bridge：

```bash
npm run bridge:stop-managed
```

Bridge 停止或 Doctor 报错时，可运行 `npm run doctor -- --repair` 自动尝试安全启动，然后再次检查。

## 只使用编辑器，不安装 Codex

```bash
npm ci
npm run dev
```

在浏览器打开 `http://localhost:3000`，即可手动使用完整编辑功能。

1. 在 Pages 区域新建或切换页面。
2. 新建 Frame，或选择常用尺寸预设。
3. 添加图片、文字和矩形，在右侧面板调整属性。
4. 在 Layers 中重命名、排序、显隐、编组或折叠 Frame 内容。
5. 选择 Frame 后导出 PNG 或 JPG。

项目和模板默认保存在浏览器 IndexedDB 中，不会自动上传。浏览器来源不同会使用不同的本地存储；建议定期使用 `.pixel.json` 备份重要项目。

不含品牌或商业素材的入门练习见 [中性演示流程](docs/neutral-demo.md)。

## Doctor 如何判断是否真的可用

`npm run doctor` 会分别检查：

- Node.js 与项目依赖
- 已安装 Skill 是否与仓库一致
- MCP 配置是否指向当前仓库
- MCP Server 源是否存在
- Bridge 常驻服务是否已安装（macOS）
- Bridge 是否真实响应
- 编辑器 HTTP 服务是否真实响应
- 是否存在已连接的主画布
- Codex 工具是否仍需在新任务中人工确认

检查器不会把“配置文件存在”误报为“真实画布可用”。

在 Windows/Linux 上，`npm run doctor -- --repair` 可以在 Bridge 缺失时调用同一安全后台入口；macOS 仍使用 LaunchAgent，不会被改成临时后台进程。

## 修复与卸载

重复执行安装是安全的：配置相同时不会重复写入，也不会重复创建备份。

```bash
npm run setup:codex
npm run setup:codex -- --apply
npm run doctor
```

macOS 停止并移除 Bridge 常驻服务：

```bash
npm run bridge:uninstall
```

Windows/Linux 停止本项目启动的后台 Bridge：

```bash
npm run bridge:stop-managed
```

完全移除 Codex 集成时，还需从 Codex 配置中删除 `[mcp_servers.pixel-local-editor]` 段，并移除 Codex skills 目录下的 `pixel-local-editor`。安装器在修改已有配置前会生成带时间戳的备份，可用于恢复。删除前请关闭相关 Codex 任务；仓库、浏览器画布与 `.pixel.json` 不会被卸载命令删除。

## 开发与测试

```bash
npm test
```

该命令会完成生产构建，并运行编辑器源码契约、安装器隔离测试、Doctor 成功/失败检查、侧栏命令和 Bridge 回归测试。

生产构建与本地预览：

```bash
npm run build
npm run start
```

完整画布命令见 [Command API](COMMAND_API.md)。安装与运维结构见 [Pixel Local 运维入口](ops/pixel-local/README.md)。

## 随仓库提供的其他 Skills

### doc-to-infographic

`skills/doc-to-infographic/` 是一套独立的“文档转可编辑信息图”Skill，包含完整模板、构建/渲染/文字校验/浏览器 QA 脚本、参考资料和离线 html2canvas 依赖。它不会替换或干扰 Pixel Local 主 Skill。

安装到 Codex：

```bash
mkdir -p ~/.codex/skills
cp -R skills/doc-to-infographic ~/.codex/skills/doc-to-infographic
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
Copy-Item -Recurse -Force "skills\doc-to-infographic" "$env:USERPROFILE\.codex\skills\doc-to-infographic"
```

安装后新建 Codex 任务，并用 `$doc-to-infographic` 调用。该 Skill 的浏览器 QA 需要 Chrome/Chromium；完整交互式 JPG QA 还需要可用的 Playwright 包。第三方依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 安全与数据边界

- Bridge 仅监听 `127.0.0.1:43127`，不要暴露到公网。
- 浏览器画布、`.pixel.json`、运行日志、QA 截图和恢复备份不属于源码发布包。
- `public/imports/` 与 `public/template-assets/` 用于本机受控素材，默认不进入 Git。
- 仓库不包含品牌、客户或个人生成素材；请只导入你有权使用的内容。
- `.env*`、私钥、依赖目录和构建产物均已忽略。

## 许可证

Pixel Local 使用 [MIT License](LICENSE)。
