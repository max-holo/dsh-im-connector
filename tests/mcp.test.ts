import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServer } from "./mock/server.js";
import { DingTalkConnector, buildMcpServer, toolList } from "../src/index.js";

async function connectClient(conn: DingTalkConnector) {
  const server = buildMcpServer(conn);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client, server };
}

function parseJsonContent(result: { content?: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content?.find((c) => c.type === "text")?.text;
  expect(text).toBeDefined();
  return JSON.parse(text as string);
}

describe("MCP server (stdio protocol, in-memory transport)", () => {
  let mock: MockServer;
  let conn: DingTalkConnector;
  let client: Client;
  let server: ReturnType<typeof buildMcpServer>;

  beforeAll(async () => {
    mock = await startMockServer();
    conn = new DingTalkConnector({
      appKey: "test-key",
      appSecret: "test-secret",
      apiBase: mock.url,
      oapiBase: mock.url,
      retryBaseDelayMs: 5,
    });
    const pair = await connectClient(conn);
    client = pair.client;
    server = pair.server;
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    await mock.close();
  });

  it("exposes the full read-only toolset", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(toolList.length);
    expect(tools.length).toBeGreaterThanOrEqual(30);
    const names = tools.map((t) => t.name);
    for (const expected of [
      "calendar_list_events",
      "todo_list_tasks",
      "approval_get_instance",
      "attendance_list_punch_results",
      "report_list",
      "docs_get_blocks",
      "wiki_list_nodes",
      "im_list_captured_messages",
      "contact_search_user",
    ]) {
      expect(names).toContain(expected);
    }
    const calendarTool = tools.find((t) => t.name === "calendar_list_events");
    expect(calendarTool?.inputSchema.type).toBe("object");
    const schema = calendarTool?.inputSchema as { required?: string[]; properties?: Record<string, { type: string }> };
    expect(schema.required).toEqual(expect.arrayContaining(["unionId", "timeMin", "timeMax"]));
    expect(schema.properties?.timeMin.type).toBe("string");
  });

  it("calls a tool end-to-end through the protocol", async () => {
    const result = await client.callTool({
      name: "calendar_list_events",
      arguments: {
        unionId: "union-1",
        timeMin: "2026-10-01T00:00:00Z",
        timeMax: "2026-10-08T00:00:00Z",
      },
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseJsonContent(result as { content?: Array<{ type: string; text?: string }> }) as {
      events: Array<{ id: string }>;
    };
    expect(parsed.events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("returns isError with a helpful message on invalid arguments", async () => {
    const result = await client.callTool({ name: "calendar_get_event", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string })?.text ?? "";
    expect(text).toContain("unionId");
  });

  it("returns isError on unknown tools", async () => {
    const result = await client.callTool({ name: "no_such_tool", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("approval tool chain works over MCP", async () => {
    const ids = await client.callTool({
      name: "approval_list_instance_ids",
      arguments: { processCode: "PROC-1", startTime: "2026-07-01T00:00:00Z" },
    });
    const parsed = parseJsonContent(ids as { content?: Array<{ type: string; text?: string }> }) as {
      instanceIds: string[];
    };
    expect(parsed.instanceIds).toEqual(["id-1", "id-2", "id-3"]);

    const detail = await client.callTool({
      name: "approval_get_instance",
      arguments: { processInstanceId: "id-1" },
    });
    const parsedDetail = parseJsonContent(detail as { content?: Array<{ type: string; text?: string }> }) as {
      title: string;
    };
    expect(parsedDetail.title).toBe("张三的请假申请");
  });

  it("report tool works with date strings", async () => {
    const result = await client.callTool({
      name: "report_list",
      arguments: { startTime: "2026-10-01", endTime: "2026-10-14" },
    });
    const parsed = parseJsonContent(result as { content?: Array<{ type: string; text?: string }> }) as {
      reports: Array<{ report_code: string }>;
    };
    expect(parsed.reports.map((r) => r.report_code)).toEqual(["r1", "r2"]);
  });
});
