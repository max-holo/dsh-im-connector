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

if (process.env.FAKE_CLI_PLAIN === "1") {
  process.stdout.write("plain text, not json");
} else {
  process.stdout.write(JSON.stringify({ ok: true, data: { args, marker: "fake-cli" } }));
}
