# DingTalk Connector（基于 dws 的钉钉只读连接器）

基于 **[dingtalk-workspace-cli](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)**（`dws`）实现的钉钉只读连接器：
一套 TypeScript SDK 同时提供 **MCP Server**、**CLI** 和**模块化 SDK**，覆盖 7 大读取域。

> 核心思路：认证与产品调用全部交给 dws（本地 OAuth 登录态 + 成熟命令面），
> 本连接器在其上提供类型化模块、48 个只读工具、统一错误映射与 MCP/CLI 入口。

## 能力矩阵

| 域 | 读取能力 | 底层 dws 命令 |
|---|---|---|
| 消息 | 会话列表、我加入的群、未读会话、**历史消息读取**、消息搜索、**Stream 实时监听** | `chat +chat-list` / `+my-groups` / `+chat-messages` / `+search-msg` / `event +listen-im` |
| 日历 | 今天/明天/本周日程、时间范围日程、日程详情、闲忙、日历本 | `calendar +today/+tomorrow/+week/+agenda/+get/+freebusy/+book-list` |
| 待办 | 我的待办、与我相关的待办、我创建的/今日到期/逾期、详情、搜索 | `todo +get-my-tasks/+get-related-tasks/+created-todos/+due-today/+overdue/+get/+search` |
| 审批 | 待我审批/已处理/抄送我/我发起的、表单列表/搜索、实例详情、操作记录 | `oa approval list-pending/list-executed/list-cc/list-submitted/list-forms/detail/records` |
| 考勤 | 今日/本月打卡、批量打卡结果、考勤统计摘要（周/月） | `attendance +my-attendance/+this-month/+check-result/+get-summary` |
| 日志 | 收件箱/发件箱、单份正文、模板列表 | `report inbox list/outbox list/entry get/template list` |
| 文档 | 文档正文（Markdown）、元信息、子节点、搜索、知识库列表/节点、钉盘列表/详情/最近 | `doc read/info/+list/+find-doc`、`wiki +space-list/+node-list`、`drive +list/+info/+recent` |
| 通讯录 | 我自己、按姓名搜索、部门成员、子部门 | `contact +me/+search-user/+dept-members/+list-sub-depts` |

## 前置条件

```bash
# 1) 安装 dws
npm install -g dingtalk-workspace-cli

# 2) 登录（浏览器扫码）；无头环境用 --device；国际版加 --intl
dws auth login --recommend --format json
dws auth status --format json   # 验证 authenticated / token_valid
```

连接器**不保存任何钉钉凭据**——认证完全复用 dws 的本地登录态与 profile 体系。

## 安装与构建

```bash
pnpm install
pnpm build     # tsc -> dist/
pnpm verify    # typecheck + 20 测试 + build + MCP 冒烟（本地 fake dws，无需真实账号）
```

Node ≥ 18.17（开发环境 Node 22）。

## 使用

### 1. CLI

```bash
node dist/cli.js tools                            # 列出 48 个只读工具
node dist/cli.js status                           # 查看 dws 登录态

node dist/cli.js call contact_me                  # 通讯录：我自己
node dist/cli.js call contact_search_user '{"query":"张三"}'
node dist/cli.js call calendar_today              # 日历：今天
node dist/cli.js call calendar_agenda '{"start":"2026-10-01T00:00:00+08:00","end":"2026-10-08T00:00:00+08:00"}'
node dist/cli.js call todo_list_my_tasks          # 待办
node dist/cli.js call approval_list_pending       # 审批
node dist/cli.js call attendance_check_result '{"users":["<userId>"],"start":"2026-10-01","end":"2026-10-07"}'
node dist/cli.js call report_inbox                # 日志收件箱
node dist/cli.js call wiki_space_list             # 知识库
node dist/cli.js call im_my_groups                # 我加入的群
node dist/cli.js call im_chat_messages '{"group":"研发群","limit":20}'   # 历史消息

# 逃生舱：直接运行任意 dws 命令
node dist/cli.js raw calendar +week

# 实时监听 IM（@我 / 指定群 / 全部群聊），Ctrl+C 停止
node dist/cli.js listen --kind at-me --max-events 5
node dist/cli.js listen --kind group --chat-id <openConversationId>
```

### 2. MCP Server（stdio）

```json
{
  "mcpServers": {
    "dingtalk": {
      "command": "node",
      "args": ["D:\\dingtalk\\dist\\mcp\\server.js"]
    }
  }
}
```

无需在配置里放密钥；`dws` 需在 PATH 上（或用 `DINGTALK_DWS_BIN` 指向 dws 入口）。

### 3. SDK

```ts
import { DingTalkConnector } from "dingtalk-connector";

const conn = new DingTalkConnector(); // 可选 { profile, timeoutSec, dwsBin }

const me = await conn.contacts.me();                        // 我自己
const { data } = (await conn.todo.listMyTasks()) as any;    // 我的待办
const pending = await conn.approval.listPending();          // 待我审批
const groups = await conn.messages.myGroups();              // 我加入的群
const msg = await conn.messages.chatMessages({ group: "研发群", limit: 20 }); // 历史消息
const spaces = await conn.docs.listWikiSpaces();            // 知识库
const events = await conn.calendar.today();                 // 今日日程
```

各方法返回 dws 命令解析后的 JSON payload（透传，保留 `ok/outcome/data` 或
`errorCode/result` 等完整性信号，含分页 `hasMore/nextCursor` 等）。

## 关于「消息读取」

dws 相比直接 OpenAPI 的一大优势是**能读历史消息**：
- 历史读取：`im_chat_messages`（`chat +chat-messages`）、`im_search_messages`（`chat +search-msg`）
- 实时监听：`dtconn listen`（`event +listen-im`，Stream 长连接，NDJSON 输出）

## 验证

- `pnpm test`：20 个用例，用 [tests/fake-dws.mjs](tests/fake-dws.mjs) 模拟 dws 二进制，
  断言每个模块构造的 dws 命令、`--format json`/`--profile`/`--timeout` 注入、stderr 错误信封映射与 NDJSON 流解析。
- `pnpm smoke:mcp`：编译产物走 MCP stdio 协议（initialize → tools/list，48 工具）。
- 真实账号端到端：本机 dws 已登录，`contact_me` / `todo_list_my_tasks`（20 条）/
  `im_my_groups`（58 个群）/ `wiki_space_list`（7 个知识库）/ `report_templates`（8 个模板）/
  `attendance_my_today`（1 条打卡）等均实测通过。

## 配置（可选，环境变量）

| 变量 | 用途 |
|---|---|
| `DINGTALK_DWS_BIN` | dws 入口；默认解析 npm 全局安装 |
| `DINGTALK_DWS_PROFILE` | 一次性指定组织/账号（`corpId:userId`） |
| `DINGTALK_DWS_TIMEOUT` | HTTP 超时秒数，默认 30 |

## 目录结构

```
src/
  config.ts          连接器配置（dws 入口 / profile / timeout，env 加载）
  connector.ts       DingTalkConnector 装配入口 + run() 逃生舱
  dws/
    runner.ts        进程执行器：dws 解析（npm 全局/显式路径）、JSON/NDJSON 解析、flag 注入
    flags.ts         flag 构造（kebab-case、CSV、布尔）
    errors.ts        DwsError + stderr 错误信封解析
  modules/           8 个领域模块（contacts/calendar/todo/approval/attendance/report/docs/messages）
  tools.ts           48 个只读工具注册表（MCP 与 CLI 共用）+ 参数校验
  mcp/server.ts      MCP stdio server
  cli.ts             dtconn CLI（tools/call/raw/listen/status）
tests/               fake-dws.mjs + runner/modules/mcp 测试
scripts/mcp-smoke.mjs  MCP 编译产物冒烟
```
