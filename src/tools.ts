import type { DingTalkConnector } from "./connector.js";
import type { CapturedMessageFilter } from "./capture.js";

export type ToolParamType = "string" | "number" | "boolean" | "array" | "object";

export interface ToolParam {
  name: string;
  type: ToolParamType;
  description: string;
  required?: boolean;
  /** For type === "array": the item type. */
  itemType?: "string" | "number";
  /** For type === "string": allowed values. */
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
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/** Validate args against a tool's params. Returns a list of error messages (empty = valid). */
export function validateToolArgs(tool: ToolDef, args: Record<string, unknown> | undefined): string[] {
  const errors: string[] = [];
  const input = args ?? {};
  const unknownParams = Object.keys(input).filter(
    (k) => !tool.params.some((p) => p.name === k),
  );
  for (const k of unknownParams) errors.push(`Unknown parameter: ${k}`);
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

const ROLE_TYPES = ["executor", "creator", "participant"] as const;

/**
 * 只读工具注册表：MCP server 与 CLI 共用同一份定义与处理器。
 * 所有工具均为读取操作，不产生任何写入。
 */
export const toolList: ToolDef[] = [
  // ---------------- 通讯录（ID 体系入口） ----------------
  {
    name: "contact_search_user",
    description: "按姓名/拼音搜索企业通讯录用户，返回 userId 等基础信息。",
    params: [
      { name: "queryWord", type: "string", required: true, description: "搜索关键词（姓名、拼音或英文名）" },
      { name: "size", type: "number", description: "分页大小，最大 50，默认 20" },
    ],
    handler: (conn, args) =>
      conn.contacts.searchUser(args.queryWord, { size: args.size }),
  },
  {
    name: "contact_get_user",
    description: "查询用户详情（姓名、unionId、部门、职位、手机号等）。userId → unionId 也用此工具。",
    params: [{ name: "userid", type: "string", required: true, description: "用户 userId" }],
    handler: (conn, args) => conn.contacts.getUser(args.userid),
  },
  {
    name: "contact_get_userid_by_mobile",
    description: "根据完整手机号查询用户 userId。",
    params: [{ name: "mobile", type: "string", required: true, description: "手机号" }],
    handler: (conn, args) => conn.contacts.getUserIdByMobile(args.mobile),
  },
  {
    name: "contact_get_userid_by_unionid",
    description: "根据 unionId 查询用户 userId。",
    params: [{ name: "unionid", type: "string", required: true, description: "用户 unionId" }],
    handler: (conn, args) => conn.contacts.getUserIdByUnionId(args.unionid),
  },
  {
    name: "contact_get_unionid",
    description: "根据 userId 查询用户 unionId（日历/待办/文档等工具需要 unionId）。",
    params: [{ name: "userid", type: "string", required: true, description: "用户 userId" }],
    handler: (conn, args) => conn.contacts.getUnionId(args.userid).then((unionId) => ({ unionId })),
  },
  {
    name: "contact_list_department_userids",
    description: "获取指定部门下所有成员的 userId 列表（自动翻页）。根部门 ID 为 1。",
    params: [
      { name: "deptId", type: "number", required: true, description: "部门 ID，根部门为 1" },
      { name: "maxItems", type: "number", description: "最多返回数量，默认 500" },
    ],
    handler: (conn, args) =>
      conn.contacts.listDepartmentUserIds(args.deptId, { maxItems: args.maxItems }),
  },
  {
    name: "contact_list_sub_departments",
    description: "获取指定部门的子部门列表。",
    params: [
      { name: "deptParentId", type: "number", description: "父部门 ID，默认 1（根部门）" },
    ],
    handler: (conn, args) => conn.contacts.listSubDepartments(args.deptParentId ?? 1),
  },

  // ---------------- 日历 / 日程 ----------------
  {
    name: "calendar_list_calendars",
    description: "获取用户可见的日历列表（calendarId 通常用 primary 表示主日历）。",
    params: [
      { name: "unionId", type: "string", required: true, description: "用户 unionId" },
      { name: "maxResults", type: "number", description: "分页大小，默认 100" },
      { name: "nextToken", type: "string", description: "分页游标（上一页返回）" },
    ],
    handler: (conn, args) =>
      conn.calendar.listCalendars(args.unionId, {
        maxResults: args.maxResults,
        nextToken: args.nextToken,
      }),
  },
  {
    name: "calendar_list_events",
    description:
      "按时间范围查询用户日程（自动翻页）。timeMin/timeMax 为 ISO-8601 时间，如 2026-10-01T00:00:00+08:00。",
    params: [
      { name: "unionId", type: "string", required: true, description: "用户 unionId" },
      { name: "timeMin", type: "string", required: true, description: "起始时间（ISO-8601 或 Unix 毫秒）" },
      { name: "timeMax", type: "string", required: true, description: "结束时间（ISO-8601 或 Unix 毫秒）" },
      { name: "calendarId", type: "string", description: "日历 ID，默认 primary" },
      { name: "maxItems", type: "number", description: "最多返回数量，默认 200" },
    ],
    handler: (conn, args) =>
      conn.calendar.collectEvents(args.unionId, args.timeMin, args.timeMax, {
        calendarId: args.calendarId,
        maxItems: args.maxItems,
      }),
  },
  {
    name: "calendar_get_event",
    description: "查询单个日程详情。",
    params: [
      { name: "unionId", type: "string", required: true, description: "用户 unionId" },
      { name: "eventId", type: "string", required: true, description: "日程 ID" },
      { name: "calendarId", type: "string", description: "日历 ID，默认 primary" },
    ],
    handler: (conn, args) =>
      conn.calendar.getEvent(args.unionId, args.eventId, { calendarId: args.calendarId }),
  },
  {
    name: "calendar_list_event_attendees",
    description: "获取日程参与者列表。",
    params: [
      { name: "unionId", type: "string", required: true, description: "用户 unionId" },
      { name: "eventId", type: "string", required: true, description: "日程 ID" },
      { name: "calendarId", type: "string", description: "日历 ID，默认 primary" },
      { name: "nextToken", type: "string", description: "分页游标（上一页返回）" },
    ],
    handler: (conn, args) =>
      conn.calendar.listEventAttendees(args.unionId, args.eventId, {
        calendarId: args.calendarId,
        nextToken: args.nextToken,
      }),
  },

  // ---------------- 待办 ----------------
  {
    name: "todo_list_tasks",
    description: "查询用户钉钉待办任务列表（企业维度，自动翻页）。",
    params: [
      { name: "unionId", type: "string", required: true, description: "用户 unionId" },
      { name: "isDone", type: "boolean", description: "完成状态：true 已完成，false 未完成；不传查全部" },
      {
        name: "roleTypes",
        type: "array",
        itemType: "string",
        enumValues: [...ROLE_TYPES],
        description: "角色过滤（多选，或关系）：executor 执行人 / creator 创建人 / participant 参与人",
      },
      { name: "maxItems", type: "number", description: "最多返回数量，默认 200" },
    ],
    handler: (conn, args) =>
      conn.todo.collectTasks(args.unionId, {
        isDone: args.isDone,
        roleTypes: args.roleTypes ? (args.roleTypes as string[]).map((r) => [r]) : undefined,
        maxItems: args.maxItems,
      }),
  },
  {
    name: "todo_get_task",
    description: "查询单个待办任务详情。",
    params: [
      { name: "unionId", type: "string", required: true, description: "用户 unionId" },
      { name: "taskId", type: "string", required: true, description: "待办任务 ID" },
    ],
    handler: (conn, args) => conn.todo.getTask(args.unionId, args.taskId),
  },

  // ---------------- 审批 ----------------
  {
    name: "approval_list_forms",
    description: "获取指定用户可见的审批模板列表（processCode 从结果的 process_code 字段获取）。",
    params: [
      { name: "userid", type: "string", required: true, description: "用户 userId" },
      { name: "offset", type: "number", description: "分页偏移，默认 0" },
      { name: "size", type: "number", description: "分页大小，默认 100" },
    ],
    handler: (conn, args) =>
      conn.approval.listVisibleForms(args.userid, { offset: args.offset, size: args.size }),
  },
  {
    name: "approval_list_instance_ids",
    description:
      "按审批模板 + 时间范围获取审批实例 ID 列表（自动翻页）。startTime 距今不能超过 120 天。先用 approval_list_forms 拿 processCode。",
    params: [
      { name: "processCode", type: "string", required: true, description: "审批模板唯一码" },
      { name: "startTime", type: "string", required: true, description: "起始时间（ISO-8601 或 Unix 毫秒）" },
      { name: "endTime", type: "string", description: "结束时间，默认当前时间" },
      {
        name: "statuses",
        type: "array",
        itemType: "string",
        enumValues: ["RUNNING", "TERMINATED", "COMPLETED"],
        description: "实例状态过滤：RUNNING 审批中 / TERMINATED 已撤销 / COMPLETED 已完成",
      },
      { name: "userIds", type: "array", itemType: "string", description: "发起人 userId 列表（≤10）" },
      { name: "maxItems", type: "number", description: "最多返回数量，默认 200" },
    ],
    handler: (conn, args) =>
      conn.approval.listInstanceIds(args.processCode, args.startTime, {
        endTime: args.endTime,
        userIds: args.userIds,
        statuses: args.statuses,
        maxItems: args.maxItems,
      }),
  },
  {
    name: "approval_get_instance",
    description: "获取审批实例详情（表单内容、审批任务、操作记录、附件等）。",
    params: [
      { name: "processInstanceId", type: "string", required: true, description: "审批实例 ID" },
    ],
    handler: (conn, args) => conn.approval.getInstance(args.processInstanceId),
  },
  {
    name: "approval_get_todo_count",
    description: "获取用户待审批数量。",
    params: [{ name: "userid", type: "string", required: true, description: "用户 userId" }],
    handler: (conn, args) => conn.approval.getTodoCount(args.userid),
  },

  // ---------------- 考勤 ----------------
  {
    name: "attendance_list_punch_results",
    description:
      "获取打卡结果（每人每天上下班结论：正常/迟到/早退/未打卡等）。自动按 50 人/7 天分片。dateFrom/dateTo 为 ISO-8601 或 Unix 毫秒。",
    params: [
      { name: "userIds", type: "array", itemType: "string", required: true, description: "用户 userId 列表" },
      { name: "dateFrom", type: "string", required: true, description: "查询起始工作日" },
      { name: "dateTo", type: "string", required: true, description: "查询结束工作日" },
    ],
    handler: (conn, args) =>
      conn.attendance.listPunchResults(args.userIds, args.dateFrom, args.dateTo),
  },
  {
    name: "attendance_list_punch_details",
    description:
      "获取打卡详情（每一次实际打卡记录：时间、地点、设备、是否合法等）。自动按 50 人/7 天分片。",
    params: [
      { name: "userIds", type: "array", itemType: "string", required: true, description: "用户 userId 列表" },
      { name: "dateFrom", type: "string", required: true, description: "查询起始时间" },
      { name: "dateTo", type: "string", required: true, description: "查询结束时间" },
    ],
    handler: (conn, args) =>
      conn.attendance.listPunchDetails(args.userIds, args.dateFrom, args.dateTo),
  },
  {
    name: "attendance_list_checkin_records",
    description: "获取部门用户「签到」记录（外勤签到，非考勤打卡）。时间范围 ≤ 45 天。",
    params: [
      { name: "departmentId", type: "number", required: true, description: "部门 ID，根部门为 1" },
      { name: "startTime", type: "string", required: true, description: "起始时间（ISO-8601 或 Unix 毫秒）" },
      { name: "endTime", type: "string", required: true, description: "结束时间（ISO-8601 或 Unix 毫秒）" },
    ],
    handler: (conn, args) =>
      conn.attendance.listCheckinRecords(args.departmentId, args.startTime, args.endTime),
  },
  {
    name: "attendance_list_user_checkin_records",
    description:
      "获取指定用户的「签到」记录。单人时间范围 ≤ 10 天；多人（≤10 人）≤ 1 天。",
    params: [
      { name: "userIds", type: "array", itemType: "string", required: true, description: "用户 userId 列表（≤10）" },
      { name: "startTime", type: "string", required: true, description: "起始时间（ISO-8601 或 Unix 毫秒）" },
      { name: "endTime", type: "string", required: true, description: "结束时间（ISO-8601 或 Unix 毫秒）" },
    ],
    handler: (conn, args) =>
      conn.attendance.listUserCheckinRecords(args.userIds, args.startTime, args.endTime),
  },

  // ---------------- 日志（日报/周报） ----------------
  {
    name: "report_list",
    description:
      "查询日志记录（日报/周报/月报，自动翻页）。startTime/endTime 为 ISO-8601 或 Unix 毫秒，区间 ≤ 180 天。",
    params: [
      { name: "startTime", type: "string", required: true, description: "日志创建起始时间" },
      { name: "endTime", type: "string", required: true, description: "日志创建结束时间" },
      { name: "userid", type: "string", description: "按员工 userId 过滤；不传查全企业（需权限）" },
      { name: "templateName", type: "string", description: "按模板名称过滤，如 日报/周报" },
      { name: "maxItems", type: "number", description: "最多返回数量，默认 200" },
    ],
    handler: (conn, args) =>
      conn.report.listReports(args.startTime, args.endTime, {
        userid: args.userid,
        templateName: args.templateName,
        maxItems: args.maxItems,
      }),
  },
  {
    name: "report_list_templates",
    description: "获取（用户可见的）日志模板列表。",
    params: [{ name: "userid", type: "string", description: "员工 userId；不传查全部模板" }],
    handler: (conn, args) => conn.report.listTemplates(args.userid),
  },
  {
    name: "report_get_template",
    description: "按名称获取日志模板详情（含字段定义）。",
    params: [
      { name: "templateName", type: "string", required: true, description: "模板名称，如 日报" },
      { name: "userid", type: "string", required: true, description: "有权限查看该模板的用户 userId" },
    ],
    handler: (conn, args) => conn.report.getTemplateByName(args.templateName, args.userid),
  },

  // ---------------- 文档（钉盘/知识库/文档内容） ----------------
  {
    name: "docs_list_spaces",
    description: "获取用户可访问的存储空间列表（钉盘/文档空间）。",
    params: [
      { name: "unionId", type: "string", required: true, description: "用户 unionId" },
      { name: "maxResults", type: "number", description: "分页大小，默认 100" },
      { name: "nextToken", type: "string", description: "分页游标（上一页返回）" },
    ],
    handler: (conn, args) =>
      conn.docs.listSpaces(args.unionId, { maxResults: args.maxResults, nextToken: args.nextToken }),
  },
  {
    name: "docs_list_files",
    description: "获取空间下的文件/文件夹列表（不传 parentId 时列根目录）。",
    params: [
      { name: "spaceId", type: "string", required: true, description: "空间 ID（docs_list_spaces 获取）" },
      { name: "unionId", type: "string", required: true, description: "用户 unionId" },
      { name: "parentId", type: "string", description: "父文件夹 ID；不传列根目录" },
      { name: "maxResults", type: "number", description: "分页大小，默认 100" },
      { name: "nextToken", type: "string", description: "分页游标（上一页返回）" },
    ],
    handler: (conn, args) =>
      conn.docs.listFiles(args.spaceId, args.unionId, {
        parentId: args.parentId,
        maxResults: args.maxResults,
        nextToken: args.nextToken,
      }),
  },
  {
    name: "wiki_list_workspaces",
    description: "获取知识库列表（返回 rootNodeId，用于 wiki_list_nodes 遍历节点）。",
    params: [
      { name: "unionId", type: "string", required: true, description: "操作人 unionId" },
      { name: "maxResults", type: "number", description: "分页大小，最大 30，默认 30" },
      { name: "nextToken", type: "string", description: "分页游标（上一页返回）" },
    ],
    handler: (conn, args) =>
      conn.docs.listWikiWorkspaces(args.unionId, {
        maxResults: args.maxResults,
        nextToken: args.nextToken,
      }),
  },
  {
    name: "wiki_list_nodes",
    description: "获取知识库节点列表（parentNodeId 为知识库 rootNodeId 或某节点的 nodeId/dentryUuid）。",
    params: [
      { name: "parentNodeId", type: "string", required: true, description: "父节点 ID（rootNodeId 或 nodeId）" },
      { name: "unionId", type: "string", required: true, description: "操作人 unionId" },
      { name: "maxResults", type: "number", description: "分页大小，最大 50，默认 50" },
      { name: "nextToken", type: "string", description: "分页游标（上一页返回）" },
    ],
    handler: (conn, args) =>
      conn.docs.listWikiNodes(args.parentNodeId, args.unionId, {
        maxResults: args.maxResults,
        nextToken: args.nextToken,
      }),
  },
  {
    name: "docs_get_blocks",
    description:
      "读取在线文档内容（一级块元素，含文本段落等）。docKey 可为文档 docKey 或 dentryUuid（wiki 节点的 nodeId 即 dentryUuid）。",
    params: [
      { name: "docKey", type: "string", required: true, description: "文档 docKey 或 dentryUuid" },
      { name: "unionId", type: "string", required: true, description: "操作人 unionId" },
      { name: "startIndex", type: "number", description: "起始块位置（≥0）" },
      { name: "endIndex", type: "number", description: "结束块位置（≥0）" },
      { name: "blockType", type: "string", description: "按块类型过滤，如 paragraph" },
    ],
    handler: (conn, args) =>
      conn.docs.getDocBlocks(args.docKey, args.unionId, {
        startIndex: args.startIndex,
        endIndex: args.endIndex,
        blockType: args.blockType,
      }),
  },

  // ---------------- 消息（IM） ----------------
  {
    name: "im_list_conversations",
    description: "获取应用可见的企业会话（群）列表。",
    params: [
      { name: "offset", type: "number", description: "分页偏移，默认 0" },
      { name: "size", type: "number", description: "分页大小，默认 100" },
    ],
    handler: (conn, args) => conn.messages.listConversations({ offset: args.offset, size: args.size }),
  },
  {
    name: "im_get_conversation",
    description: "查询群会话信息（标题、成员数、群主等）。",
    params: [
      { name: "openConversationId", type: "string", required: true, description: "群会话 openConversationId" },
    ],
    handler: (conn, args) => conn.messages.getConversation(args.openConversationId),
  },
  {
    name: "im_list_group_members",
    description: "查询场景群成员列表。",
    params: [
      { name: "openConversationId", type: "string", required: true, description: "群会话 openConversationId" },
      { name: "maxResults", type: "number", description: "分页大小，默认 100" },
      { name: "nextToken", type: "string", description: "分页游标（上一页返回）" },
    ],
    handler: (conn, args) =>
      conn.messages.listSceneGroupMembers(args.openConversationId, {
        maxResults: args.maxResults,
        nextToken: args.nextToken,
      }),
  },
  {
    name: "im_list_captured_messages",
    description:
      "读取 Stream 捕获的实时消息（本地存储）。需要先运行 capture 命令并开通机器人 Stream 模式。钉钉不提供任意历史消息读取。",
    params: [
      { name: "conversationId", type: "string", description: "按会话 ID 过滤" },
      { name: "conversationType", type: "string", description: "1=单聊 2=群聊" },
      { name: "senderStaffId", type: "string", description: "按发送者 userId 过滤" },
      { name: "keyword", type: "string", description: "按内容关键词过滤" },
      { name: "from", type: "string", description: "捕获时间下界（ISO-8601）" },
      { name: "to", type: "string", description: "捕获时间上界（ISO-8601）" },
      { name: "limit", type: "number", description: "最多返回条数，默认 50" },
    ],
    handler: (conn, args) => {
      const filter: CapturedMessageFilter = {
        conversationId: args.conversationId,
        conversationType: args.conversationType,
        senderStaffId: args.senderStaffId,
        keyword: args.keyword,
        from: args.from,
        to: args.to,
        limit: args.limit ?? 50,
      };
      return conn.messages.listCapturedMessages(filter);
    },
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
