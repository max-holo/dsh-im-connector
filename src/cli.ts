#!/usr/bin/env node
import { loadEnvOptions } from "./config.js";
import { DingTalkConnector } from "./connector.js";
import { isDwsError } from "./dws/errors.js";
import { findTool, invokeTool, toolList } from "./tools.js";

const USAGE = `dtconn — 基于 dws(dingtalk-workspace-cli) 的钉钉只读连接器 CLI

用法:
  dtconn tools                               列出全部只读工具
  dtconn call <tool> [json-args]             调用工具（json-args 为 JSON 对象字符串）
  dtconn raw <dws-args...>                   直接运行任意 dws 命令（逃生舱）
  dtconn listen [flags]                      实时监听 IM 消息（Stream NDJSON）
  dtconn status                              查看 dws 登录态（dws auth status）
  dtconn help                                显示本帮助

选项:
  --dws-bin <path>    覆盖 dws 入口（默认解析 npm 全局安装的 dws）
  --profile <id>      一次性指定组织/账号（corpId:userId）
  --timeout <秒>      传给 dws 的 HTTP 超时（默认 30）

示例:
  dtconn call contact_me
  dtconn call contact_search_user '{"query":"张三"}'
  dtconn call calendar_today
  dtconn call todo_list_my_tasks
  dtconn call approval_list_pending
  dtconn call report_inbox
  dtconn call im_chat_messages '{"group":"某群名","limit":20}'
  dtconn raw calendar +week
  dtconn listen --kind at-me --max-events 5
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

function buildConnector(flags: Record<string, string>): DingTalkConnector {
  const env = loadEnvOptions() ?? {};
  return new DingTalkConnector({
    dwsBin: flags["dws-bin"] ?? env.dwsBin,
    profile: flags["profile"] ?? env.profile,
    timeoutSec: flags["timeout"] ? Number(flags["timeout"]) : env.timeoutSec,
  });
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);
  const command = positional[0];

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === "tools") {
    for (const tool of toolList) {
      const required = tool.params.filter((p) => p.required).map((p) => p.name);
      process.stdout.write(`${tool.name}\n  ${tool.description}\n`);
      if (required.length > 0) process.stdout.write(`  必填参数: ${required.join(", ")}\n`);
    }
    process.stdout.write(`\n共 ${toolList.length} 个只读工具。\n`);
    return 0;
  }

  const conn = buildConnector(flags);

  if (command === "status") {
    try {
      const result = await conn.run(["auth", "status"]);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    } catch (e) {
      process.stderr.write(formatError(e) + "\n");
      return 1;
    }
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
    try {
      const result = await invokeTool(conn, tool, args);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    } catch (e) {
      process.stderr.write(formatError(e) + "\n");
      return 1;
    }
  }

  if (command === "raw") {
    const dwsArgs = positional.slice(1);
    if (dwsArgs.length === 0) {
      process.stderr.write("用法: dtconn raw <dws-args...>\n");
      return 1;
    }
    try {
      const result = await conn.run(dwsArgs);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    } catch (e) {
      process.stderr.write(formatError(e) + "\n");
      return 1;
    }
  }

  if (command === "listen") {
    const maxEvents = flags["max-events"] ? Number(flags["max-events"]) : undefined;
    const handle = await conn.messages.listenIm(
      {
        kind: (flags["kind"] as never) ?? "at-me",
        user: flags["user"],
        userQuery: flags["user-query"],
        chatId: flags["chat-id"],
        chatQuery: flags["chat-query"],
        query: flags["query"],
        maxEvents,
        duration: flags["duration"],
      },
      (event) => {
        process.stdout.write(JSON.stringify(event) + "\n");
      },
    );
    process.stdout.write(`监听中（kind=${flags["kind"] ?? "at-me"}），Ctrl+C 停止...\n`);
    const shutdown = () => {
      handle.stop();
      process.stdout.write("\n已停止监听。\n");
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    await new Promise(() => {});
    return 0;
  }

  process.stderr.write(`未知命令: ${command}\n\n${USAGE}`);
  return 1;
}

function formatError(e: unknown): string {
  if (isDwsError(e)) return `${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

main().then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (e) => {
    process.stderr.write(`${formatError(e)}\n`);
    process.exit(1);
  },
);
