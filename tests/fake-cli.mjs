#!/usr/bin/env node
// 通用 fake CLI（测试用）：回显收到的 argv 到 stdout JSON，供断言命令构造；
// 可触发错误信封 / 纯文本输出。
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);

if (process.env.FAKE_CLI_LOG) {
  appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify(args) + "\n", "utf8");
}

if (process.env.FAKE_CLI_ERROR === "1") {
  process.stderr.write(
    JSON.stringify({
      error: { code: 3, category: "validation", message: "fake cli error", reason: "test_failure" },
    }),
  );
  process.exit(3);
}

if (process.env.FAKE_CLI_WECOM === "1") {
  // 模拟 wecom-cli：groups / messages 返回不同负载（results_json 包裹）
  if (args.includes("groups")) {
    process.stdout.write(
      JSON.stringify({ results_json: { data: { items: [{ chat_id: "g1", chat_name: "测试群" }] } } }),
    );
  } else if (args.includes("messages")) {
    process.stdout.write(
      JSON.stringify({
        results_json: {
          data: {
            items: [
              { msg_id: "m1", chat_id: "g1", sender_name: "张三", text: { content: "你好" } },
              { msg_id: "m2", chat_id: "g1", sender_name: "李四", text: { content: "在吗" } },
            ],
          },
        },
      }),
    );
  } else {
    process.stdout.write(JSON.stringify({ results_json: { data: { items: [] } } }));
  }
} else if (process.env.FAKE_CLI_STREAM === "1") {
  const isDirect = args.includes("all-direct");
  process.stdout.write(
    JSON.stringify({
      type: "event",
      data: {
        conversationId: isDirect ? "cid-d" : "cid-9",
        conversationType: isDirect ? "1" : "2",
        senderStaffId: "u1",
        senderNick: "张三",
        msgtype: "text",
        text: { content: isDirect ? "私聊你好" : "帮我查下日程" },
        isAtBot: !isDirect,
      },
    }) + "\n",
  );
  process.stdin.resume();
  process.on("SIGTERM", () => process.exit(0));
} else if (process.env.FAKE_CLI_PLAIN === "1") {
  process.stdout.write("plain text, not json");
} else {
  process.stdout.write(JSON.stringify({ ok: true, data: { args, marker: "fake-cli" } }));
}
