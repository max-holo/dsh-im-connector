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
import { isDingTalkError } from "../errors.js";
import { findTool, invokeTool, toolJsonSchema, toolList } from "../tools.js";

/**
 * 构建 DingTalk 只读连接器的 MCP server（stdio transport）。
 * 工具集见 src/tools.ts（与 CLI 共用）。
 */
export function buildMcpServer(conn: DingTalkConnector): Server {
  const server = new Server(
    { name: "dingtalk-connector", version: "0.1.0" },
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
      const message = isDingTalkError(e)
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
  const options = loadEnvOptions();
  if (!options) {
    console.error(
      "dingtalk-connector MCP server requires DINGTALK_APP_KEY and DINGTALK_APP_SECRET environment variables (see .env.example).",
    );
    process.exit(1);
  }
  const conn = new DingTalkConnector(options);
  const server = buildMcpServer(conn);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive while the client is connected.
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
