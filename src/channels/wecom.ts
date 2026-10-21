import { wecom } from "../providers/wecom.js";
import { CliRunner } from "../cli/runner.js";
import type { ImChannel, ImInboundMessage, ImSendTarget } from "./types.js";

/**
 * 企业微信渠道（基于 wecom-cli）：
 * - 发：`wecom-cli message send --chat-id <id> --msg-type text --text '{"content":"..."}'`
 * - 收：wecom-cli 无推送监听，轮询 `chat messages list`（Phase 2 由 engine 的 timer 驱动，
 *   本类提供 listMessages 供轮询；此处 listen 返回明确的能力边界提示）
 * - 状态：`wecom-cli auth show --status`
 */
export class WeComChannel implements ImChannel {
  readonly providerId = "wecom";
  private readonly runner: CliRunner;

  constructor(runner?: CliRunner) {
    this.runner = runner ?? new CliRunner(wecom);
  }

  async sendText(target: ImSendTarget, text: string): Promise<unknown> {
    return this.runner.runJson([
      "message",
      "send",
      "--chat-id",
      target.conversationId,
      "--msg-type",
      "text",
      "--text",
      JSON.stringify({ content: text }),
    ]);
  }

  /** 分页拉取指定会话的消息（供轮询式监听使用）。时间格式 YYYY-MM-DD HH:MM:SS。 */
  async listMessages(
    conversationId: string,
    beginTime: string,
    endTime: string,
    opts?: { cursor?: string },
  ): Promise<unknown> {
    return this.runner.runJson([
      "chat",
      "messages",
      "list",
      "--chat-id",
      conversationId,
      "--begin-time",
      beginTime,
      "--end-time",
      endTime,
      ...(opts?.cursor ? ["--cursor", opts.cursor] : []),
    ]);
  }

  async listen(_onMessage: (m: ImInboundMessage) => void): Promise<{ stop: () => void }> {
    // wecom-cli 无推送能力；轮询实现（timer + listMessages + 游标去重）在 Phase 2 与
    // engine 一起落地，届时需要先按真实响应形状对齐字段。
    return { stop: () => undefined };
  }

  async status(): Promise<unknown> {
    return this.runner.runJson(["auth", "show", "--status"]);
  }
}
