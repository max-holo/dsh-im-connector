# im-connector

让 AI Agent 通过 MCP 调用**钉钉（dws）**和**企业微信（wecom-cli）**的 CLI，在渠道里干活：发消息、写日志/日报、建待办、查日程、处理审批。

> 本包只负责「Agent → 渠道」方向。在群里/私聊里与机器人对话（渠道 → Agent）请用 dsh-im 插件。

## 前置条件

- Node.js >= 18
- **钉钉**：`npm i -g dingtalk-workspace-cli`，然后 `dws auth login --recommend`
- **企业微信**：`npm i -g @wecom/cli`，然后 `wecom-cli auth init --noninteractive` 扫码授权

连接器不保存任何凭据，直接用两个 CLI 自己的登录态。

## 安装

```bash
npx -y im-connector          # 直接用，无需安装
npm i -g im-connector        # 或全局安装
```

## 配置 MCP 客户端

通用 MCP 客户端（如 Claude Desktop）：

```json
{
  "mcpServers": {
    "im": { "command": "npx", "args": ["-y", "im-connector"] }
  }
}
```

**DSH 用户**一条命令即可（装包 + 注册 MCP 连接）：

```
plugin_manager install_bundle  target: im-connector
```

安装后工具名为 `mcp__im__run`。

## 使用

Agent 调用 `mcp__im__run`，参数是 `{ provider, args }`，`args` 就是对应 CLI 的原生命令参数：

```json
// 发消息
{ "provider": "dingtalk", "args": ["chat", "+messages-send", "--group", "<群ID>", "--markdown", "内容", "--yes"] }

// 待办
{ "provider": "dingtalk", "args": ["todo", "+create", "--title", "整理今日测试报告", "--due", "2026-10-23 18:00"] }
{ "provider": "dingtalk", "args": ["todo", "+get-my-tasks"] }

// 日志 / 日报周报
{ "provider": "dingtalk", "args": ["report", "+create", "--template", "日报", "--content", "..."] }

// 日程 / 审批 / 通讯录
{ "provider": "dingtalk", "args": ["calendar", "+today"] }
{ "provider": "dingtalk", "args": ["oa", "approval", "list-pending"] }
{ "provider": "dingtalk", "args": ["contact", "+me"] }

// 企业微信
{ "provider": "wecom", "args": ["contact", "users", "search", "--keywords", "张三"] }
```

完整命令见各 CLI 的 `--help`（如 `dws chat --help`、`wecom-cli message --help`）。

## 说明

- **写操作**（发消息、提交审批等）请先让 Agent 确认意图；不确定时用 `--dry-run` 预览（两平台都支持）
- 参数会原样透传给 CLI，返回其 JSON 输出
- 支持的 provider：`dingtalk`、`wecom`

## 开发

```bash
pnpm install
pnpm verify     # typecheck + 测试 + 构建 + MCP 冒烟
```

发布（维护者）：

```bash
npm version patch
npm publish --registry=https://registry.npmjs.org/
```
