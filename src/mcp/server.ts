#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { DingTalkConnector } from "../connector.js";
import { loadEnvOptions } from "../config.js";
import { isDwsError } from "../dws/errors.js";
import { findTool, invokeTool, toolJsonSchema, toolList } from "../tools.js";

/**
 * 基于 dws（dingtalk-workspace-cli）的钉钉只读连接器 MCP server（stdio）。
 * 认证复用 dws 本地登录态；无环境变量时也可运行（默认 dws 二进制 + 当前 profile）。
 */
export function buildMcpServer(conn: DingTalkConnector): Server {
  const server = new Server(
    { name: "dingtalk-connector", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: toolList.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolJsonSchema(tool),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const tool = findTool(name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}. Use tools/list to see available tools.` }],
        isError: true,
      };
    }
    try {
      const result = await invokeTool(conn, tool, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = isDwsError(e)
        ? JSON.stringify(e.toJSON())
        : e instanceof Error
          ? e.message
          : String(e);
      return {
        content: [{ type: "text", text: `Tool ${name} failed: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

async function main(): Promise<void> {
  const options = loadEnvOptions() ?? {};
  const conn = new DingTalkConnector(options);
  const server = buildMcpServer(conn);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
