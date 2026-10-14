import type { DingTalkConnector } from "./connector.js";

export type ToolParamType = "string" | "number" | "boolean" | "array" | "object";

export interface ToolParam {
  name: string;
  type: ToolParamType;
  description: string;
  required?: boolean;
  /** For type === "array": item type. */
  itemType?: "string" | "number";
  enumValues?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  params: ToolParam[];
  handler: (conn: DingTalkConnector, args: Record<string, any>) => unknown | Promise<unknown>;
}

export interface ToolJsonSchema extends Record<string, unknown> {
  type: "object";
  properties: Record<string, object>;
  required?: string[];
}

export function toolJsonSchema(tool: ToolDef): ToolJsonSchema {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const p of tool.params) {
    const prop: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.itemType) prop.items = { type: p.itemType };
    if (p.enumValues) prop.enum = p.enumValues;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

export function validateToolArgs(tool: ToolDef, args: Record<string, unknown> | undefined): string[] {
  const errors: string[] = [];
  const input = args ?? {};
  for (const k of Object.keys(input)) {
    if (!tool.params.some((p) => p.name === k)) errors.push(`Unknown parameter: ${k}`);
  }
  for (const p of tool.params) {
    const value = input[p.name];
    if (value === undefined || value === null) {
      if (p.required) errors.push(`Missing required parameter: ${p.name}`);
      continue;
    }
    const actual = Array.isArray(value) ? "array" : typeof value;
    if (actual !== p.type) {
      errors.push(`Parameter ${p.name} must be of type ${p.type} (got ${actual})`);
      continue;
    }
    if (actual === "array" && p.itemType) {
      for (const item of value as unknown[]) {
        if (typeof item !== p.itemType) {
          errors.push(`Parameter ${p.name} items must be of type ${p.itemType}`);
          break;
        }
        if (p.enumValues && typeof item === "string" && !p.enumValues.includes(item)) {
          errors.push(`Parameter ${p.name} items must be one of: ${p.enumValues.join(", ")}`);
          break;
        }
      }
    }
    if (actual === "string" && p.enumValues && !p.enumValues.includes(value as string)) {
      errors.push(`Parameter ${p.name} must be one of: ${p.enumValues.join(", ")}`);
    }
  }
  return errors;
}

const ROLE = ["executor", "creator", "participant"];

/**
 * 只读工具注册表：MCP server 与 CLI 共用。
 * 每个工具对应一条 dws 命令，返回该命令解析后的 JSON payload（透传，保留完整性信号）。
 */
export const toolList: ToolDef[] = [
  // ---------------- 通讯录 ----------------
  {
    name: "contact_me",
    description: "查看我自己的通讯录资料（姓名/userId/手机/部门/组织）。对应 dws contact +me。",
    params: [],
    handler: (conn) => conn.contacts.me(),
  },
  {
    name: "contact_search_user",
    description: "按姓名/拼音搜索通讯录用户，返回 userId 等基础信息。对应 dws contact +search-user。",
    params: [{ name: "query", type: "string", required: true, description: "搜索关键词（姓名、拼音或花名）" }],
    handler: (conn, args) => conn.contacts.searchUser(args.query),
  },
  {
    name: "contact_department_members",
    description: "按部门名列出部门直接成员（仅本部门）。对应 dws contact +dept-members。",
    params: [{ name: "dept", type: "string", required: true, description: "部门名称或关键词" }],
    handler: (conn, args) => conn.contacts.listDepartmentMembers(args.dept),
  },
  {
    name: "contact_list_sub_departments",
    description: "查看指定部门的直属子部门（根部门为 1）。对应 dws contact +list-sub-depts。",
    params: [{ name: "deptParentId", type: "number", required: true, description: "父部门 ID（根部门为 1）" }],
    handler: (conn, args) => conn.contacts.listSubDepartments(args.deptParentId),
  },

  // ---------------- 日历 ----------------
  {
    name: "calendar_today",
    description: "列出我今天的日程。对应 dws calendar +today。",
    params: [],
    handler: (conn) => conn.calendar.today(),
  },
  {
    name: "calendar_tomorrow",
    description: "列出我明天的日程。对应 dws calendar +tomorrow。",
    params: [],
    handler: (conn) => conn.calendar.tomorrow(),
  },
  {
    name: "calendar_week",
    description: "列出我本周的日程。对应 dws calendar +week。",
    params: [],
    handler: (conn) => conn.calendar.week(),
  },
  {
    name: "calendar_agenda",
    description: "按时间范围查询日程列表（ISO-8601 时间）。对应 dws calendar +agenda。",
    params: [
      { name: "start", type: "string", description: "开始时间 ISO-8601，默认今天 00:00" },
      { name: "end", type: "string", description: "结束时间 ISO-8601，默认今天 23:59" },
      { name: "calendarId", type: "string", description: "日历 ID，默认 primary" },
      { name: "limit", type: "number", description: "每页条数 1-100" },
    ],
    handler: (conn, args) =>
      conn.calendar.agenda({
        start: args.start,
        end: args.end,
        calendarId: args.calendarId,
        limit: args.limit,
      }),
  },
  {
    name: "calendar_get_event",
    description: "查询单个日程详情。对应 dws calendar +get。",
    params: [
      { name: "eventId", type: "string", required: true, description: "日程 eventId" },
      { name: "calendarId", type: "string", description: "日历 ID，默认 primary" },
    ],
    handler: (conn, args) => conn.calendar.getEvent(args.eventId, { calendarId: args.calendarId }),
  },
  {
    name: "calendar_freebusy",
    description: "查询用户/会议室在某时间段的忙闲状态。对应 dws calendar +freebusy。",
    params: [
      { name: "start", type: "string", required: true, description: "开始时间 ISO-8601" },
      { name: "end", type: "string", required: true, description: "结束时间 ISO-8601" },
      { name: "users", type: "array", itemType: "string", description: "用户 userId 列表（逗号分隔）" },
      { name: "rooms", type: "array", itemType: "string", description: "会议室 roomId 列表" },
    ],
    handler: (conn, args) =>
      conn.calendar.freeBusy({ start: args.start, end: args.end, users: args.users, rooms: args.rooms }),
  },
  {
    name: "calendar_list_books",
    description: "查询用户可见的日历本列表。对应 dws calendar +book-list。",
    params: [],
    handler: (conn) => conn.calendar.listBooks(),
  },

  // ---------------- 待办 ----------------
  {
    name: "todo_list_my_tasks",
    description: "查询当前组织下我的待办列表。对应 dws todo +get-my-tasks。",
    params: [],
    handler: (conn) => conn.todo.listMyTasks(),
  },
  {
    name: "todo_list_related_tasks",
    description: "列出与我相关的全部待办（创建/执行/参与三角色并集）。对应 dws todo +get-related-tasks。",
    params: [],
    handler: (conn) => conn.todo.listRelatedTasks(),
  },
  {
    name: "todo_list_created",
    description: "列出我创建的待办。对应 dws todo +created-todos。",
    params: [],
    handler: (conn) => conn.todo.listCreated(),
  },
  {
    name: "todo_due_today",
    description: "列出我今天到期的待办。对应 dws todo +due-today。",
    params: [],
    handler: (conn) => conn.todo.dueToday(),
  },
  {
    name: "todo_overdue",
    description: "列出我已过期未完成的待办。对应 dws todo +overdue。",
    params: [],
    handler: (conn) => conn.todo.overdue(),
  },
  {
    name: "todo_get",
    description: "查询单个待办详情。对应 dws todo +get。",
    params: [{ name: "taskId", type: "string", required: true, description: "待办任务 ID" }],
    handler: (conn, args) => conn.todo.get(args.taskId),
  },
  {
    name: "todo_search",
    description: "按标题关键词搜索与我相关的待办。对应 dws todo +search。",
    params: [
      { name: "query", type: "string", required: true, description: "标题关键词" },
      { name: "status", type: "string", enumValues: ["true", "false"], description: "完成状态过滤" },
    ],
    handler: (conn, args) => conn.todo.search(args.query, { status: args.status }),
  },

  // ---------------- 审批 ----------------
  {
    name: "approval_list_pending",
    description: "查询待我处理的审批。对应 dws oa approval list-pending。",
    params: [],
    handler: (conn) => conn.approval.listPending(),
  },
  {
    name: "approval_list_executed",
    description: "查询我处理过的审批。对应 dws oa approval list-executed。",
    params: [],
    handler: (conn) => conn.approval.listExecuted(),
  },
  {
    name: "approval_list_cc",
    description: "查询抄送我的审批单。对应 dws oa approval list-cc。",
    params: [],
    handler: (conn) => conn.approval.listCc(),
  },
  {
    name: "approval_list_submitted",
    description: "查询我发起的审批单。对应 dws oa approval list-submitted。",
    params: [],
    handler: (conn) => conn.approval.listSubmitted(),
  },
  {
    name: "approval_list_forms",
    description: "查询我可见的审批表单（模板）列表。对应 dws oa approval list-forms。",
    params: [],
    handler: (conn) => conn.approval.listForms(),
  },
  {
    name: "approval_search_forms",
    description: "按关键字搜索我可见的审批表单。对应 dws oa approval search-forms。",
    params: [{ name: "keyword", type: "string", required: true, description: "搜索关键字" }],
    handler: (conn, args) => conn.approval.searchForms(args.keyword),
  },
  {
    name: "approval_get_instance",
    description: "获取审批实例详情（表单内容与状态）。对应 dws oa approval detail。",
    params: [{ name: "instanceId", type: "string", required: true, description: "审批实例 ID" }],
    handler: (conn, args) => conn.approval.getInstance(args.instanceId),
  },
  {
    name: "approval_get_records",
    description: "获取审批操作记录。对应 dws oa approval records。",
    params: [{ name: "instanceId", type: "string", required: true, description: "审批实例 ID" }],
    handler: (conn, args) => conn.approval.getRecords(args.instanceId),
  },

  // ---------------- 考勤 ----------------
  {
    name: "attendance_my_today",
    description: "查我今天的考勤打卡记录。对应 dws attendance +my-attendance。",
    params: [],
    handler: (conn) => conn.attendance.today(),
  },
  {
    name: "attendance_my_month",
    description: "查我本月的考勤打卡记录。对应 dws attendance +this-month。",
    params: [],
    handler: (conn) => conn.attendance.thisMonth(),
  },
  {
    name: "attendance_check_result",
    description:
      "批量查询打卡结果（正常/迟到/早退/缺卡）。users 最多 100 人，区间 ≤ 1 个月，日期 YYYY-MM-DD。对应 dws attendance +check-result。",
    params: [
      { name: "users", type: "array", itemType: "string", required: true, description: "用户 userId 列表（逗号分隔，≤100）" },
      { name: "start", type: "string", required: true, description: "开始日期 YYYY-MM-DD" },
      { name: "end", type: "string", required: true, description: "结束日期 YYYY-MM-DD" },
      { name: "limit", type: "number", description: "每页条数，默认 100" },
      { name: "offset", type: "number", description: "偏移量，默认 0" },
    ],
    handler: (conn, args) =>
      conn.attendance.checkResult({
        users: args.users,
        start: args.start,
        end: args.end,
        limit: args.limit,
        offset: args.offset,
      }),
  },
  {
    name: "attendance_summary",
    description: "查询某人的考勤统计摘要（周/月）。对应 dws attendance +get-summary。",
    params: [
      { name: "user", type: "string", required: true, description: "钉钉用户 userId" },
      { name: "date", type: "string", required: true, description: "周期内任意日期 YYYY-MM-DD" },
      { name: "statsType", type: "string", required: true, enumValues: ["week", "month"], description: "统计类型 week/month" },
    ],
    handler: (conn, args) =>
      conn.attendance.summary({ user: args.user, date: args.date, statsType: args.statsType }),
  },

  // ---------------- 日志 ----------------
  {
    name: "report_inbox",
    description: "列出我收到的日志（日报/周报）。对应 dws report inbox list。",
    params: [],
    handler: (conn) => conn.report.inbox(),
  },
  {
    name: "report_outbox",
    description: "列出我发出的日志。对应 dws report outbox list。",
    params: [],
    handler: (conn) => conn.report.outbox(),
  },
  {
    name: "report_get",
    description: "读取单份日志正文。对应 dws report entry get。",
    params: [{ name: "reportId", type: "string", required: true, description: "日志 ID" }],
    handler: (conn, args) => conn.report.get(args.reportId),
  },
  {
    name: "report_templates",
    description: "获取可用日志模板列表。对应 dws report template list。",
    params: [],
    handler: (conn) => conn.report.templates(),
  },

  // ---------------- 文档 / 知识库 / 钉盘 ----------------
  {
    name: "doc_read",
    description: "读取在线文档正文（Markdown）。node 可为文档 ID 或 alidocs URL。对应 dws doc read。",
    params: [
      { name: "node", type: "string", required: true, description: "文档 ID 或 URL" },
      { name: "version", type: "number", description: "读取指定历史版本号（0=初始版本）" },
    ],
    handler: (conn, args) => conn.docs.readDoc(args.node, { version: args.version }),
  },
  {
    name: "doc_info",
    description: "获取文档元信息（标题/类型/创建者/权限）。对应 dws doc info。",
    params: [{ name: "node", type: "string", required: true, description: "文档 ID 或 URL" }],
    handler: (conn, args) => conn.docs.docInfo(args.node),
  },
  {
    name: "doc_list",
    description: "列出文档文件夹/知识库下的直接子节点。对应 dws doc +list。",
    params: [
      { name: "folder", type: "string", description: "文档文件夹 nodeId 或 URL" },
      { name: "workspace", type: "string", description: "知识库 ID" },
      { name: "limit", type: "number", description: "每页数量（≤50）" },
      { name: "pageAll", type: "boolean", description: "有界读取全部后续页" },
    ],
    handler: (conn, args) =>
      conn.docs.listDocChildren({ folder: args.folder, workspace: args.workspace, limit: args.limit, pageAll: args.pageAll }),
  },
  {
    name: "doc_find",
    description: "按关键词搜索云文档。对应 dws doc +find-doc。",
    params: [
      { name: "query", type: "string", required: true, description: "搜索关键词" },
      { name: "limit", type: "number", description: "返回条数限制" },
    ],
    handler: (conn, args) => conn.docs.findDoc(args.query, { limit: args.limit }),
  },
  {
    name: "wiki_space_list",
    description: "浏览知识库列表。对应 dws wiki +space-list。",
    params: [
      { name: "type", type: "string", enumValues: ["orgWikiSpace", "myWikiSpace"], description: "知识库类型，默认 orgWikiSpace" },
      { name: "pageAll", type: "boolean", description: "自动取完所有页" },
    ],
    handler: (conn, args) => conn.docs.listWikiSpaces({ type: args.type, pageAll: args.pageAll }),
  },
  {
    name: "wiki_node_list",
    description: "浏览知识库节点列表。对应 dws wiki +node-list。",
    params: [
      { name: "workspace", type: "string", required: true, description: "知识库 ID" },
      { name: "folder", type: "string", description: "父节点 ID" },
      { name: "limit", type: "number", description: "每页数量（≤50）" },
      { name: "pageAll", type: "boolean", description: "自动取完所有页" },
    ],
    handler: (conn, args) =>
      conn.docs.listWikiNodes({ workspace: args.workspace, folder: args.folder, limit: args.limit, pageAll: args.pageAll }),
  },
  {
    name: "drive_list",
    description: "浏览钉盘文件/文件夹。对应 dws drive +list。",
    params: [
      { name: "spaceId", type: "string", description: "钉盘空间 ID（纯数字）" },
      { name: "folder", type: "string", description: "父节点 dentryUuid，不传列根目录" },
      { name: "limit", type: "number", description: "每页数量（≤50）" },
      { name: "orderBy", type: "string", enumValues: ["createTime", "modifyTime", "name"], description: "排序字段" },
      { name: "order", type: "string", enumValues: ["asc", "desc"], description: "排序方向" },
      { name: "pageAll", type: "boolean", description: "有界读取全部后续页" },
    ],
    handler: (conn, args) =>
      conn.docs.listDrive({
        spaceId: args.spaceId,
        folder: args.folder,
        limit: args.limit,
        orderBy: args.orderBy,
        order: args.order,
        pageAll: args.pageAll,
      }),
  },
  {
    name: "drive_info",
    description: "获取钉盘节点元数据。对应 dws drive +info。",
    params: [
      { name: "node", type: "string", required: true, description: "节点 dentryUuid" },
      { name: "spaceId", type: "string", description: "节点所属空间 ID" },
    ],
    handler: (conn, args) => conn.docs.driveInfo(args.node, { spaceId: args.spaceId }),
  },
  {
    name: "drive_recent",
    description: "获取最近访问/编辑的文档列表。对应 dws drive +recent。",
    params: [],
    handler: (conn) => conn.docs.driveRecent(),
  },

  // ---------------- 消息 ----------------
  {
    name: "im_list_conversations",
    description: "列出当前用户加入的会话（默认群聊，可含单聊）。对应 dws chat +chat-list。",
    params: [
      { name: "types", type: "array", itemType: "string", enumValues: ["group", "p2p"], description: "会话类型 group/p2p" },
      { name: "pageAll", type: "boolean", description: "自动读取全部会话分页" },
    ],
    handler: (conn, args) => conn.messages.listConversations({ types: args.types, pageAll: args.pageAll }),
  },
  {
    name: "im_my_groups",
    description: "列出我加入的群。对应 dws chat +my-groups。",
    params: [],
    handler: (conn) => conn.messages.myGroups(),
  },
  {
    name: "im_unread_chats",
    description: "列出我有未读消息的会话。对应 dws chat +unread-chats。",
    params: [],
    handler: (conn) => conn.messages.unreadChats(),
  },
  {
    name: "im_chat_messages",
    description: "读取指定群聊/单聊的消息记录（历史消息）。对应 dws chat +chat-messages。",
    params: [
      { name: "group", type: "string", description: "群名或 openConversationId" },
      { name: "user", type: "string", description: "单聊对方 userId" },
      { name: "start", type: "string", description: "范围开始时间（含，RFC3339 或 YYYY-MM-DD HH:mm:ss）" },
      { name: "end", type: "string", description: "范围结束时间（不含）" },
      { name: "order", type: "string", enumValues: ["asc", "desc"], description: "遍历顺序" },
      { name: "limit", type: "number", description: "每页条数" },
      { name: "pageAll", type: "boolean", description: "自动读取全部页" },
    ],
    handler: (conn, args) =>
      conn.messages.chatMessages({
        group: args.group,
        user: args.user,
        start: args.start,
        end: args.end,
        order: args.order,
        limit: args.limit,
        pageAll: args.pageAll,
      }),
  },
  {
    name: "im_search_messages",
    description: "按发送者/关键词/@对象/时间等条件搜索消息。对应 dws chat +search-msg。",
    params: [
      { name: "query", type: "string", description: "搜索关键词" },
      { name: "group", type: "string", description: "群名或 openConversationId" },
      { name: "senders", type: "array", itemType: "string", description: "发送者姓名/userId 列表" },
      { name: "atMe", type: "boolean", description: "只搜 @我 的消息" },
      { name: "days", type: "number", description: "回溯天数，默认 7" },
      { name: "pageAll", type: "boolean", description: "自动连续拉取所有页" },
    ],
    handler: (conn, args) =>
      conn.messages.searchMessages({
        query: args.query,
        group: args.group,
        senders: args.senders,
        atMe: args.atMe,
        days: args.days,
        pageAll: args.pageAll,
      }),
  },
];

export function findTool(name: string): ToolDef | undefined {
  return toolList.find((t) => t.name === name);
}

export async function invokeTool(
  conn: DingTalkConnector,
  tool: ToolDef,
  args: Record<string, unknown>,
): Promise<unknown> {
  const errors = validateToolArgs(tool, args);
  if (errors.length > 0) {
    throw new Error(`Invalid arguments for tool ${tool.name}: ${errors.join("; ")}`);
  }
  return tool.handler(conn, args);
}
