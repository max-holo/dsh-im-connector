import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMcpServer } from "../src/index.js";

const FAKE = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));

function parseText(result: { content?: Array<{ type: string; text?: string }> }): string {
  const text = result.content?.find((c) => c.type === "text")?.text;
  expect(text).toBeDefined();
  return text as string;
}

describe("unified IM MCP server", () => {
  let client: Client;
  let server: ReturnType<typeof buildMcpServer>;

  beforeAll(async () => {
    server = buildMcpServer({ binOverrides: { dingtalk: FAKE, wecom: FAKE } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("exposes run, info, login and login_status tools with provider enums", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["run", "info", "login", "login_status"]);
    const schema = tools[0].inputSchema as {
      required?: string[];
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(schema.required).toEqual(["provider", "args"]);
    expect(schema.properties?.provider.enum).toEqual(["dingtalk", "wecom"]);
    const loginSchema = tools[2].inputSchema as { properties?: Record<string, { enum?: string[] }> };
    expect(loginSchema.properties?.provider.enum).toEqual(["dingtalk", "wecom"]);
  });

  it("info reports per-provider version, auth status and resolved CLI path", async () => {
    const result = await client.callTool({ name: "info", arguments: {} });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      parseText(result as { content?: Array<{ type: string; text?: string }> }),
    ) as {
      providers: Array<{ id: string; version?: string; auth?: unknown; resolved?: string }>;
    };
    expect(parsed.providers.map((p) => p.id)).toEqual(["dingtalk", "wecom"]);
    for (const p of parsed.providers) {
      expect(p.version).toBeDefined();
      expect(p.auth).toBeDefined();
      expect(p.resolved).toBe(FAKE);
    }
  });

  it("routes dingtalk and appends --format json", async () => {
    const result = await client.callTool({
      name: "run",
      arguments: { provider: "dingtalk", args: ["contact", "+me"] },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(parseText(result as { content?: Array<{ type: string; text?: string }> })) as {
      data: { args: string[] };
    };
    expect(parsed.data.args).toEqual(["contact", "+me", "--format", "json"]);
  });

  it("routes wecom and appends no format flag", async () => {
    const result = await client.callTool({
      name: "run",
      arguments: { provider: "wecom", args: ["contact", "users", "search"] },
    });
    const parsed = JSON.parse(parseText(result as { content?: Array<{ type: string; text?: string }> })) as {
      data: { args: string[] };
    };
    expect(parsed.data.args).toEqual(["contact", "users", "search"]);
  });

  it("rejects unknown provider", async () => {
    const result = await client.callTool({
      name: "run",
      arguments: { provider: "slack", args: ["x"] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string })?.text ?? "";
    expect(text).toContain("未知平台");
  });

  it("rejects empty / non-string args", async () => {
    const empty = await client.callTool({
      name: "run",
      arguments: { provider: "dingtalk", args: [] },
    });
    expect(empty.isError).toBe(true);
    const bad = await client.callTool({
      name: "run",
      arguments: { provider: "dingtalk", args: [1, 2] },
    });
    expect(bad.isError).toBe(true);
  });
});
