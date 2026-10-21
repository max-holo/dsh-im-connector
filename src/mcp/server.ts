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
import { getProvider, listProviders } from "../providers/registry.js";
import { CliRunner } from "../cli/runner.js";
import { isCliError } from "../cli/errors.js";

function buildRunTool(): Tool {
  const providers = listProviders();
  const lines = providers
    .map((p) => {
      const ex = p.examples.map((e) => `    ${e}`).join("\n");
      return `- ${p.id}（${p.displayName}，\`${p.bin}\`）:\n${ex}`;
    })
    .join("\n");
  return {
    name: "run",
    description:
      `统一 IM 透传：执行指定平台的 CLI 命令并返回其 JSON 输出。已接入平台：\n${lines}\n\n` +
      `provider 选平台，args 是该平台 CLI 的命令字符串数组。写操作（发消息/提交/审批等）需用户明确意图，必要时加 --yes（钉钉）或先用 --dry-run 预览。`,
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: providers.map((p) => p.id),
          description: `IM 平台标识：${providers.map((p) => `${p.id}=${p.displayName}`).join("，")}`,
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "对应平台 CLI 的命令及参数（字符串数组）。",
        },
      },
      required: ["provider", "args"],
    },
  };
}

/**
 * 构建统一 IM 透传 MCP server：暴露一个 `run { provider, args }` 工具，
 * 按 provider 注册表路由到底层 CLI。新增平台只需在 registry 追加 spec。
 */
export interface McpServerOptions {
  name?: string;
  version?: string;
  /** 测试/覆盖用：provider id → CLI 入口路径。 */
  binOverrides?: Record<string, string>;
}

export function buildMcpServer(options: McpServerOptions = {}): Server {
  const server = new Server(
    { name: options.name ?? "im", version: options.version ?? "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const runTool = buildRunTool();

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: [runTool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== "run") {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}. Only "run" is available.` }],
        isError: true,
      };
    }
    const { provider, args } = request.params.arguments ?? {};
    const spec = getProvider(provider as string);
    if (!spec) {
      return {
        content: [
          {
            type: "text",
            text: `未知平台 "${provider}"。可用：${listProviders().map((p) => p.id).join("，")}`,
          },
        ],
        isError: true,
      };
    }
    if (!Array.isArray(args) || args.length === 0 || !args.every((a) => typeof a === "string")) {
      return {
        content: [
          {
            type: "text",
            text: '参数 args 必须是非空字符串数组，例如 {"provider":"dingtalk","args":["contact","+me"]}',
          },
        ],
        isError: true,
      };
    }
    try {
      const runner = new CliRunner(spec);
      const result = await runner.runJson(args as string[], {
        bin: options.binOverrides?.[spec.id],
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = isCliError(e)
        ? JSON.stringify(e.toJSON())
        : e instanceof Error
          ? e.message
          : String(e);
      return {
        content: [{ type: "text", text: `${spec.displayName} run failed: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

async function main(): Promise<void> {
  const server = buildMcpServer();
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
