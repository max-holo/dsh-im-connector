// 端到端验证（不需要真实钉钉凭证）：
// 启动本地 mock 钉钉服务器，然后用编译后的 CLI 调用各域工具，校验输出。
// 用法：先 pnpm build，然后 node --experimental-strip-types scripts/e2e-cli.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startMockServer } from "../tests/mock/server.ts";

const run = promisify(execFile);

function check(name, condition, detail) {
  if (!condition) {
    console.error(`FAIL: ${name} ${detail ?? ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const mock = await startMockServer();
const base = ["--app-key", "e2e-key", "--app-secret", "e2e-secret", "--api-base", mock.url, "--oapi-base", mock.url];

async function call(tool, args) {
  const { stdout } = await run(process.execPath, [
    "dist/cli.js",
    "call",
    tool,
    JSON.stringify(args),
    ...base,
  ]);
  return JSON.parse(stdout);
}

// 日历
const cal = await call("calendar_list_events", {
  unionId: "union-1",
  timeMin: "2026-10-01T00:00:00Z",
  timeMax: "2026-10-08T00:00:00Z",
});
check("calendar_list_events", cal.events?.length === 2, JSON.stringify(cal).slice(0, 200));

// 通讯录 + 待办
const user = await call("contact_get_user", { userid: "u1" });
check("contact_get_user", user.unionid === "union-u1");
const todos = await call("todo_list_tasks", { unionId: "union-1", isDone: false });
check("todo_list_tasks", todos.tasks?.length === 2);

// 审批
const forms = await call("approval_list_forms", { userid: "u1" });
check("approval_list_forms", forms.forms?.length === 1);
const ids = await call("approval_list_instance_ids", {
  processCode: "PROC-1",
  startTime: "2026-07-01T00:00:00Z",
});
check("approval_list_instance_ids", ids.instanceIds?.length === 3);
const inst = await call("approval_get_instance", { processInstanceId: "id-1" });
check("approval_get_instance", inst.title === "张三的请假申请");

// 考勤
const punch = await call("attendance_list_punch_results", {
  userIds: ["u1", "u2"],
  dateFrom: "2026-10-01",
  dateTo: "2026-10-03",
});
check("attendance_list_punch_results", punch.records?.length === 1);

// 日志
const reports = await call("report_list", { startTime: "2026-10-01", endTime: "2026-10-14" });
check("report_list", reports.reports?.length === 2);

// 文档
const spaces = await call("docs_list_spaces", { unionId: "union-1" });
check("docs_list_spaces", spaces.spaces?.length === 1);
const wiki = await call("wiki_list_nodes", { parentNodeId: "root1", unionId: "union-1" });
check("wiki_list_nodes", wiki.nodes?.length === 1);
const blocks = await call("docs_get_blocks", { docKey: "doc-1", unionId: "union-1" });
check("docs_get_blocks", blocks.length === 1);

// 消息
const convs = await call("im_list_conversations", {});
check("im_list_conversations", convs.conversations?.length === 1);

await mock.close();
console.log("CLI end-to-end verification OK (all domains)");
process.exit(0);
