#!/usr/bin/env node
// Fake dws 二进制（测试用）：把收到的参数回显到 stdout JSON，供断言命令构造；
// 也可按 env 触发错误信封 / NDJSON 流。
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);

if (process.env.FAKE_DWS_LOG) {
  appendFileSync(process.env.FAKE_DWS_LOG, JSON.stringify(args) + "\n", "utf8");
}

if (process.env.FAKE_DWS_ERROR === "1") {
  // 错误模式：stderr 写错误信封 + 非零退出
  process.stderr.write(
    JSON.stringify({
      error: {
        code: 3,
        category: "validation",
        message: "fake dws error",
        reason: "test_failure",
        retryable: false,
      },
    }),
  );
  process.exit(3);
} else if (args.includes("ndjson") || process.env.FAKE_DWS_STREAM === "1") {
  // 流模式：runner.stream 会追加 --format ndjson
  process.stdout.write(JSON.stringify({ type: "event", data: { fake: true } }) + "\n");
  process.stdout.write(JSON.stringify({ type: "event", data: { fake: false } }) + "\n");
  process.stdout.write("not-json-line\n");
  process.stdin.resume();
  process.on("SIGTERM", () => process.exit(0));
} else {
  // 默认：回显命令参数，方便断言命令构造
  process.stdout.write(
    JSON.stringify({
      ok: true,
      outcome: "success",
      data: { args, leaf: args.join(" "), marker: "fake-dws" },
    }),
  );
}
