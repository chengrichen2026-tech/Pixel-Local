# Pixel Local 运维入口

这里是 Pixel Local 稳定运行相关资产的唯一项目内维护源头。全局 Skill、Codex MCP 注册和 macOS LaunchAgent 仍是安装目标，不直接移动到这里，也不会由日常开发自动改写。

## 目录归属

- `skill/`：`pixel-local-editor` Skill 的项目源。安装副本位于 Codex 全局 Skill 目录。
- `config/codex-mcp.toml.example`：MCP 注册示例；实际配置仍由 Codex 全局配置持有。
- `../../tools/pixel-local-mcp/server.mjs`：MCP Server 源码。
- `../../tools/pixel-local-bridge/`：Bridge 源码与 LaunchAgent 模板。
- `../../scripts/pixel-local-bridge-launchd.sh`：Bridge 安装、状态和卸载入口。
- `scripts/sync-skill.sh`：比较或同步项目 Skill 到全局安装目录。
- `scripts/verify.sh`：只读检查项目源、外部安装指向、Bridge 健康和基础回归。

## 日常操作

```bash
npm run setup:codex
npm run setup:codex -- --apply
npm run doctor
```

`setup:codex` 默认 dry-run；`--apply` 才同步 Skill、备份/更新 MCP 配置并处理本地服务。`doctor` 分开验证配置、服务与真实画布连接。

修改 `skill/` 或 `COMMAND_API.md` 后，先查看差异；确认后才同步：

```bash
npm run pixel:skill:sync
```

同步 Skill 不会热更新已经打开的 Codex 任务。最终验收应在新任务中确认 MCP 工具已挂载，再执行 `editor_status`、`get_state` 回读。修改 Bridge 或 LaunchAgent 时，先运行只读检查；需要重启系统服务时单独确认。

## 完整验收链

1. `npm run build`
2. `npm test`
3. `npm run doctor`
4. 新 Codex 任务中确认 MCP 工具与 `get_state`
5. 涉及画布交互时，再做真实浏览器操作验证
