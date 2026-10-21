import { dingtalk } from "../providers/dingtalk.js";
import { CliRunner } from "../cli/runner.js";
import type { ImChannel, ImInboundMessage, ImSendTarget } from "./types.js";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function extractText(data: Record<string, unknown>): string | undefined {
  const text = data.text as Record<string, unknown> | undefined;
  if (text && typeof text.content === "string" && text.content) return text.content;
  return str(data.content) ?? str(data.text);
}

/**
 * 把 dws event 的 NDJSON 行（transport envelope 或扁平 payload）归一为 ImInboundMessage。
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
  const conversationId = str(data.conversationId) ?? str(data.groupId) ?? str(data.openConversationId);
  const text = extractText(data);
  if (!conversationId || !text) return null;
  return {
    conversationId,
    conversationType: data.conversationType === "1" ? "direct" : "group",
    senderId: str(data.senderStaffId) ?? str(data.senderId),
    senderName: str(data.senderNick) ?? str(data.senderName),
    text,
    mentionedBot:
      typeof data.mentionedBot === "boolean"
        ? data.mentionedBot
        : typeof data.isAtBot === "boolean"
          ? data.isAtBot
          : undefined,
    raw: data,
  };
}

/**
 * 钉钉渠道（基于 dws）：
 * - 收：`dws event +listen-im --kind all-group`（Stream 长连接，NDJSON）
 * - 发：`dws chat +messages-send`（用户身份发送）
 * - 状态：`dws auth status`
 */
export class DingTalkChannel implements ImChannel {
  readonly providerId = "dingtalk";
  private readonly runner: CliRunner;

  constructor(runner?: CliRunner) {
    this.runner = runner ?? new CliRunner(dingtalk);
  }

  async sendText(target: ImSendTarget, text: string): Promise<unknown> {
    return this.runner.runJson([
      "chat",
      "+messages-send",
      "--group",
      target.conversationId,
      "--markdown",
      text,
      "--identity",
      "user",
      "--yes",
    ]);
  }

  async listen(onMessage: (m: ImInboundMessage) => void): Promise<{ stop: () => void }> {
    return this.runner.stream(
      ["event", "+listen-im", "--kind", "all-group", "--format", "ndjson"],
      (line) => {
        if (line.startsWith("\u0000")) return; // 内部控制行
        const message = normalizeDingTalkEvent(line);
        if (message) onMessage(message);
      },
    );
  }

  async status(): Promise<unknown> {
    return this.runner.runJson(["auth", "status"]);
  }
}
