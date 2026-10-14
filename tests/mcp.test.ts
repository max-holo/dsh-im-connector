import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DingTalkConnector, buildMcpServer, toolList } from "../src/index.js";

const FAKE = fileURLToPath(new URL("./fake-dws.mjs", import.meta.url));

function parseJsonContent(result: { content?: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content?.find((c) => c.type === "text")?.text;
  expect(text).toBeDefined();
  return JSON.parse(text as string);
}

describe("MCP server over dws connector", () => {
  let client: Client;
  let server: ReturnType<typeof buildMcpServer>;

  beforeAll(async () => {
    const conn = new DingTalkConnector({ dwsBin: FAKE, timeoutSec: 30 });
    server = buildMcpServer(conn);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("exposes the full read-only toolset", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(toolList.length);
    expect(tools.length).toBeGreaterThanOrEqual(40);
    const names = tools.map((t) => t.name);
    for (const expected of [
      "contact_me",
      "calendar_today",
      "todo_list_my_tasks",
      "approval_list_pending",
      "attendance_check_result",
      "report_inbox",
      "doc_read",
      "wiki_node_list",
      "drive_list",
      "im_chat_messages",
    ]) {
      expect(names).toContain(expected);
    }
    const tool = tools.find((t) => t.name === "attendance_check_result");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type: string }> };
    expect(schema.required).toEqual(expect.arrayContaining(["users", "start", "end"]));
    expect(schema.properties?.users.type).toBe("array");
  });

  it("calls a tool end-to-end through the protocol", async () => {
    const result = await client.callTool({ name: "calendar_today", arguments: {} });
    expect(result.isError).toBeFalsy();
    const parsed = parseJsonContent(result as { content?: Array<{ type: string; text?: string }> }) as {
      data: { args: string[] };
    };
    expect(parsed.data.args).toEqual(["calendar", "+today", "--format", "json"]);
  });

  it("returns isError with a helpful message on invalid arguments", async () => {
    const result = await client.callTool({ name: "contact_search_user", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string })?.text ?? "";
    expect(text).toContain("query");
  });

  it("returns isError on unknown tools", async () => {
    const result = await client.callTool({ name: "no_such_tool", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("attendance tool forwards CSV users and date range", async () => {
    const result = await client.callTool({
      name: "attendance_check_result",
      arguments: { users: ["u1", "u2"], start: "2026-10-01", end: "2026-10-10" },
    });
    const parsed = parseJsonContent(result as { content?: Array<{ type: string; text?: string }> }) as {
      data: { args: string[] };
    };
    expect(parsed.data.args).toEqual([
      "attendance",
      "+check-result",
      "--users",
      "u1,u2",
      "--start",
      "2026-10-01",
      "--end",
      "2026-10-10",
      "--format",
      "json",
    ]);
  });
});
