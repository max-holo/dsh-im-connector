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
    let resolveDone: () => void = () => {};
    channel = {
      providerId: "test",
      async sendText(target: ImSendTarget, text: string) {
        sent.push({ target, text });
        return {};
      },
      async listen(onMessage: (m: ImInboundMessage) => void) {
        inbound = onMessage;
        const done = new Promise<void>((r) => (resolveDone = r));
        return {
          stop: () => {
            stopped = true;
            resolveDone();
          },
          done,
        };
      },
      async status() {
        return { user_id: "self-1", user_name: "马玄" };
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
    const stop = createEngine(ctx, [channel], { replyIdleMs: 20 });
    await tick();
    expect(inbound).toBeDefined();
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "other", text: "在吗", mentionedBot: true });
    await tick(200);
    expect(created).toBe(1);
    expect(prompts).toEqual(["s-1"]);
    expect(sent).toEqual([{ target: { conversationId: "g1", kind: "group" }, text: "你好" }]);

    // 同一聊天第二条消息：复用会话
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "other", text: "再说点", mentionedBot: true });
    await tick(200);
    expect(created).toBe(1);
    expect(prompts).toEqual(["s-1", "s-1"]);

    // 未 @ 的群消息被 Gate 拦截
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "other", text: "路过" });
    await tick(200);
    expect(prompts).toHaveLength(2);

    // 自己发的消息被跳过（防回环）
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "self-1", text: "你好", mentionedBot: true });
    await tick(200);
    expect(prompts).toHaveLength(2);

    stop();
    expect(stopped).toBe(true);
  });

  it("different chats get different sessions", async () => {
    fresh();
    const stop = createEngine(ctx, [channel], { replyIdleMs: 20 });
    await tick();
    inbound!({ conversationId: "g1", conversationType: "group", senderId: "a", text: "1", mentionedBot: true });
    await tick(200);
    inbound!({ conversationId: "g2", conversationType: "group", senderId: "b", text: "2", mentionedBot: true });
    await tick(200);
    expect(created).toBe(2);
    expect(prompts).toEqual(["s-1", "s-2"]);
    stop();
  });

  it("access control: unapproved direct goes to pending with one-time notice; approved proceeds", async () => {
    fresh();
    const pending: string[] = [];
    const access = {
      isApproved: (_p: string, sid: string) => sid === "approved-user",
      recordPending: (_p: string, m: { senderId: string }) => {
        pending.push(m.senderId);
        return true;
      },
      markNotified: () => {},
    };
    const stop = createEngine(ctx, [channel], { access, replyIdleMs: 20 });
    await tick();
    // 未批准：进待批准 + 一次性提示，不派发
    inbound!({ conversationId: "d1", conversationType: "direct", senderId: "stranger", text: "在吗" });
    await tick(200);
    expect(pending).toEqual(["stranger"]);
    expect(sent.length).toBe(1);
    expect(prompts).toHaveLength(0);
    // 已批准：正常派发
    inbound!({ conversationId: "d2", conversationType: "direct", senderId: "approved-user", text: "帮我" });
    await tick(200);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe("s-1");
    stop();
  });

  it("gateAllows honors the approval callback", () => {
    const self = new Set<string>();
    const approved = (sid: string) => sid === "ok";
    expect(
      gateAllows({ conversationId: "d1", conversationType: "direct", senderId: "nobody", text: "x" }, self, approved),
    ).toBe(false);
    expect(
      gateAllows({ conversationId: "d1", conversationType: "direct", senderId: "ok", text: "x" }, self, approved),
    ).toBe(true);
    expect(
      gateAllows({ conversationId: "d1", conversationType: "direct", text: "x" }, self, approved),
    ).toBe(false); // 缺少发送者身份拒绝
  });

  it("gateAllows allowSelf bypasses self-skip (debug self-test)", () => {
    const selfIds = new Set(["self-1"]);
    const selfNames = new Set(["马玄"]);
    const selfMsg = {
      conversationId: "g1",
      conversationType: "group" as const,
      senderId: "self-1",
      senderName: "马玄",
      text: "@我",
      mentionedBot: true,
    };
    expect(gateAllows(selfMsg, selfIds, undefined, selfNames)).toBe(false);
    expect(gateAllows(selfMsg, selfIds, undefined, selfNames, true)).toBe(true);
  });

  it("self-command prefix from own account triggers; others and non-prefixed self messages do not", async () => {
    fresh();
    const stop = createEngine(ctx, [channel], {
      replyIdleMs: 20,
      command: () => ({ enabled: true, prefix: "AI:" }),
    });
    await tick();
    // 自己发「AI: 指令」→ 触发派发
    inbound!({
      conversationId: "g1",
      conversationType: "group",
      senderId: "self-1",
      senderName: "马玄",
      text: "AI: 查一下今天的日程",
    });
    await tick(300);
    expect(prompts).toHaveLength(1);
    // 别人发同样前缀 → 不触发（仅本人账号）
    inbound!({
      conversationId: "g1",
      conversationType: "group",
      senderId: "other",
      senderName: "张三",
      text: "AI: 你好",
    });
    await tick(300);
    expect(prompts).toHaveLength(1);
    // 自己发普通消息 → 不触发
    inbound!({
      conversationId: "g1",
      conversationType: "group",
      senderId: "self-1",
      senderName: "马玄",
      text: "随便聊聊",
    });
    await tick(300);
    expect(prompts).toHaveLength(1);
    stop();
  });

  it("atMe switch disables group @me replies while remote commands keep working", async () => {
    fresh();
    const stop = createEngine(ctx, [channel], {
      replyIdleMs: 20,
      command: () => ({ enabled: true, prefix: "AI:" }),
      triggers: () => ({ atMe: false }),
    });
    await tick();
    // 别人 @我 → 被 atMe 开关拦截
    inbound!({
      conversationId: "g1",
      conversationType: "group",
      senderId: "other",
      senderName: "张三",
      text: "帮我查下日程",
      mentionedBot: true,
    });
    await tick(300);
    expect(prompts).toHaveLength(0);
    // 自己的远程指令 → 不受 @我 开关影响
    inbound!({
      conversationId: "g1",
      conversationType: "group",
      senderId: "self-1",
      senderName: "马玄",
      text: "AI: 查一下日程",
    });
    await tick(300);
    expect(prompts).toHaveLength(1);
    stop();
  });
});
