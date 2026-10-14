import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DingTalkConnector } from "../src/index.js";

const FAKE = fileURLToPath(new URL("./fake-dws.mjs", import.meta.url));

function conn() {
  return new DingTalkConnector({ dwsBin: FAKE, timeoutSec: 30 });
}

function lastArgs(data: unknown): string[] {
  return ((data as { data: { args: string[] } }).data.args as string[]) ?? [];
}

describe("dws-backed modules map to correct commands", () => {
  beforeAll(() => {});

  it("contacts", async () => {
    const c = conn();
    expect(lastArgs(await c.contacts.me())).toEqual(["contact", "+me", "--format", "json"]);
    expect(lastArgs(await c.contacts.searchUser("张三"))).toEqual([
      "contact",
      "+search-user",
      "--query",
      "张三",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.contacts.listDepartmentMembers("技术部"))).toEqual([
      "contact",
      "+dept-members",
      "--dept",
      "技术部",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.contacts.listSubDepartments(1))).toEqual([
      "contact",
      "+list-sub-depts",
      "--dept",
      "1",
      "--format",
      "json",
    ]);
  });

  it("calendar", async () => {
    const c = conn();
    expect(lastArgs(await c.calendar.today())).toEqual(["calendar", "+today", "--format", "json"]);
    expect(lastArgs(await c.calendar.week())).toEqual(["calendar", "+week", "--format", "json"]);
    expect(
      lastArgs(await c.calendar.agenda({ start: "2026-10-01T00:00:00+08:00", end: "2026-10-07T00:00:00+08:00", limit: 50 })),
    ).toEqual([
      "calendar",
      "+agenda",
      "--start",
      "2026-10-01T00:00:00+08:00",
      "--end",
      "2026-10-07T00:00:00+08:00",
      "--limit",
      "50",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.calendar.getEvent("evt-1"))).toEqual([
      "calendar",
      "+get",
      "--event",
      "evt-1",
      "--format",
      "json",
    ]);
    expect(
      lastArgs(await c.calendar.freeBusy({ start: "2026-10-01T00:00:00+08:00", end: "2026-10-01T18:00:00+08:00", users: ["u1", "u2"] })),
    ).toEqual([
      "calendar",
      "+freebusy",
      "--start",
      "2026-10-01T00:00:00+08:00",
      "--end",
      "2026-10-01T18:00:00+08:00",
      "--users",
      "u1,u2",
      "--format",
      "json",
    ]);
  });

  it("todo", async () => {
    const c = conn();
    expect(lastArgs(await c.todo.listMyTasks())).toEqual(["todo", "+get-my-tasks", "--format", "json"]);
    expect(lastArgs(await c.todo.get("t1"))).toEqual(["todo", "+get", "--task-id", "t1", "--format", "json"]);
    expect(lastArgs(await c.todo.search("补卡", { status: "false" }))).toEqual([
      "todo",
      "+search",
      "--query",
      "补卡",
      "--status",
      "false",
      "--format",
      "json",
    ]);
  });

  it("approval", async () => {
    const c = conn();
    expect(lastArgs(await c.approval.listPending())).toEqual([
      "oa",
      "approval",
      "list-pending",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.approval.getInstance("inst-1"))).toEqual([
      "oa",
      "approval",
      "detail",
      "--instance-id",
      "inst-1",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.approval.getRecords("inst-1"))).toEqual([
      "oa",
      "approval",
      "records",
      "--instance-id",
      "inst-1",
      "--format",
      "json",
    ]);
  });

  it("attendance", async () => {
    const c = conn();
    expect(lastArgs(await c.attendance.today())).toEqual([
      "attendance",
      "+my-attendance",
      "--format",
      "json",
    ]);
    expect(
      lastArgs(await c.attendance.checkResult({ users: ["u1", "u2"], start: "2026-10-01", end: "2026-10-10" })),
    ).toEqual([
      "attendance",
      "+check-result",
      "--users",
      "u1,u2",
      "--start",
      "2026-10-01",
      "--end",
      "2026-10-10",
      "--format",
      "json",
    ]);
    expect(
      lastArgs(await c.attendance.summary({ user: "u1", date: "2026-10-06", statsType: "week" })),
    ).toEqual([
      "attendance",
      "+get-summary",
      "--user",
      "u1",
      "--date",
      "2026-10-06",
      "--stats-type",
      "week",
      "--format",
      "json",
    ]);
  });

  it("report", async () => {
    const c = conn();
    expect(lastArgs(await c.report.inbox())).toEqual(["report", "inbox", "list", "--format", "json"]);
    expect(lastArgs(await c.report.get("r1"))).toEqual([
      "report",
      "entry",
      "get",
      "--report-id",
      "r1",
      "--format",
      "json",
    ]);
  });

  it("docs / wiki / drive", async () => {
    const c = conn();
    expect(lastArgs(await c.docs.readDoc("doc-1"))).toEqual(["doc", "read", "--node", "doc-1", "--format", "json"]);
    expect(lastArgs(await c.docs.docInfo("doc-1"))).toEqual(["doc", "info", "--node", "doc-1", "--format", "json"]);
    expect(lastArgs(await c.docs.listWikiSpaces({ type: "myWikiSpace", pageAll: true }))).toEqual([
      "wiki",
      "+space-list",
      "--type",
      "myWikiSpace",
      "--page-all",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.docs.listWikiNodes({ workspace: "w1", pageAll: true }))).toEqual([
      "wiki",
      "+node-list",
      "--workspace",
      "w1",
      "--page-all",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.docs.listDrive({ orderBy: "name", order: "asc" }))).toEqual([
      "drive",
      "+list",
      "--order-by",
      "name",
      "--order",
      "asc",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.docs.driveInfo("n1"))).toEqual(["drive", "+info", "--node", "n1", "--format", "json"]);
  });

  it("messages", async () => {
    const c = conn();
    expect(lastArgs(await c.messages.listConversations({ types: ["group", "p2p"] }))).toEqual([
      "chat",
      "+chat-list",
      "--types",
      "group,p2p",
      "--format",
      "json",
    ]);
    expect(lastArgs(await c.messages.myGroups())).toEqual(["chat", "+my-groups", "--format", "json"]);
    expect(
      lastArgs(await c.messages.chatMessages({ group: "项目群", limit: 20, pageAll: true })),
    ).toEqual([
      "chat",
      "+chat-messages",
      "--group",
      "项目群",
      "--limit",
      "20",
      "--page-all",
      "--format",
      "json",
    ]);
    expect(
      lastArgs(await c.messages.searchMessages({ query: "部署", atMe: true, pageAll: true })),
    ).toEqual([
      "chat",
      "+search-msg",
      "--query",
      "部署",
      "--at-me",
      "--page-all",
      "--format",
      "json",
    ]);
  });

  it("escape hatch run()", async () => {
    const c = conn();
    expect(lastArgs(await c.run(["some", "raw", "cmd"]))).toEqual([
      "some",
      "raw",
      "cmd",
      "--format",
      "json",
    ]);
  });
});
