# DingTalk 统一入口（dws 透传 MCP）

不再维护自有 CLI / 只读工具封装。直接把 [dingtalk-workspace-cli](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)（`dws`）以「透传」形式接入 MCP：**一个工具 `mcp__dingtalk__run` 覆盖 dws 全量读写能力**，dws 本身是唯一的能力层。

```
DSH Agent ── mcp__dingtalk__run ──▶ dist/mcp/server.js ──spawn──▶ dws ──▶ 钉钉
```

## 前置条件

```bash
npm install -g dingtalk-workspace-cli
dws auth login --recommend --format json   # 浏览器扫码登录
dws auth status --format json              # 验证 authenticated/token_valid
```

连接器不保存凭据，认证复用 dws 本地登录态。

## 构建与验证

```bash
pnpm install
pnpm verify    # typecheck + 测试 + build + MCP 冒烟
```

## 接入 DSH（MCP bundle）

- bundle 目录：`mcp-bundle/`（`cordis.patch.yml` 里 `serverName: dingtalk`、`transport: stdio`、
  `command` 指向 node、`args` 指向 `dist/mcp/server.js`、`env.DINGTALK_DWS_BIN` 指向 dws.js 绝对路径）。
- 安装：`plugin_manager install_bundle`，`target` 为 `mcp-bundle` 的绝对路径。
- 改 bundle 后重新 `install_bundle` 即可覆盖（不要另建重复 bundle）。

## 使用

调用唯一工具 `mcp__dingtalk__run`，参数 `args` 是 dws 命令字符串数组（自动追加 `--format json`）：

```json
{ "args": ["contact", "+me"] }
{ "args": ["calendar", "+today"] }
{ "args": ["todo", "+get-my-tasks"] }
{ "args": ["oa", "approval", "list-pending"] }
{ "args": ["attendance", "+check-result", "--users", "u1,u2", "--start", "2026-10-01", "--end", "2026-10-10"] }
{ "args": ["report", "inbox", "list"] }
{ "args": ["doc", "read", "--node", "<docId|url>"] }
{ "args": ["chat", "+chat-messages", "--group", "<群名|id>", "--limit", "20"] }

// 写操作（需明确意图，必要时加 --yes）
{ "args": ["chat", "+messages-send", "--group", "<openConversationId>", "--markdown", "<内容>", "--title", "<标题>", "--yes"] }
{ "args": ["report", "entry", "submit", "--template-id", "<id>", "--contents-file", "./report.json", "--to-user-ids", "<userId>", "--yes"] }
```

## 目录结构

```
src/
  config.ts        连接器配置（dwsBin/profile/timeout，env 加载）
  dws/runner.ts    DwsRunner：dws 解析（npm 全局/显式路径）、JSON/NDJSON 解析、错误信封映射、--format 注入
  dws/errors.ts    DwsError + stderr 错误信封解析
  mcp/server.ts    MCP stdio server，暴露单一 `run` 透传工具
  index.ts         包入口
tests/             fake-dws.mjs + runner/mcp 测试
mcp-bundle/        DSH MCP 连接 bundle
scripts/           mcp-smoke.mjs / duty-reminder.mjs（值班提醒，独立任务）
```

## 值班提醒（独立任务，与本连接器解耦）

`scripts/duty-reminder.mjs` 由 DSH 的周提醒（每周五 18:00）触发，内部用 `spawnSync` 直接调 `dws chat +messages-send`，不依赖本连接器。它也可以用 `mcp__dingtalk__run` 等效完成，但保持直接调 dws 更简单、更少一层依赖。
