import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngine, gateAllows, type EngineContext } from "../src/plugin/engine.js";
import type { ImChannel, ImInboundMessage, ImSendTarget } from "../src/channels/types.js";

function tick(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("engine (mock ctx + stub channel)", () => {
  let parentDir: string;
  let dir: string;
  let sent: Array<{ target: ImSendTarget; text: string }>;
  let stopped: boolean;
  let inbound: ((m: ImInboundMessage) => void) | undefined;
  let created: number;
  let prompts: string[];
  let ctx: EngineContext;
  let channel: ImChannel;

  beforeAll(() => {
    parentDir = mkdtempSync(join(tmpdir(), "im-engine-"));
  });
  afterAll(() => {
    rmSync(parentDir, { recursive: true, force: true });
  });

  function fresh() {
    dir = mkdtempSync(join(parentDir, "t-"));
    sent = [];
    stopped = false;
    inbound = undefined;
    created = 0;
    prompts = [];
    channel = {
      providerId: "test",
      async sendText(target: ImSendTarget, text: string) {
        sent.push({ target, text });
        return {};
      },
      async listen(onMessage: (m: ImInboundMessage) => void) {
        inbound = onMessage;
        return { stop: () => (stopped = true) };
      },
      async status() {
        return { user_id: "self-1" };
      },
    };
    const sessionController = {
      async resolveAgent() {
        return {};
      },
      async create() {
        created += 1;
        return { sessionId: `s-${created}` };
      },
      async prompt(request: { sessionId: string }) {
        prompts.push(request.sessionId);
        return { accepted: true as const };
      },
      async *follow() {
        yield { type: "snapshot" };
        yield { type: "assistant-stream", frame: { type: "start" } };
        yield { type: "assistant-stream", frame: { type: "chunk", chunk: { type: "text-delta", text: "你" } } };
        yield { type: "assistant-stream", frame: { type: "chunk", chunk: { type: "text-delta", text: "好" } } };
        yield { type: "assistant-stream", frame: { type: "end" } };
      },
    };
    ctx = {
      sessionController,
      baseDir: dir,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };
  }

  it("gate: group requires explicit mention; self messages skipped", () => {
    const self = new Set(["self-1"]);
    expect(gateAllows({ conversationId: "g1", conversationType: "group", text: "x" }, self)).toBe(false);
    expect(
      gateAllows({ conversationId: "g1", conversationType: "group", text: "x", mentionedBot: true }, self),
    ).toBe(true);
    expect(
      gateAllows(
        { conversationId: "g1", conversationType: "group", senderId: "self-1", text: "x", mentionedBot: true },
        self,
      ),
    ).toBe(false);
  });

  it("dispatch: creates a session once, prompts, collects reply, sends back", async () => {
    fresh();
    const stop = createEngine(ctx, [channel]);
    await tick();
    expect(inbound).toBeDefined();
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "other", text: "在吗", mentionedBot: true });
    await tick(50);
    expect(created).toBe(1);
    expect(prompts).toEqual(["s-1"]);
    expect(sent).toEqual([{ target: { conversationId: "g1" }, text: "你好" }]);

    // 同一聊天第二条消息：复用会话
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "other", text: "再说点", mentionedBot: true });
    await tick(50);
    expect(created).toBe(1);
    expect(prompts).toEqual(["s-1", "s-1"]);

    // 未 @ 的群消息被 Gate 拦截
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "other", text: "路过" });
    await tick(20);
    expect(prompts).toHaveLength(2);

    // 自己发的消息被跳过（防回环）
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "self-1", text: "你好", mentionedBot: true });
    await tick(20);
    expect(prompts).toHaveLength(2);

    stop();
    expect(stopped).toBe(true);
  });

  it("different chats get different sessions", async () => {
    fresh();
    const stop = createEngine(ctx, [channel]);
    await tick();
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "a", text: "1", mentionedBot: true });
    await tick(30);
    inbound!({ conversationId: "g2", conversationType: "group", senderId: "b", text: "2", mentionedBot: true });
    await tick(30);
    expect(created).toBe(2);
    expect(prompts).toEqual(["s-1", "s-2"]);
    stop();
  });
});
