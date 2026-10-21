# IM Connector（可扩展的多 IM 透传插件）

一个可在 npm 上分发的统一 IM 连接器：通过**一个 MCP 工具 `mcp__im__run`**，按 `provider` 路由到各平台的命令行客户端，返回其 JSON 输出。当前接入**钉钉**（dws）与**企业微信**（wecom-cli），并预留了飞书、Discord 等平台的扩展位。

```
DSH Agent ── mcp__im__run { provider, args } ──▶ dist/mcp/server.js
                ├─ provider=dingtalk ──▶ dws ──▶ 钉钉
                └─ provider=wecom    ──▶ wecom-cli ──▶ 企业微信
```

## 设计核心：Provider 注册表

每个 IM 平台只是 `src/providers/*.ts` 里的一条规格（`ImProviderSpec`），描述：

- 该平台的 CLI 命令名、npm 包名与 bin 脚本路径（用于自动解析 npm 全局安装、规避 Windows shim）
- 请求 JSON 输出的 flag（dws 用 `--format json`；wecom 默认 JSON 则留空）
- 覆盖 bin 的环境变量名、示例命令

**新增一个平台（飞书 / Discord / …）只需**：
1. 新建 `src/providers/feishu.ts`，导出一个 `ImProviderSpec`；
2. 在 `src/providers/registry.ts` 的 `providers` 数组里追加它。

MCP 工具的 `provider` 枚举与描述会**自动**从注册表生成，无需改其它代码。

## 前置条件

```bash
# 钉钉
npm install -g dingtalk-workspace-cli
dws auth login --recommend --format json

# 企业微信
npm install -g @wecom/cli
wecom-cli auth show --status      # 未授权时：wecom-cli auth init --noninteractive 扫码
```

连接器不保存任何凭据，认证复用各 CLI 的本地登录态。

## 构建与验证

```bash
pnpm install
pnpm verify    # typecheck + 测试 + build + MCP 冒烟
```

## 接入 DSH（MCP bundle）

- bundle 目录：`mcp-bundle/`，patch 里 `serverName: im`、`transport: stdio`，`env` 用绝对路径指到 `dws.js` 与 `wecom.js`。
- 安装：`plugin_manager install_bundle`，`target` 为 `mcp-bundle` 绝对路径；改 bundle 后重新 `install_bundle` 覆盖即可。

## 使用

调用 `mcp__im__run`，`provider` 选平台，`args` 是该平台 CLI 的命令数组：

```json
// 钉钉（dws）
{ "provider": "dingtalk", "args": ["contact", "+me"] }
{ "provider": "dingtalk", "args": ["todo", "+get-my-tasks"] }
{ "provider": "dingtalk", "args": ["oa", "approval", "list-pending"] }
{ "provider": "dingtalk", "args": ["chat", "+chat-messages", "--group", "研发群", "--limit", "20"] }
{ "provider": "dingtalk", "args": ["chat", "+messages-send", "--group", "<cid>", "--markdown", "内容", "--title", "标题", "--yes"] }

// 企业微信（wecom-cli）
{ "provider": "wecom", "args": ["contact", "users", "search", "--keywords", "张三"] }
{ "provider": "wecom", "args": ["chat", "messages", "list", "--chat-id", "<id>", "--begin-time", "2026-10-01 00:00:00", "--end-time", "2026-10-21 00:00:00"] }
{ "provider": "wecom", "args": ["auth", "show", "--status"] }
```

写操作（发消息/提交/审批等）需用户明确意图，必要时加 `--yes`（钉钉）或先用 `--dry-run` 预览（两平台都支持 `--dry-run`）。

## npm 发布

```bash
pnpm build
npm publish --access public    # 发布前把 package.json 的 name 改成你的 scope（im-connector 大概率已占用）
```

已就绪：`package.json`（name/version/bin/files/types）、`LICENSE`、`README.md`；`files` 只含 `dist`。

## 目录结构

```
src/
  cli/runner.ts      CliRunner：通用 CLI 透传（npm 全局解析、JSON 解析、错误信封映射）
  cli/errors.ts      CliError + stderr 错误信封解析
  providers/         ImProviderSpec + registry（dingtalk / wecom，可扩展）
  mcp/server.ts      MCP stdio server，暴露单一 `run { provider, args }` 工具
  index.ts           包入口
tests/               fake-cli.mjs + cli/mcp 测试
mcp-bundle/          DSH MCP 连接 bundle
scripts/             mcp-smoke.mjs / duty-reminder.mjs（钉钉值班提醒，独立任务）
```

## 值班提醒（独立任务）

`scripts/duty-reminder.mjs` 由 DSH 周提醒触发，用 `spawnSync` 直接调 `dws`，与本连接器解耦，不受影响。
