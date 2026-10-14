import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DwsRunner, buildMcpServer } from "../src/index.js";

const FAKE = fileURLToPath(new URL("./fake-dws.mjs", import.meta.url));

function parseText(result: { content?: Array<{ type: string; text?: string }> }): string {
  const text = result.content?.find((c) => c.type === "text")?.text;
  expect(text).toBeDefined();
  return text as string;
}

describe("MCP server (dws passthrough)", () => {
  let client: Client;
  let server: ReturnType<typeof buildMcpServer>;

  beforeAll(async () => {
    const runner = new DwsRunner({ bin: FAKE, timeoutSec: 30 });
    server = buildMcpServer(runner);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("exposes exactly one passthrough tool named 'run'", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["run"]);
    const schema = tools[0].inputSchema as { required?: string[]; properties?: Record<string, { type: string }> };
    expect(schema.required).toEqual(["args"]);
    expect(schema.properties?.args.type).toBe("array");
  });

  it("forwards args to dws and returns parsed JSON", async () => {
    const result = await client.callTool({
      name: "run",
      arguments: { args: ["contact", "+me"] },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(parseText(result as { content?: Array<{ type: string; text?: string }> })) as {
      data: { args: string[] };
    };
    expect(parsed.data.args).toEqual(["contact", "+me", "--format", "json"]);
  });

  it("passes a full multi-flag command through unchanged", async () => {
    const result = await client.callTool({
      name: "run",
      arguments: {
        args: [
          "chat",
          "+messages-send",
          "--group",
          "cid-1",
          "--markdown",
          "值班提醒",
          "--title",
          "值班",
          "--yes",
        ],
      },
    });
    const parsed = JSON.parse(parseText(result as { content?: Array<{ type: string; text?: string }> })) as {
      data: { args: string[] };
    };
    expect(parsed.data.args).toEqual([
      "chat",
      "+messages-send",
      "--group",
      "cid-1",
      "--markdown",
      "值班提醒",
      "--title",
      "值班",
      "--yes",
      "--format",
      "json",
    ]);
  });

  it("rejects missing / empty / non-string args", async () => {
    const missing = await client.callTool({ name: "run", arguments: {} });
    expect(missing.isError).toBe(true);
    const empty = await client.callTool({ name: "run", arguments: { args: [] } });
    expect(empty.isError).toBe(true);
    const badType = await client.callTool({ name: "run", arguments: { args: [1, 2] } });
    expect(badType.isError).toBe(true);
  });

  it("returns isError on unknown tools", async () => {
    const result = await client.callTool({ name: "no_such_tool", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("maps dws failure to isError with the error envelope", async () => {
    const errRunner = new DwsRunner({ bin: FAKE, timeoutSec:30 });
    const errServer = buildMcpServer(errRunner, { env: { FAKE_DWS_ERROR: "1" } });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await errServer.connect(st);
    const c = new Client({ name: "err-client", version: "0" }, { capabilities: {} });
    await c.connect(ct);
    const res = await c.callTool({ name: "run", arguments: { args: ["__error__"] } });
    expect(res.isError).toBe(true);
    const text = (res.content?.[0] as { text?: string })?.text ?? "";
    expect(text).toContain("fake dws error");
    await c.close();
    await errServer.close();
  });
});
