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

  it("dingtalk sendText to a direct target uses --user", async () => {
    const ch = new DingTalkChannel(dRunner());
    const data = (await ch.sendText(
      { conversationId: "c-1", kind: "direct", userId: "u-9" },
      "hi",
    )) as { data: { args: string[] } };
    expect(data.data.args).toEqual([
      "chat",
      "+messages-send",
      "--user",
      "u-9",
      "--markdown",
      "hi",
      "--identity",
      "user",
      "--yes",
      "--format",
      "json",
    ]);
  });

  it("dingtalk sendText to a direct target prefers --open-dingtalk-id", async () => {
    const ch = new DingTalkChannel(dRunner());
    const data = (await ch.sendText(
      { conversationId: "c-1", kind: "direct", openDingTalkId: "DOZF-x" },
      "hi",
    )) as { data: { args: string[] } };
    expect(data.data.args).toEqual([
      "chat",
      "+messages-send",
      "--open-dingtalk-id",
      "DOZF-x",
      "--markdown",
      "hi",
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

  it("dingtalk listen streams at-me/all-direct/all-group NDJSON and normalizes them", async () => {
    process.env.FAKE_CLI_STREAM = "1";
    try {
      const ch = new DingTalkChannel(dRunner());
      const events: ImInboundMessage[] = [];
      const handle = await ch.listen((m) => events.push(m));
      await new Promise((r) => setTimeout(r, 400));
      handle.stop();
      expect(events.length).toBe(3); // at-me / all-direct / all-group 各一条
      const atMe = events.find((e) => e.conversationId === "cid-9");
      const allGroup = events.find((e) => e.conversationId === "cid-g");
      const direct = events.find((e) => e.conversationType === "direct");
      expect(atMe).toMatchObject({
        conversationType: "group",
        senderName: "张三",
        text: "帮我查下日程",
        mentionedBot: true,
      });
      expect(allGroup).toMatchObject({
        conversationType: "group",
        text: "群里普通消息",
      });
      expect(direct).toMatchObject({
        conversationId: "cid-d",
        senderName: "张三",
        text: "私聊你好",
      });
    } finally {
      delete process.env.FAKE_CLI_STREAM;
    }
  });

  it("wecom listen polls groups+messages and emits deduped messages", async () => {
    process.env.FAKE_CLI_WECOM = "1";
    try {
      const ch = new WeComChannel(wRunner());
      const events: ImInboundMessage[] = [];
      const handle = await ch.listen((m) => events.push(m), { intervalMs: 60, overlapMs: 0 });
      await new Promise((r) => setTimeout(r, 700));
      handle.stop();
      expect(events.length).toBe(2); // m1 + m2，去重后每轮不再重复
      expect(events[0]).toMatchObject({ conversationId: "g1", text: "你好", senderName: "张三" });
      expect(events[1]).toMatchObject({ conversationId: "g1", text: "在吗", senderName: "李四" });
    } finally {
      delete process.env.FAKE_CLI_WECOM;
    }
  });

  it("normalizeDingTalkEvent parses the real snake_case payloads and skips non-messages", () => {
    // 真实 at-me 事件（抓包实测形状）
    const atMe = JSON.stringify({
      type: "user_im_message_receive_at",
      event_id: "e1",
      message_id: "msg1",
      conversation_id: "cidVZ...",
      sender: "马玄",
      sender_open_dingtalk_id: "DOZF5my7...",
      content: "IM连接自检 @马玄  消息链路测试",
      create_time: "2026-10-21 17:29:21",
    });
    expect(normalizeDingTalkEvent(atMe)).toMatchObject({
      conversationId: "cidVZ...",
      conversationType: "group",
      senderName: "马玄",
      senderOpenDingTalkId: "DOZF5my7...",
      text: "IM连接自检 @马玄  消息链路测试",
      mentionedBot: true,
    });

    // 旧 envelope/camelCase 形态仍兼容
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

    // 私聊事件（type 含 direct）
    const direct = JSON.stringify({
      type: "user_im_message_receive_direct",
      conversation_id: "cid-d1",
      sender: "张三",
      sender_open_dingtalk_id: "DOZF-other",
      content: "私聊你好",
    });
    expect(normalizeDingTalkEvent(direct)).toMatchObject({
      conversationId: "cid-d1",
      conversationType: "direct",
      senderName: "张三",
      text: "私聊你好",
    });

    expect(normalizeDingTalkEvent("not json")).toBeNull();
    expect(normalizeDingTalkEvent(JSON.stringify({ data: { type: "system" } }))).toBeNull();
  });
});
