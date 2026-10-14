# DingTalk Connector（钉钉只读连接器）

连接钉钉开放平台的只读连接器：一套 TypeScript SDK 同时提供 **MCP Server**（给 AI Agent /
MCP 客户端用）、**CLI**（人工验证用）和**模块化 SDK**（程序集成用）。

覆盖 7 大读取域：

| 域 | 读取能力 | 核心端点 |
|---|---|---|
| 消息 | 企业会话列表、群信息、场景群成员、**Stream 实时消息捕获**（本地落盘可查） | `/chat/list`、`/v1.0/im/conversations/*`、Stream `/v1.0/im/bot/messages/get` |
| 日历 | 日历列表、按时间范围查日程、日程详情、参与者 | `/v1.0/calendar/users/{unionId}/calendars/*` |
| 待办 | 用户待办列表（按角色/状态过滤）、详情 | `/v1.0/todo/users/{unionId}/org/tasks/query` |
| 审批 | 可见审批模板、实例 ID 列表、实例详情（表单/任务/操作记录）、待审批数量 | `/v1.0/workflow/*`、`/topapi/process/*` |
| 考勤 | 打卡结果、打卡详情、部门/用户签到记录 | `/attendance/list`、`/attendance/listRecord`、`/checkin/record` |
| 日志 | 日志记录（日报/周报）、模板列表、模板详情 | `/topapi/report/*` |
| 文档 | 空间列表、文件列表、知识库列表/节点、**文档内容（块）** | `/v1.0/drive/*`、`/v2.0/wiki/*`、`/v1.0/doc/suites/documents/*` |
| 通讯录 | 用户详情/搜索、手机号/unionId 反查、部门成员/子部门（ID 体系入口） | `/topapi/v2/user/*`、`/v1.0/contact/users/search` |

所有端点均已对照钉钉开放平台官方文档逐一核对（`open.dingtalk.com/document/...`）。

## 设计要点

- **只读**：所有工具/方法均为读取操作，不产生任何写入。
- **企业内部应用凭证**：AppKey/AppSecret 换取 `accessToken`，自动缓存、提前刷新；
  各模块以 `userId` / `unionId` 指定数据归属。
- **双域名适配**：新 REST（`api.dingtalk.com`，header 鉴权）与旧 OAPI
  （`oapi.dingtalk.com`，query 鉴权 + `errcode` 语义）统一封装。
- **健壮性**：请求超时、429/5xx/网络错误指数退避重试、统一 `DingTalkError` 错误映射。
- **分片与翻页**：考勤自动按 50 人/7 天分片；列表类接口自动跟随 `nextToken` /
  `next_cursor` 并带截断保护。
- **一套工具注册表**：MCP 与 CLI 共用同一份工具定义（33 个工具），行为完全一致。

## 安装与构建

```bash
pnpm install
pnpm build     # tsc -> dist/
pnpm test      # 42 个用例（mock 钉钉服务器，无需真实凭证）
```

Node ≥ 18.17（开发环境为 Node 22）。

## 凭证准备（一次性）

1. 登录[钉钉开发者后台](https://open-dev.dingtalk.com/) → 应用开发 → 创建**企业内部应用**。
2. 在「凭证与基础信息」页获取 **AppKey** 和 **AppSecret**。
3. 在「权限管理」中申请以下读取权限（按需）：

| 模块 | 权限点（官方 code） |
|---|---|
| 考勤 | `qyapi_get_attendance_data`（考勤数据读权限） |
| 审批 | `Workflow.Instance.Read`（工作流实例读权限） |
| 知识库 | `Wiki.Workspace.Read`（知识库读权限）、`Wiki.Node.Read`（知识库节点读权限） |
| 文档内容 | `Storage.File.Read`（企业存储文件读权限） |
| 日历/待办/日志/通讯录/钉盘 | 在权限管理中按产品名搜索并申请对应**读权限**（如"日程读权限"、"待办读权限"、"日志读权限"、"通讯录员工信息读权限"等） |

4. 若需要**消息捕获**：应用能力 → 添加「机器人」，消息接收模式选择 **Stream 模式**，发布。

## 配置

环境变量（复制 `.env.example`）：

```bash
DINGTALK_APP_KEY=dingxxxxxxxx
DINGTALK_APP_SECRET=xxxxxxxxxxxx
# 可选
# DINGTALK_API_BASE / DINGTALK_OAPI_BASE  覆盖域名（测试/代理）
# DINGTALK_CAPTURE_FILE=./.dingtalk-capture.jsonl  消息捕获落盘文件
```

## 使用

### 1. CLI

```bash
# 列出全部 33 个只读工具
node dist/cli.js tools

# 通讯录找人 → 拿 unionId（日历/待办/文档都需要）
node dist/cli.js call contact_search_user '{"queryWord":"张三"}'
node dist/cli.js call contact_get_user '{"userid":"0420xxxx"}'

# 日历：本周日程
node dist/cli.js call calendar_list_events \
  '{"unionId":"tXguNxxxx","timeMin":"2026-10-13T00:00:00+08:00","timeMax":"2026-10-20T00:00:00+08:00"}'

# 待办 / 审批 / 考勤 / 日志
node dist/cli.js call todo_list_tasks '{"unionId":"tXguNxxxx","isDone":false}'
node dist/cli.js call approval_list_forms '{"userid":"0420xxxx"}'
node dist/cli.js call approval_list_instance_ids '{"processCode":"PROC-xxxx","startTime":"2026-07-01"}'
node dist/cli.js call attendance_list_punch_results '{"userIds":["0420xxxx"],"dateFrom":"2026-10-01","dateTo":"2026-10-14"}'
node dist/cli.js call report_list '{"startTime":"2026-10-01","endTime":"2026-10-14","templateName":"日报"}'

# 文档：知识库 → 节点 → 正文
node dist/cli.js call wiki_list_workspaces '{"unionId":"tXguNxxxx"}'
node dist/cli.js call wiki_list_nodes '{"parentNodeId":"<rootNodeId>","unionId":"tXguNxxxx"}'
node dist/cli.js call docs_get_blocks '{"docKey":"<nodeId 即 dentryUuid>","unionId":"tXguNxxxx"}'

# 消息：实时捕获（Ctrl+C 停止），然后查询捕获到的消息
node dist/cli.js capture
node dist/cli.js call im_list_captured_messages '{"keyword":"部署","limit":20}'
```

### 2. MCP Server（stdio）

任何 MCP 客户端可接入：

```json
{
  "mcpServers": {
    "dingtalk": {
      "command": "node",
      "args": ["D:\\dingtalk\\dist\\mcp\\server.js"],
      "env": {
        "DINGTALK_APP_KEY": "dingxxxxxxxx",
        "DINGTALK_APP_SECRET": "xxxxxxxxxxxx"
      }
    }
  }
}
```

DSH 用户可在「MCP 连接」中按同样方式登记（command + args + env）。

### 3. SDK

```ts
import { DingTalkConnector } from "dingtalk-connector";

const conn = new DingTalkConnector({
  appKey: process.env.DINGTALK_APP_KEY!,
  appSecret: process.env.DINGTALK_APP_SECRET!,
});

// ID 体系：userId → unionId
const unionId = await conn.contacts.getUnionId("0420xxxx");

// 日历：本周日程
const { events } = await conn.calendar.collectEvents(
  unionId,
  "2026-10-13T00:00:00+08:00",
  "2026-10-20T00:00:00+08:00",
);

// 审批：某模板最近实例 + 详情
const { instanceIds } = await conn.approval.listInstanceIds("PROC-xxxx", "2026-07-01");
const detail = await conn.approval.getInstance(instanceIds[0]);

// 日志 / 考勤 / 待办 / 文档
const { reports } = await conn.report.listReports("2026-10-01", "2026-10-14");
const { records } = await conn.attendance.listPunchDetails(["0420xxxx"], "2026-10-01", "2026-10-07");
const { tasks } = await conn.todo.collectTasks(unionId, { isDone: false });
const blocks = await conn.docs.getDocBlocks("<docKey>", unionId);
```

## 关于"消息读取"的重要说明

钉钉开放平台**不提供任意历史消息读取 API**（合规限制，官方无此能力）。本连接器提供的消息读取组合是：

1. **会话元数据**：企业会话列表、群信息、群成员（实时查询官方 API）。
2. **实时消息捕获**：`dtconn capture` 以 Stream 模式长连接接收机器人所在单聊/群聊的消息，
   逐条落盘到 JSONL 文件；`im_list_captured_messages` / `conn.messages.listCapturedMessages()`
   支持按会话、发送人、关键词、时间范围过滤查询。

即：从开启捕获起的消息都可读，历史消息需在钉钉客户端内查看。

## 验证

```bash
pnpm test                                      # 42 个单元/集成用例（本地 mock 钉钉服务）
node scripts/mcp-smoke.mjs                     # 编译产物 MCP stdio 冒烟（initialize → tools/list）
node --experimental-strip-types scripts/e2e-cli.ts   # 编译产物 CLI 全域端到端（mock 服务）
```

- `tests/mock/server.ts` 完整模拟双域名（含鉴权头/参数校验、分页、分片、错误码），
  因此测试不需要真实凭证，也不会命中线上服务。
- `scripts/e2e-cli.ts` 逐域调用编译后的 CLI 并断言输出（12 项检查全部通过）。

## 错误排查

| 现象 | 原因与处理 |
|---|---|
| `errcode 60011` / `invalidAuthentication` | accessToken 无效：检查 AppKey/AppSecret |
| `errcode 60020` / `访问被拒绝` | 权限点未申请或未生效：到开发者后台「权限管理」申请对应读权限 |
| `ip not in whitelist` | 开发者后台开启了 IP 白名单，将本机出口 IP 加入 |
| 日历/待办返回空 | 传入的 unionId 与 accessToken 所属企业不匹配 |
| 审批实例查询报时间非法 | `startTime` 距今不能超过 120 天（OA 高级版 5 年） |
| capture 连不上 | 应用未开通「机器人-Stream 模式」或未发布 |

## 目录结构

```
src/
  config.ts        凭证/域名/超时等配置（env 加载）
  token.ts         企业 accessToken 获取与缓存
  http.ts          双域名 HTTP 封装（鉴权/重试/错误映射）
  connector.ts     DingTalkConnector 装配入口
  modules/         八个领域模块（calendar/todo/approval/attendance/report/docs/messages/contacts）
  capture.ts       Stream 消息捕获 + JSONL 存取
  tools.ts         33 个只读工具注册表（MCP 与 CLI 共用）+ 参数校验
  mcp/server.ts    MCP stdio server
  cli.ts           dtconn CLI
tests/             mock 钉钉服务器 + client/modules/mcp/capture 测试
scripts/           mcp-smoke.mjs / e2e-cli.ts 验证脚本
```
