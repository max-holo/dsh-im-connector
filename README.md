# im-connector

让 AI Agent 通过 MCP 调用**钉钉（dws）**和**企业微信（wecom-cli）**的 CLI，在渠道里干活：发消息、写日志/日报、建待办、查日程、处理审批。

> 本包只负责「Agent → 渠道」方向。在群里/私聊里与机器人对话（渠道 → Agent）请用 dsh-im 插件。

## 前置条件

- Node.js >= 18
- 两个命令行工具（dws / wecom-cli）**已随包一起安装**（可选依赖），无需单独安装
- **登录一次即可**（凭据保存在 CLI 自己的本地登录态，本包不接触凭据）——见下方「登录」

> 使用 pnpm 安装时，若提示 CLI 不可用，允许依赖的安装脚本（`pnpm approve-builds`）或手动 `npm i -g dingtalk-workspace-cli @wecom/cli` 即可。

## 安装

```bash
npx -y im-connector          # 直接用，无需安装
npm i -g im-connector        # 或全局安装
```

> 注意：首次安装会下载两个 CLI（dws 约 130MB），之后无需再装。

## 登录（扫码即可，不用终端）

配置好 MCP 客户端后，让 Agent 调用 `login` 工具：

| 平台 | 调用 | 交互 |
|---|---|---|
| 企业微信 | `login {provider:"wecom"}` | 返回**二维码图片**，用企业微信扫码 |
| 钉钉 | `login {provider:"dingtalk"}` | 自动拉起**浏览器授权**（无头/远程环境用 `mode:"device"` 走设备码） |

授权完成后调用 `login_status {provider}`，看到 `authorized: true` 即可开始使用。

也可以在终端里手动登录：

```bash
dws auth login --recommend                    # 钉钉（浏览器授权）
wecom-cli auth init --noninteractive          # 企业微信（终端二维码）
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

## 自检

调用 `info` 工具（无参数）返回每个平台的 CLI 版本、登录状态与实际可执行入口：

```json
{
  "providers": [
    {
      "id": "dingtalk",
      "displayName": "钉钉",
      "version": "dws version v1.0.65 (...)",
      "resolved": "<npm>/dingtalk-workspace-cli/bin/dws.js",
      "auth": { "authenticated": true, "corp_name": "...", ... }
    },
    { "id": "wecom", "version": "wecom-cli 1.3.4", "auth": "authorized" }
  ]
}
```

## 说明

- **写操作**（发消息、提交审批等）请先让 Agent 确认意图；不确定时用 `--dry-run` 预览（两平台都支持）
- 参数会原样透传给 CLI，返回其 JSON 输出
- 支持的 provider：`dingtalk`（dws，24 个服务域 + `api`/`aicard`/`audit` 等）、`wecom`（wecom-cli，`--schema`/`--page-count`/`--dry-run`）

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
