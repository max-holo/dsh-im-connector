import { dingtalk } from "../providers/dingtalk.js";
import { CliRunner } from "../cli/runner.js";
import type { ImChannel, ImInboundMessage, ImSendTarget } from "./types.js";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function extractText(data: Record<string, unknown>): string | undefined {
  // 真实事件：扁平 content 字符串；兼容嵌套 text.content 与 camelCase
  if (typeof data.content === "string" && data.content) return data.content;
  const text = data.text as Record<string, unknown> | undefined;
  if (text && typeof text.content === "string" && text.content) return text.content;
  return str(data.text);
}

/**
 * 把 dws event 的 NDJSON 行归一为 ImInboundMessage。
 * 真实事件形状（snake_case、扁平）：
 *   { type: "user_im_message_receive_at" | "user_im_message_receive_group_all" | ...,
 *     conversation_id, sender, sender_open_dingtalk_id, content, message_id, ... }
 * 同时兼容旧的 camelCase/envelope 形态。
 * 无法识别会话或文本时返回 null（跳过系统事件等）。
 */
export function normalizeDingTalkEvent(line: string): ImInboundMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const envelope = parsed as Record<string, unknown>;
  const data = (envelope.data ?? envelope) as Record<string, unknown>;
  const type = str(data.type) ?? str(envelope.type) ?? "";
  const conversationId =
    str(data.conversation_id) ??
    str(data.conversationId) ??
    str(data.groupId) ??
    str(data.openConversationId);
  const text = extractText(data);
  if (!conversationId || !text) return null;
  const direct = /direct/i.test(type) || data.conversationType === "1";
  const atMe = /_at$|receive_at/.test(type);
  return {
    conversationId,
    conversationType: direct ? "direct" : "group",
    senderId:
      str(data.sender_staff_id) ??
      str(data.senderStaffId) ??
      str(data.sender_id) ??
      str(data.sender_open_dingtalk_id) ??
      str(data.senderOpenDingTalkId),
    senderName: str(data.sender) ?? str(data.senderNick) ?? str(data.senderName),
    senderOpenDingTalkId:
      str(data.sender_open_dingtalk_id) ?? str(data.senderOpenDingTalkId) ?? str(data.openDingTalkId),
    text,
    mentionedBot:
      typeof data.mentionedBot === "boolean"
        ? data.mentionedBot
        : typeof data.isAtBot === "boolean"
          ? data.isAtBot
          : atMe
            ? true
            : undefined,
    raw: data,
  };
}

/**
 * 钉钉渠道（基于 dws）：
 * - 收：`dws event +listen-im --kind at-me`（群里 @我 的消息）+ `--kind all-direct`（私聊）
 * - 发：`dws chat +messages-send`（群用 --group，私聊用 --open-dingtalk-id / --user）
 * - 状态：`dws auth status`
 */
export class DingTalkChannel implements ImChannel {
  readonly providerId = "dingtalk";
  private readonly runner: CliRunner;

  constructor(runner?: CliRunner) {
    this.runner = runner ?? new CliRunner(dingtalk);
  }

  async sendText(target: ImSendTarget, text: string): Promise<unknown> {
    const base = ["chat", "+messages-send"];
    if (target.kind === "direct") {
      if (target.openDingTalkId) {
        return this.runner.runJson([
          ...base,
          "--open-dingtalk-id",
          target.openDingTalkId,
          "--markdown",
          text,
          "--identity",
          "user",
          "--yes",
        ]);
      }
      if (target.userId) {
        return this.runner.runJson([...base, "--user", target.userId, "--markdown", text, "--identity", "user", "--yes"]);
      }
    }
    return this.runner.runJson([
      ...base,
      "--group",
      target.conversationId,
      "--markdown",
      text,
      "--identity",
      "user",
      "--yes",
    ]);
  }

  /** 同时监听「群里 @我」「私聊」「全部群消息（用于远程指令前缀触发）」，任一断开由引擎监督重启。 */
  async listen(
    onMessage: (m: ImInboundMessage) => void,
  ): Promise<{ stop: () => void; done: Promise<void> }> {
    const handles: Array<{ stop: () => void; done: Promise<void> }> = [];
    for (const kind of ["at-me", "all-direct", "all-group"]) {
      handles.push(
        await this.runner.stream(["event", "+listen-im", "--kind", kind, "--format", "ndjson"], (line) => {
          if (line.startsWith("\u0000")) return; // 内部控制行
          const message = normalizeDingTalkEvent(line);
          if (message) onMessage(message);
        }),
      );
    }
    return {
      stop: () => {
        for (const handle of handles) handle.stop();
      },
      done: Promise.race(handles.map((handle) => handle.done)),
    };
  }

  async status(): Promise<unknown> {
    return this.runner.runJson(["auth", "status"]);
  }
}
