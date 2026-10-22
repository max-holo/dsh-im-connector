# IM Connector（可扩展的多 IM 透传插件）

一个可在 npm 上分发的统一 IM 连接器：通过**一个 MCP 工具 `mcp__im__run`**，按 `provider` 路由到各平台的命令行客户端，返回其 JSON 输出。当前接入**钉钉**（dws）与**企业微信**（wecom-cli），并预留了飞书、Discord 等平台的扩展位。

```
DSH Agent ── mcp__im__run { provider, args } ──▶ dist/mcp/server.js
                ├─ provider=dingtalk ──▶ dws ──▶ 钉钉
                └─ provider=wecom    ──▶ wecom-cli ──▶ 企业微信
```

## 定位：Agent 侧集成（让机器人在渠道里干活）

本连接器只负责**「Agent → 渠道」方向**：Agent 通过 MCP 工具调用 dws / wecom-cli，让机器人在钉钉/企微里完成实际工作——发消息、写日志/日报、建待办、查日程、处理审批等。

**渠道 → Agent 方向**（在群里/私聊里跟机器人对话）由独立的 `dsh-im` 插件负责，不在本连接器的范围内。

## 典型用法（让机器人在渠道里干活）

```json
// 发消息到群 / 私聊
{ "provider": "dingtalk", "args": ["chat", "+messages-send", "--group", "<openConversationId>", "--markdown", "今天 18:00 前提交周报", "--yes"] }
{ "provider": "dingtalk", "args": ["chat", "+messages-send", "--user", "<userId>", "--markdown", "私聊通知", "--yes"] }

// 写/提交日志（日报周报）
{ "provider": "dingtalk", "args": ["report", "+create", "--template", "日报", "--content", "...", "--yes"] }
{ "provider": "dingtalk", "args": ["report", "+my", "--type", "日报"] }

// 待办
{ "provider": "dingtalk", "args": ["todo", "+create", "--title", "整理今日测试报告", "--due", "2026-10-23 18:00"] }
{ "provider": "dingtalk", "args": ["todo", "+get-my-tasks"] }

// 日程 / 审批 / 通讯录
{ "provider": "dingtalk", "args": ["calendar", "+today"] }
{ "provider": "dingtalk", "args": ["oa", "approval", "list-pending"] }
{ "provider": "dingtalk", "args": ["contact", "+me"] }

// 企业微信
{ "provider": "wecom", "args": ["contact", "users", "search", "--keywords", "张三"] }
{ "provider": "wecom", "args": ["message", "send", "--chat-id", "<id>", "--msg-type", "text", "--text", "{\"content\":\"通知内容\"}"] }
```

写操作需用户明确意图；不确定时先用 `--dry-run` 预览（两平台都支持）。

## 设计核心：Provider 注册表

每个 IM 平台只是 `src/providers/*.ts` 里的一条规格（`ImProviderSpec`），描述：

- 该平台的 CLI 命令名、npm 包名与 bin 脚本路径（用于自动解析 npm 全局安装、规避 Windows shim）
- 请求 JSON 输出的 flag（dws 用 `--format json`；wecom 默认 JSON 则留空）
- 覆盖 bin 的环境变量名、示例命令

**新增一个平台（飞书 / Discord / …）只需**：
1. 新建 `src/providers/feishu.ts`，导出一个 `ImProviderSpec`；
2. 在 `src/providers/registry.ts` 的 `providers` 数组里追加它。

MCP 工具的 `provider` 枚举与描述会**自动**从注册表生成，无需改其它代码。

## 快速开始（npm）

```bash
npm i -g im-connector        # 全局安装（提供 im-connector 命令）
# 或直接用 npx（无需安装）：
npx -y im-connector
```

`im-connector` 是一个 **stdio MCP server**：任何 MCP 客户端（DSH / Claude Desktop / 其它 Agent）都可以把它注册成 MCP 连接。配置示例：

```json
{
  "mcpServers": {
    "im": {
      "command": "npx",
      "args": ["-y", "im-connector"],
      "env": {
        "DINGTALK_DWS_BIN": "<npm root -g>/dingtalk-workspace-cli/bin/dws.js",
        "WECOM_CLI_BIN": "<npm root -g>/@wecom/cli/bin/wecom.js"
      }
    }
  }
}
```

> `env` 可选：不填时连接器会自动通过 `npm root -g` 解析两个 CLI；填了更稳（规避 Windows shim）。

DSH 用户：本包**同时是 DSH 的 MCP 连接 bundle**（`package.json` 里声明了 `dsh.bundle.patch`），一条命令完成"装包 + 注册 MCP 连接"：

```
plugin_manager install_bundle  target: im-connector
```

安装后工具名为 `mcp__im__run`。细节与手工安装方式见 `mcp-bundle/README.md`。

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

## 接入 DSH（官方推荐路径）

按 DSH 官方 `references/mcp-bundle.md` 的做法：**配置型 bundle**（只插入一条 `@deepseek-ai/dsh-mcp-client` 行，无 Host/Client 入口文件），display 元数据用 `locale/*.json` + `icon.svg`，patch 用官方 stdio 形式：

```yaml
- insert:
    - id: im-connector-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: im
        transport: stdio
        command: npx
        args: ['-y', 'im-connector']
        failOnStartupError: true
```

- 推荐安装：`plugin_manager install_bundle  target: im-connector`（包内已声明 `dsh.bundle.patch`，一步完成）
- 手工安装：把 `mcp-bundle/` 复制到任意目录后 `install_bundle` 指向该目录
- 不需要写死路径或凭据（`npx` 跨平台；凭据保持在两个 CLI 自己的登录态里，env 覆盖用 Loader `!!js`）

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

## 发布（维护者）

```bash
npm login          # 首次发布前登录（已登录则跳过）
pnpm verify        # typecheck + 测试 + build + MCP 冒烟（prepublishOnly 也会跑）
npm publish        # 发布到 npm（publishConfig.access=public）
```

发布内容（`files`）：`dist/`（编译产物 + shebang 入口）、`mcp-bundle/`（DSH 连接 bundle）、`README.md`、`LICENSE`。

发布前可用 `npm pack --dry-run` 查看实际打包清单。

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
