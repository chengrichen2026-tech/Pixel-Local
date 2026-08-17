---
name: pixel-local-editor
description: Directly inspect and operate the local Pixel Local marketing image editor through structured MCP tools, without mouse clicks. Use when the user asks Codex to open or view Pixel Local in the Codex sidebar, read the current canvas or template, inspect pages, frames, text, images or layers, create or update editable designs, replace copy or imagery, apply batch commands, or export a Pixel Local frame as PNG/JPG.
---

# Pixel Local Editor

Use the `pixel-local-editor` MCP tools for Codex automation. Do not use browser mouse automation for Codex canvas reads or edits. The user may still edit manually in the Pixel Local page.

## Viewing in Codex

When the user explicitly asks to open or view Pixel Local in the Codex sidebar or built-in browser, open `http://localhost:3000/` in the Codex in-app Browser and keep the page visible. Do not open the system default browser for that request. Continue to use MCP, not browser mouse automation, for canvas reads and edits.

## Connection preflight

1. If the tools are unavailable or `editor_status` fails, tell the user to run `npm run doctor` in the Pixel Local checkout. Do not claim the integration is installed merely because config files exist.
2. Require a ready Bridge, a running editor service, a connected primary canvas, and Pixel Local MCP tools in the current Codex task before editing.
3. If setup is incomplete, use `npm run setup:codex` to preview the installation plan. Run it with `-- --apply` only after the user authorizes changes to their Codex config and local services. A new Codex task is required after installation.

## Workflow

1. Call `editor_status` before canvas work. If the editor page is not open but its service is running, call `open_editor`; wait for the page to connect before reading or editing. Do not invent canvas state.
2. Call `get_state` before edits. Resolve exact page, Frame, and layer IDs from live state.
3. If the user manually edited the page since the last read, call `get_state` again and use its current revision before the next MCP operation.
4. Read [references/command-api.md](references/command-api.md) only when composing or debugging commands.
5. Call `execute` with one atomic batch whenever the requested changes belong together. Preserve existing IDs unless replacement is explicitly required.
6. Read back with `get_state`. Verify changed IDs and requested properties.
7. Call `export_frame` only when the user requests an exported asset or visual QA. Use an absolute path inside the active workspace.

Use `frame.sidebarCollapse` to collapse or expand one Frame or all Frames in the Layers sidebar. This is UI structure only: it must not hide, delete, or alter canvas objects or exports. Read back `sidebar.collapsedFrameIds` after changing it.

## Safety

- Treat `get_state` output as authoritative for the open editor session.
- Never delete pages, Frames, or layers unless the request requires deletion.
- Prefer `image.replace` over delete-and-create when preserving layout.
- Keep related commands in one batch so editor rollback protects partial failure.
- Report a write only after `execute.ok` and readback both succeed.
- The bridge is local-only at `127.0.0.1:43127`; do not expose it publicly.

## Connection

The MCP server is registered as `pixel-local-editor`. The persistent bridge is managed separately by launchd. The editor connects to it while its page is open.
