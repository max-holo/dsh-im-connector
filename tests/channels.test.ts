import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CliRunner,
  DingTalkChannel,
  WeComChannel,
  dingtalk,
  normalizeDingTalkEvent,
  wecom,
  type ImInboundMessage,
} from "../src/index.js";

const FAKE = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));

function dRunner() {
  return new CliRunner(dingtalk, { bin: FAKE });
}
function wRunner() {
  return new CliRunner(wecom, { bin: FAKE });
}

describe("channels (fake CLI)", () => {
  it("dingtalk sendText → chat +messages-send --yes", async () => {
    const ch = new DingTalkChannel(dRunner());
    const data = (await ch.sendText({ conversationId: "cid-1" }, "你好")) as {
      data: { args: string[] };
    };
    expect(data.data.args).toEqual([
      "chat",
      "+messages-send",
      "--group",
      "cid-1",
      "--markdown",
      "你好",
      "--identity",
      "user",
      "--yes",
      "--format",
      "json",
    ]);
  });

  it("wecom sendText → message send --msg-type text --text json", async () => {
    const ch = new WeComChannel(wRunner());
    const data = (await ch.sendText({ conversationId: "chat-1" }, "你好")) as {
      data: { args: string[] };
    };
    expect(data.data.args).toEqual([
      "message",
      "send",
      "--chat-id",
      "chat-1",
      "--msg-type",
      "text",
      "--text",
      '{"content":"你好"}',
    ]);
  });

  it("wecom listMessages passes time range and cursor", async () => {
    const ch = new WeComChannel(wRunner());
    const data = (await ch.listMessages("chat-1", "2026-10-01 00:00:00", "2026-10-21 00:00:00", {
      cursor: "c-1",
    })) as { data: { args: string[] } };
    expect(data.data.args).toEqual([
      "chat",
      "messages",
      "list",
      "--chat-id",
      "chat-1",
      "--begin-time",
      "2026-10-01 00:00:00",
      "--end-time",
      "2026-10-21 00:00:00",
      "--cursor",
      "c-1",
    ]);
  });

  it("dingtalk listen streams NDJSON and normalizes events", async () => {
    process.env.FAKE_CLI_STREAM = "1";
    try {
      const ch = new DingTalkChannel(dRunner());
      const events: ImInboundMessage[] = [];
      const handle = await ch.listen((m) => events.push(m));
      await new Promise((r) => setTimeout(r, 150));
      handle.stop();
      expect(events.length).toBe(1);
      expect(events[0]).toMatchObject({
        conversationId: "cid-9",
        conversationType: "group",
        senderName: "张三",
        text: "帮我查下日程",
        mentionedBot: true,
      });
    } finally {
      delete process.env.FAKE_CLI_STREAM;
    }
  });

  it("wecom listen returns an explicit no-op boundary (no push in wecom-cli)", async () => {
    const ch = new WeComChannel(wRunner());
    const handle = await ch.listen(() => {
      throw new Error("should not be called");
    });
    expect(typeof handle.stop).toBe("function");
  });

  it("normalizeDingTalkEvent parses envelopes and skips non-messages", () => {
    const envelope = JSON.stringify({
      type: "event",
      data: {
        conversationId: "cid-1",
        conversationType: "2",
        senderStaffId: "u1",
        text: { content: "你好" },
        isAtBot: true,
      },
    });
    expect(normalizeDingTalkEvent(envelope)).toMatchObject({
      conversationId: "cid-1",
      conversationType: "group",
      text: "你好",
      mentionedBot: true,
    });
    expect(normalizeDingTalkEvent("not json")).toBeNull();
    expect(normalizeDingTalkEvent(JSON.stringify({ data: { type: "system" } }))).toBeNull();
  });
});
