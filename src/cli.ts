#!/usr/bin/env node
import { loadEnvOptions } from "./config.js";
import { DingTalkConnector } from "./connector.js";
import { startMessageCapture } from "./capture.js";
import { findTool, invokeTool, toolList } from "./tools.js";

const USAGE = `dtconn — DingTalk 只读连接器 CLI

用法:
  dtconn tools                                 列出全部只读工具
  dtconn call <tool> [json-args]               调用工具，json-args 为 JSON 对象字符串
  dtconn capture [--file <path>]               启动 Stream 消息捕获（Ctrl+C 停止）
  dtconn help                                  显示本帮助

选项:
  --app-key <key>      覆盖 DINGTALK_APP_KEY
  --app-secret <sec>   覆盖 DINGTALK_APP_SECRET
  --api-base <url>     覆盖 API 域名（测试用）
  --oapi-base <url>    覆盖 OAPI 域名（测试用）

示例:
  dtconn call contact_search_user '{"queryWord":"张三"}'
  dtconn call calendar_list_events '{"unionId":"...","timeMin":"2026-10-01T00:00:00+08:00","timeMax":"2026-10-14T00:00:00+08:00"}'
  dtconn call report_list '{"startTime":"2026-10-01","endTime":"2026-10-14"}'
`;

interface ParsedArgs {
  flags: Record<string, string>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = value;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);
  const command = positional[0];

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }

  // Build options with flag overrides.
  const envOptions = loadEnvOptions();
  const options = {
    appKey: flags["app-key"] ?? envOptions?.appKey ?? "",
    appSecret: flags["app-secret"] ?? envOptions?.appSecret ?? "",
    apiBase: flags["api-base"] ?? envOptions?.apiBase,
    oapiBase: flags["oapi-base"] ?? envOptions?.oapiBase,
    captureFile: flags["file"] ?? envOptions?.captureFile,
  };

  if (command === "tools") {
    for (const tool of toolList) {
      const required = tool.params.filter((p) => p.required).map((p) => p.name);
      process.stdout.write(`${tool.name}\n  ${tool.description}\n`);
      if (required.length > 0) process.stdout.write(`  必填参数: ${required.join(", ")}\n`);
    }
    process.stdout.write(`\n共 ${toolList.length} 个只读工具。\n`);
    return 0;
  }

  if (!options.appKey || !options.appSecret) {
    process.stderr.write(
      "缺少凭证：请设置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET 环境变量，或使用 --app-key/--app-secret。\n",
    );
    return 1;
  }

  if (command === "call") {
    const toolName = positional[1];
    if (!toolName) {
      process.stderr.write("用法: dtconn call <tool> [json-args]\n");
      return 1;
    }
    const tool = findTool(toolName);
    if (!tool) {
      process.stderr.write(`未知工具: ${toolName}（运行 dtconn tools 查看列表）\n`);
      return 1;
    }
    let args: Record<string, unknown> = {};
    if (positional[2]) {
      try {
        args = JSON.parse(positional[2]) as Record<string, unknown>;
      } catch (e) {
        process.stderr.write(`JSON 参数解析失败: ${(e as Error).message}\n`);
        return 1;
      }
    }
    const conn = new DingTalkConnector(options);
    try {
      const result = await invokeTool(conn, tool, args);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }

  if (command === "capture") {
    const conn = new DingTalkConnector(options);
    process.stdout.write(
      `启动 Stream 消息捕获，落盘文件: ${conn.options.captureFile}\n` +
        "（需要应用已开通 机器人-Stream 模式；Ctrl+C 停止）\n",
    );
    const handle = await startMessageCapture({
      appKey: options.appKey,
      appSecret: options.appSecret,
      captureFile: conn.options.captureFile,
      log: (msg) => process.stdout.write(`${msg}\n`),
      onMessage: (m) => {
        process.stdout.write(
          `[${m.capturedAt}] ${m.conversationType === "1" ? "单聊" : "群聊"} ${m.senderNick ?? m.senderStaffId ?? "?"}: ${m.content ?? `(${m.msgtype ?? "unknown"})`}\n`,
        );
      },
      onError: (e) => {
        process.stderr.write(`capture error: ${e instanceof Error ? e.message : String(e)}\n`);
      },
    });
    const shutdown = () => {
      process.stdout.write("\n停止捕获。\n");
      handle.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // Keep the process alive.
    await new Promise(() => {});
    return 0;
  }

  process.stderr.write(`未知命令: ${command}\n\n${USAGE}`);
  return 1;
}

main().then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (e) => {
    process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(1);
  },
);
