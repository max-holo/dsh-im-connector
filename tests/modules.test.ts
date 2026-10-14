import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServer } from "./mock/server.js";
import { DingTalkConnector } from "../src/index.js";

function calls(mock: MockServer, path: string, method?: string) {
  return mock.requests.filter(
    (r) => r.path === path && (method === undefined || r.method === method),
  );
}

describe("modules against the mock DingTalk server", () => {
  let mock: MockServer;
  let conn: DingTalkConnector;
  let captureDir: string;

  beforeAll(async () => {
    mock = await startMockServer();
    captureDir = mkdtempSync(join(tmpdir(), "dtconn-test-"));
    conn = new DingTalkConnector({
      appKey: "test-key",
      appSecret: "test-secret",
      apiBase: mock.url,
      oapiBase: mock.url,
      retryBaseDelayMs: 5,
      captureFile: join(captureDir, "capture.jsonl"),
    });
  });

  afterAll(async () => {
    await mock.close();
    rmSync(captureDir, { recursive: true, force: true });
  });

  // ---------------- 日历 ----------------
  it("calendar.listEvents passes time range and follows pagination", async () => {
    const page = await conn.calendar.listEvents(
      "union-1",
      "2026-10-01T00:00:00+08:00",
      "2026-10-08T00:00:00+08:00",
    );
    expect(page.items.map((e) => (e as { id: string }).id)).toEqual(["e1"]);
    expect(page.nextToken).toBe("page2");
    const call = calls(mock, "/v1.0/calendar/users/union-1/calendars/primary/eventsview").at(-1)!;
    expect(call.query.get("timeMin")).toBe("2026-09-30T16:00:00.000Z"); // converted to UTC ISO
    expect(call.query.get("timeMax")).toBe("2026-10-07T16:00:00.000Z");
    expect(call.query.get("maxResults")).toBe("50");
  });

  it("calendar.collectEvents merges pages", async () => {
    const { events } = await conn.calendar.collectEvents(
      "union-1",
      "2026-10-01T00:00:00Z",
      "2026-10-08T00:00:00Z",
    );
    expect(events.map((e) => (e as { id: string }).id)).toEqual(["e1", "e2"]);
  });

  it("calendar.getEvent and attendees", async () => {
    const event = (await conn.calendar.getEvent("union-1", "evt-9")) as { id: string; summary: string };
    expect(event.id).toBe("evt-9");
    const { items } = await conn.calendar.listEventAttendees("union-1", "evt-9");
    expect(items.length).toBe(1);
  });

  // ---------------- 待办 ----------------
  it("todo.collectTasks merges pages and passes filters", async () => {
    const { tasks } = await conn.todo.collectTasks("union-1", {
      isDone: false,
      roleTypes: [["executor"]],
    });
    expect(tasks.map((t) => (t as { taskId: string }).taskId)).toEqual(["t1", "t2"]);
    const call = calls(mock, "/v1.0/todo/users/union-1/org/tasks/query").at(-1)!;
    expect(call.body).toMatchObject({ isDone: false, roleTypes: [["executor"]] });
  });

  it("todo.getTask returns the task", async () => {
    const task = (await conn.todo.getTask("union-1", "t1")) as { subject: string };
    expect(task.subject).toBe("写周报");
  });

  // ---------------- 审批 ----------------
  it("approval.listVisibleForms unwraps process_list", async () => {
    const { forms } = await conn.approval.listVisibleForms("u1");
    expect(forms.length).toBe(1);
    expect((forms[0] as { process_code: string }).process_code).toBe("PROC-1");
  });

  it("approval.listInstanceIds follows nextToken paging", async () => {
    const { instanceIds } = await conn.approval.listInstanceIds("PROC-1", "2026-07-01T00:00:00Z");
    expect(instanceIds).toEqual(["id-1", "id-2", "id-3"]);
    const first = calls(mock, "/v1.0/workflow/processes/instanceIds/query")[0];
    expect(first.body).toMatchObject({ processCode: "PROC-1", nextToken: 0, maxResults: 20 });
    const second = calls(mock, "/v1.0/workflow/processes/instanceIds/query")[1];
    expect(second.body).toMatchObject({ nextToken: 2 });
  });

  it("approval.getInstance unwraps result", async () => {
    const instance = (await conn.approval.getInstance("id-1")) as {
      title: string;
      status: string;
    };
    expect(instance.title).toBe("张三的请假申请");
    expect(instance.status).toBe("RUNNING");
  });

  it("approval.getTodoCount returns result", async () => {
    const count = (await conn.approval.getTodoCount("u1")) as Array<{ count: number }>;
    expect(count[0].count).toBe(3);
  });

  // ---------------- 考勤 ----------------
  it("attendance.listPunchResults chunks users (50) and windows (7 days)", async () => {
    const userIds = Array.from({ length: 60 }, (_, i) => `u${i}`);
    const { records } = await conn.attendance.listPunchResults(
      userIds,
      "2026-10-01T00:00:00+08:00",
      "2026-10-10T00:00:00+08:00", // 9 days -> 2 windows
    );
    const listCalls = calls(mock, "/attendance/list");
    expect(listCalls.length).toBe(4); // 2 user chunks × 2 windows
    expect(records.length).toBe(4);
    expect(listCalls[0].body.workDateFrom).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(listCalls[0].body.userIds.length).toBe(50);
    expect(listCalls[1].body.userIds.length).toBe(10);
  });

  it("attendance.listPunchDetails chunks and formats dates", async () => {
    const { records } = await conn.attendance.listPunchDetails(
      ["u1"],
      "2026-10-01T00:00:00+08:00",
      "2026-10-03T00:00:00+08:00",
    );
    const call = calls(mock, "/attendance/listRecord").at(-1)!;
    expect(call.body.checkDateFrom).toBe("2026-10-01 00:00:00");
    expect(records.length).toBe(1);
  });

  it("attendance.listCheckinRecords sends epoch millis", async () => {
    const records = await conn.attendance.listCheckinRecords(1, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
    const call = calls(mock, "/checkin/record").at(-1)!;
    expect(call.query.get("start_time")).toBe(String(Date.parse("2026-10-01T00:00:00Z")));
    expect(records.length).toBe(1);
  });

  it("attendance.listUserCheckinRecords joins user list", async () => {
    const records = await conn.attendance.listUserCheckinRecords(
      ["u1", "u2"],
      "2026-10-01T00:00:00Z",
      "2026-10-01T23:59:59Z",
    );
    const call = calls(mock, "/topapi/checkin/record/get").at(-1)!;
    expect(call.body.userid_list).toBe("u1,u2");
    expect(records.length).toBe(1);
  });

  // ---------------- 日志 ----------------
  it("report.listReports follows next_cursor paging", async () => {
    const { reports } = await conn.report.listReports("2026-10-01", "2026-10-14");
    expect(reports.map((r) => (r as { report_code: string }).report_code)).toEqual(["r1", "r2"]);
    const listCalls = calls(mock, "/topapi/report/list");
    expect(listCalls.length).toBe(2);
    expect(listCalls[0].body.cursor).toBe(0);
    expect(listCalls[1].body.cursor).toBe(20);
  });

  it("report templates", async () => {
    const templates = await conn.report.listTemplates("u1");
    expect(templates.length).toBe(1);
    const detail = (await conn.report.getTemplateByName("日报", "u1")) as { name: string };
    expect(detail.name).toBe("日报");
  });

  // ---------------- 文档 ----------------
  it("docs.listSpaces / listFiles", async () => {
    const { spaces } = await conn.docs.listSpaces("union-1");
    expect(spaces.length).toBe(1);
    const { files } = await conn.docs.listFiles("sp1", "union-1", { parentId: "root" });
    expect(files.length).toBe(1);
    const call = calls(mock, "/v1.0/drive/spaces/sp1/files").at(-1)!;
    expect(call.query.get("parentId")).toBe("root");
  });

  it("docs wiki workspaces and nodes", async () => {
    const { workspaces } = await conn.docs.listWikiWorkspaces("union-1");
    expect(workspaces.length).toBe(1);
    const call = calls(mock, "/v2.0/wiki/workspaces").at(-1)!;
    expect(call.query.get("operatorId")).toBe("union-1");
    const { nodes } = await conn.docs.listWikiNodes("root1", "union-1");
    expect(nodes.length).toBe(1);
  });

  it("docs.getDocBlocks unwraps result.data", async () => {
    const blocks = await conn.docs.getDocBlocks("doc-1", "union-1");
    expect(blocks.length).toBe(1);
    expect((blocks[0] as { paragraph: { text: string } }).paragraph.text).toBe("文档第一段");
  });

  // ---------------- 消息 ----------------
  it("messages conversations and members", async () => {
    const { conversations } = await conn.messages.listConversations();
    expect(conversations.length).toBe(1);
    const conv = (await conn.messages.getConversation("cid-1")) as { title: string };
    expect(conv.title).toBe("测试群");
    const { members } = await conn.messages.listSceneGroupMembers("cid-1");
    expect(members.length).toBe(1);
  });

  it("messages.listCapturedMessages reads and filters the local store", async () => {
    const file = join(captureDir, "capture.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({
          capturedAt: "2026-10-14T01:00:00.000Z",
          conversationType: "2",
          senderStaffId: "u1",
          content: "早上好",
        }),
        JSON.stringify({
          capturedAt: "2026-10-14T02:00:00.000Z",
          conversationType: "1",
          senderStaffId: "u2",
          content: "单独说点事",
        }),
        "not-json-line",
      ].join("\n") + "\n",
      "utf8",
    );
    const all = conn.messages.listCapturedMessages({});
    expect(all.length).toBe(2);
    const filtered = conn.messages.listCapturedMessages({ conversationType: "1", keyword: "单独" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].senderStaffId).toBe("u2");
    // newest first
    expect(all[0].capturedAt).toBe("2026-10-14T02:00:00.000Z");
  });

  // ---------------- 通讯录 ----------------
  it("contacts lookup chain", async () => {
    const user = await conn.contacts.getUser("u1");
    expect(user.unionid).toBe("union-u1");
    const unionId = await conn.contacts.getUnionId("u1");
    expect(unionId).toBe("union-u1");
    const byMobile = (await conn.contacts.getUserIdByMobile("13800000000")) as { userid: string };
    expect(byMobile.userid).toBe("u1");
    const byUnion = (await conn.contacts.getUserIdByUnionId("union-u1")) as { userid: string };
    expect(byUnion.userid).toBe("u1");
    const { userIds } = await conn.contacts.listDepartmentUserIds(1);
    expect(userIds).toEqual(["u1", "u2"]);
    const depts = await conn.contacts.listSubDepartments(1);
    expect(depts.length).toBe(1);
    const search = await conn.contacts.searchUser("张三");
    expect((search.users?.[0] as { name: string }).name).toBe("匹配:张三");
  });
});
