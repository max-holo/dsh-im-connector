# im-connector

让 AI Agent 通过 MCP 调用**钉钉（dws）**和**企业微信（wecom-cli）**的 CLI，在渠道里干活：发消息、写日志/日报、建待办、查日程、处理审批。

> 本包只负责「Agent → 渠道」方向（Agent 主动调用钉钉/企微的能力）；在群里/私聊里与机器人对话（渠道 → Agent）不在本包范围内。

## 能力一览

- **工具**：`run`（透传 CLI）、`info`（环境自检）、`login` / `login_status`（扫码登录）
- **MCP resources**（只读发现，按需读取，不消耗调用）
- **Server instructions**：模型系统提示里带调用约定与常见错误说明
- **结构化输出**：工具结果同时返回 `structuredContent`（可被程序化调用/PTC 消费）
- **DSH Web UI**：登录工具的二维码在聊天里**内联渲染**（客户端 toolview）
- **版本兼容声明**：`engines.dsh >= 0.2.2-0`；DSH 插件页支持「更新」到新版本

## 前置条件

- Node.js >= 18
- **Windows 开箱即用**：包内已内置 dws 兜底二进制（Apache-2.0）与企业微信 `wecom-cli`（可选依赖），零安装可用
- **macOS / Linux 同样开箱即用**：包内没有对应平台二进制时，首次调用会自动从官方 GitHub Release 下载该平台的 dws（17–24MB，仅一次），用同一 release 的 `checksums.txt` 校验 sha256 后解压到用户缓存目录；之后直接复用缓存
- **推荐保持最新**：任选一种官方方式安装 dws，插件会**自动优先使用**你安装的版本：
  ```powershell
  # 独立安装（官方主推，dws upgrade 自升级）
  irm https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.ps1 | iex
  # 或 npm 全局
  npm i -g dingtalk-workspace-cli
  ```
- CLI 解析顺序：`DINGTALK_DWS_BIN`/`~/.im-connector/config.json` 覆盖 → 官方独立安装（`~/.local/bin`）→ npm 全局 → 本地依赖 → **内置兜底** → **按需下载官方 release** → PATH
- 离线 / 内网：`DINGTALK_DWS_NO_DOWNLOAD=1` 关闭自动下载；`DINGTALK_DWS_DOWNLOAD_BASE=<镜像前缀>` 改用镜像（支持 http）；`DINGTALK_DWS_VERSION=v1.0.68` 固定版本；`IM_CONNECTOR_CACHE_DIR` 指定缓存目录
- **下载失败时的提示**：`info` 返回 `available: false` + `download.error`（真实原因，如超时/连接拒绝/校验不符）+ `hint`（四条可照做的修复方式）；`run`/`login` 的失败结果也带同一份 `hint`，不会只丢一句 `spawn ENOENT`
- **登录一次即可**（凭据保存在 CLI 自己的本地登录态，本包不接触凭据）——见下方「登录」

## 安装

```bash
npx -y im-connector          # 直接用，无需安装
npm i -g im-connector        # 或全局安装
```

> 安装体积约 25MB（只含 Windows 版 dws 兜底二进制 + 企业微信 CLI），不需要 pnpm 允许任何安装脚本。

## 登录（扫码即可，不用终端）

| 平台 | 调用 | 交互 |
|---|---|---|
| 企业微信 | `login {provider:"wecom"}` | 返回**二维码图片**（DSH 中内联显示），用企业微信扫码 |
| 钉钉 | `login {provider:"dingtalk"}` | 自动拉起**浏览器授权**（无头/远程环境用 `mode:"device"` 走设备码） |

授权完成后调用 `login_status {provider}`，看到 `authorized: true` 即可开始使用。

终端手动登录：

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

**DSH 用户**一条命令（装包 + 注册 MCP 连接 + 浏览器 toolview）：

```
plugin_manager install_bundle  target: im-connector
```

安装后工具名为 `mcp__im__run`（另有 `info` / `login` / `login_status`）。

### 在 DSH 插件市场（Discover）中安装

本包在 npm 包内自带市场索引 `market/index.json`，把下面任一地址添加为 Discover 的 index 源即可搜索安装：

```
https://cdn.jsdelivr.net/npm/im-connector@latest/market/index.json
https://unpkg.com/im-connector@latest/market/index.json
```

### 可选：用 DSH 凭据模板注入环境变量

bundle patch 已开启 `expandTemplates`，需要给 CLI 传额外环境变量时可用 `${credential:REF}`，凭据不会出现在配置或对话里：

```yaml
env:
  MY_BOT_TOKEN: '${credential:im-bot-token}'
```

## 使用

Agent 调用 `mcp__im__run`，参数是 `{ provider, args }`，`args` 就是对应 CLI 的原生命令参数：

```json
// 发消息
{ "provider": "dingtalk", "args": ["chat", "+messages-send", "--group", "<群ID>", "--markdown", "内容", "--yes"] }

// 待办
{ "provider": "dingtalk", "args": ["todo", "+create", "--title", "整理今日测试报告", "--due", "2026-10-23 18:00"] }
{ "provider": "dingtalk", "args": ["todo", "+get-my-tasks"] }

// 日志 / 日报周报
{ "provider": "dingtalk", "args": ["report", "template", "list"] }
{ "provider": "dingtalk", "args": ["report", "entry", "submit", "--template-id", "<id>", "--contents-file", "./report.json"] }

// 日程 / 审批 / 通讯录
{ "provider": "dingtalk", "args": ["calendar", "+today"] }
{ "provider": "dingtalk", "args": ["oa", "approval", "list-pending"] }
{ "provider": "dingtalk", "args": ["contact", "+me"] }

// 企业微信
{ "provider": "wecom", "args": ["contact", "users", "search", "--keywords", "张三"] }
{ "provider": "wecom", "args": ["message", "aibot", "sessions", "list"] }
```

完整命令见各 CLI 的 `--help`（如 `dws chat --help`、`wecom-cli message --help`）。

## 资源（MCP resources，只读发现）

| 资源 | 内容 |
|---|---|
| `im://providers` | 平台目录、CLI、是否内置二进制、示例命令 |
| `im://dingtalk/services` | dws 服务域清单（24 个，含 contact/chat/calendar/todo/oa/doc/wiki/mail/minutes/attendance/report/sheet/whiteboard/aitable/agoal/hrbrain 等） |
| `im://wecom/sessions` | 机器人最近会话（按最后消息时间倒序） |
| `im://dingtalk/templates` | 日志模板名称与模板 ID |
| `im://dingtalk/group/{group}/messages?limit=N` | 读取指定群的最近消息（资源模板） |

DSH 自带共享资源工具（`list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`），模型可按需读取；读取失败会返回可读诊断而不是协议错误。

## 自检

调用 `info` 工具（无参数）返回每个平台的 CLI 版本、登录状态与实际可执行入口：

```json
{
  "providers": [
    {
      "id": "dingtalk",
      "displayName": "钉钉",
      "version": "dws version v1.0.65 (...)",
      "bundled": true,
      "resolved": "<profile>/node_modules/im-connector/vendor/dws/win32-x64/dws.exe",
      "auth": { "authenticated": true, "corp_name": "...", ... }
    },
    { "id": "wecom", "version": "wecom-cli 1.3.4", "auth": "authorized" }
  ]
}
```

## 说明

- **写操作**（发消息、提交审批等）请先让 Agent 确认意图；不确定时用 `--dry-run` 预览（两平台都支持）
- 参数会原样透传给 CLI，返回其 JSON 输出 + `structuredContent`
- 支持的 provider：`dingtalk`（dws，24 个服务域）、`wecom`（wecom-cli，`--schema`/`--page-count`/`--dry-run`）
- 企业微信 `errcode 853006` / `850003` 指企业未开通或授权过期，需要管理员授权/重新登录，不是本插件问题

## 开发

```bash
pnpm install
pnpm verify     # typecheck + 测试 + 构建（含浏览器 toolview）+ MCP 冒烟
```

- 内置 dws 二进制升级：`npm i -g dingtalk-workspace-cli@latest && node scripts/vendor-dws.mjs`
- 浏览器 toolview 源码在 `client-src/index.js`，`scripts/build-client.mjs` 产出 `lib/client.js`

发布（维护者）：

```bash
npm version patch
npm publish --registry=https://registry.npmjs.org/
```
