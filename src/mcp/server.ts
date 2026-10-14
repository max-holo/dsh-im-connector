#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { loadEnvOptions, resolveOptions } from "../config.js";
import { DwsRunner } from "../dws/runner.js";
import { isDwsError } from "../dws/errors.js";

const RUN_TOOL: Tool = {
  name: "run",
  description:
    "直接执行任意 dws（dingtalk-workspace-cli）命令并返回其 JSON 输出（自动追加 --format json）。dws 是钉钉的统一操作入口，读写全覆盖。args 是一串字符串（dws 命令 + 参数，不要含 --format）。\n\n" +
    "常用读操作：\n" +
    "  通讯录: [\"contact\",\"+me\"] / [\"contact\",\"+search-user\",\"--query\",\"张三\"] / [\"contact\",\"+dept-members\",\"--dept\",\"研发中心\"]\n" +
    "  日历:   [\"calendar\",\"+today\"] / [\"calendar\",\"+agenda\",\"--start\",\"2026-10-13T00:00:00+08:00\",\"--end\",\"2026-10-14T00:00:00+08:00\"]\n" +
    "  待办:   [\"todo\",\"+get-my-tasks\"] / [\"todo\",\"+get\",\"--task-id\",\"<id>\"]\n" +
    "  审批:   [\"oa\",\"approval\",\"list-pending\"] / [\"oa\",\"approval\",\"detail\",\"--instance-id\",\"<id>\"]\n" +
    "  考勤:   [\"attendance\",\"+check-result\",\"--users\",\"u1,u2\",\"--start\",\"2026-10-01\",\"--end\",\"2026-10-10\"] / [\"attendance\",\"+my-attendance\"]\n" +
    "  日志:   [\"report\",\"inbox\",\"list\"] / [\"report\",\"entry\",\"get\",\"--report-id\",\"<id>\"] / [\"report\",\"template\",\"list\"]\n" +
    "  文档:   [\"doc\",\"read\",\"--node\",\"<docId|url>\"] / [\"wiki\",\"+space-list\"] / [\"drive\",\"+list\"]\n" +
    "  消息:   [\"chat\",\"+chat-messages\",\"--group\",\"<群名|openConversationId>\",\"--limit\",\"20\"] / [\"chat\",\"+search-msg\",\"--query\",\"<kw>\"] / [\"chat\",\"+my-groups\"]\n\n" +
    "写操作（需用户明确意图，必要时加 --yes）：\n" +
    "  发消息: [\"chat\",\"+messages-send\",\"--group\",\"<openConversationId>\",\"--markdown\",\"<内容>\",\"--title\",\"<标题>\",\"--yes\"]\n" +
    "  提交日志: [\"report\",\"entry\",\"submit\",\"--template-id\",\"<id>\",\"--contents-file\",\"./report.json\",\"--to-user-ids\",\"<userId>\",\"--yes\"]\n" +
    "  实时监听: [\"event\",\"+listen-im\",\"--kind\",\"at-me\"]（长连接，谨慎使用）\n",
  inputSchema: {
    type: "object",
    properties: {
      args: {
        type: "array",
        items: { type: "string" },
        description:
          "dws 命令及参数的字符串数组，例如 [\"contact\",\"+me\"]。不要包含 --format（会自动追加）。",
      },
    },
    required: ["args"],
  },
};

export interface McpServerOptions {
  profile?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * 构建 dws 透传 MCP server：只暴露一个 `run` 工具，参数即 dws 原生命令，
 * 转发给 DwsRunner 执行并返回解析后的 JSON。
 */
export function buildMcpServer(runner: DwsRunner, options: McpServerOptions = {}): Server {
  const server = new Server(
    { name: "dingtalk-connector", version: "0.3.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: [RUN_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== "run") {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}. Only "run" is available.` }],
        isError: true,
      };
    }
    const args = request.params.arguments?.args;
    if (!Array.isArray(args) || args.length === 0 || !args.every((a) => typeof a === "string")) {
      return {
        content: [
          {
            type: "text",
            text: '参数 args 必须是非空字符串数组，例如 {"args":["contact","+me"]}',
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await runner.runJson(args as string[], {
        profile: options.profile,
        env: options.env,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = isDwsError(e)
        ? JSON.stringify(e.toJSON())
        : e instanceof Error
          ? e.message
          : String(e);
      return {
        content: [{ type: "text", text: `dws run failed: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

async function main(): Promise<void> {
  const options = resolveOptions(loadEnvOptions() ?? {});
  const runner = new DwsRunner({ bin: options.dwsBin, timeoutSec: options.timeoutSec });
  const server = buildMcpServer(runner, { profile: options.profile, env: options.env });
  await server.connect(new StdioServerTransport());
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
