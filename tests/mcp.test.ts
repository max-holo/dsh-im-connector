import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMcpServer, buildInstructions, parseServiceDomains } from "../src/index.js";

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

  it("advertises structured output schemas", async () => {
    const { tools } = await client.listTools();
    const run = tools.find((t) => t.name === "run");
    expect(run?.outputSchema).toBeDefined();
    const schema = run?.outputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["command", "data", "error", "ok", "provider"]);
  });

  it("returns structuredContent alongside text for run", async () => {
    const result = await client.callTool({
      name: "run",
      arguments: { provider: "dingtalk", args: ["contact", "+me"] },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { ok: boolean; provider: string; data: unknown } | undefined;
    expect(structured?.ok).toBe(true);
    expect(structured?.provider).toBe("dingtalk");
    expect(structured?.data).toBeDefined();
  });

  it("sends server instructions on initialize", () => {
    expect(client.getInstructions()).toContain("im-connector");
  });

  it("lists static resources and reads the provider catalogue", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "im://dingtalk/services",
      "im://dingtalk/templates",
      "im://providers",
      "im://wecom/sessions",
    ]);
    const read = await client.readResource({ uri: "im://providers" });
    const text = read.contents[0]?.text as string;
    const parsed = JSON.parse(text) as { providers: Array<{ id: string; displayName: string }> };
    expect(parsed.providers.map((p) => p.id)).toEqual(["dingtalk", "wecom"]);
  });

  it("exposes the group-messages resource template", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const uris = resourceTemplates.map((t) => t.uriTemplate);
    expect(uris.some((uri) => uri.includes("im://dingtalk/group/"))).toBe(true);
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
    const structured = result.structuredContent as { ok: boolean; providers: unknown[] } | undefined;
    expect(structured?.ok).toBe(true);
    expect(structured?.providers).toHaveLength(2);
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

  it("rejects unknown provider through input validation", async () => {
    const result = await client.callTool({
      name: "run",
      arguments: { provider: "slack", args: ["x"] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string })?.text ?? "";
    expect(text.toLowerCase()).toMatch(/provider|invalid|未知/);
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

describe("instructions and resource parsing", () => {
  it("describes providers and resources", () => {
    const text = buildInstructions();
    expect(text).toContain("dingtalk");
    expect(text).toContain("wecom");
    expect(text).toContain("im://providers");
  });

  it("parses dws service domains from help output", () => {
    const help = [
      "▍ Discovered MCP Services:",
      "",
      "  ● agoal       Agoal 管理",
      "  ● chat        群聊 / 消息 / 机器人",
      "",
      "▍ Utility Commands:",
      "",
      "  • aicard      Inspect, validate, and preview DingTalk A2UI cards",
    ].join("\n");
    expect(parseServiceDomains(help)).toEqual([
      { name: "agoal", description: "Agoal 管理" },
      { name: "chat", description: "群聊 / 消息 / 机器人" },
      { name: "aicard", description: "Inspect, validate, and preview DingTalk A2UI cards" },
    ]);
  });
});
