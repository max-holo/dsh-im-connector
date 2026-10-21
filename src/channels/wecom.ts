import { wecom } from "../providers/wecom.js";
import { CliRunner } from "../cli/runner.js";
import type { ImChannel, ImInboundMessage, ImSendTarget } from "./types.js";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 从 wecom-cli 响应中取业务负载（响应包在 results_json 内）。 */
function unwrap(payload: unknown): Record<string, unknown> {
  const root = payload as Record<string, unknown> | null;
  if (root && typeof root.results_json === "object" && root.results_json) {
    return root.results_json as Record<string, unknown>;
  }
  return root ?? {};
}

/** 宽松取数组：兼容 items / list / data.items / chat_record / group_chat_list 等形态。 */
function pickArray(payload: unknown, keys: string[]): Array<Record<string, unknown>> {
  const root = unwrap(payload);
  const candidates: unknown[] = [root, root.data];
  for (const base of candidates) {
    if (!base || typeof base !== "object") continue;
    const obj = base as Record<string, unknown>;
    for (const key of keys) {
      const v = obj[key];
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
    }
  }
  return [];
}

/** 从「有消息的群列表」响应提取群会话 id。 */
export function extractGroupIds(payload: unknown): string[] {
  const ids: string[] = [];
  for (const item of pickArray(payload, ["items", "list", "groups", "group_chat_list", "chat_list"])) {
    const id = str(item.chat_id) ?? str(item.chatid) ?? str(item.group_id) ?? str(item.id);
    if (id) ids.push(id);
  }
  return ids;
}

/** 从「会话消息列表」响应归一为入站消息（去重由调用方按 id 处理）。 */
export function normalizeWecomMessages(payload: unknown): Array<{ id: string; message: ImInboundMessage }> {
  const out: Array<{ id: string; message: ImInboundMessage }> = [];
  for (const item of pickArray(payload, ["items", "list", "messages", "chat_record"])) {
    const id = str(item.msg_id) ?? str(item.message_id) ?? str(item.id);
    const text =
      typeof (item.text as Record<string, unknown> | undefined)?.content === "string"
        ? ((item.text as Record<string, unknown>).content as string)
        : str(item.content) ?? str(item.text);
    const chatId = str(item.chat_id) ?? str(item.conversation_id) ?? str(item.group_id);
    const senderName = str(item.sender_name) ?? str(item.sender) ?? str(item.sender_nick);
    if (!id || !chatId || !text) continue;
    out.push({
      id,
      message: {
        conversationId: chatId,
        conversationType: "group",
        senderId: str(item.sender_id) ?? str(item.sender_staff_id),
        senderName,
        text,
        raw: item,
      },
    });
  }
  return out;
}

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 企业微信渠道（基于 wecom-cli）：
 * - 发：`wecom-cli message send --chat-id <id> --msg-type text --text '{"content":"..."}'`
 * - 收：轮询 `chat groups list` + `chat messages list`（wecom-cli 无推送；
 *   需企业已开通会话读取能力，否则返回 853006）
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

  /** 获取最近有消息的群列表。 */
  async listGroups(beginTime: string, endTime: string): Promise<unknown> {
    return this.runner.runJson(["chat", "groups", "list", "--begin-time", beginTime, "--end-time", endTime]);
  }

  /**
   * 轮询式入站监听：每 intervalMs 拉一次有消息的群，再拉各群窗口内消息，去重后回调。
   * 单轮失败静默跳过，下一轮重试。
   */
  async listen(
    onMessage: (m: ImInboundMessage) => void,
    opts?: { intervalMs?: number; overlapMs?: number },
  ): Promise<{ stop: () => void; done: Promise<void> }> {
    const intervalMs = opts?.intervalMs ?? 15_000;
    const overlapMs = opts?.overlapMs ?? 5_000;
    const seen = new Set<string>();
    let stopped = false;
    let lastEnd = Date.now();
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    const poll = async (): Promise<void> => {
      if (stopped) return;
      const begin = new Date(lastEnd - overlapMs);
      const end = new Date();
      lastEnd = end.getTime();
      try {
        const groups = await this.listGroups(fmtLocal(begin), fmtLocal(end));
        for (const chatId of extractGroupIds(groups)) {
          try {
            const payload = await this.listMessages(chatId, fmtLocal(begin), fmtLocal(end));
            for (const { id, message } of normalizeWecomMessages(payload)) {
              if (seen.has(id)) continue;
              seen.add(id);
              if (seen.size > 2000) {
                // 有界去重：清一半保留近期
                const keep = [...seen].slice(-1000);
                seen.clear();
                for (const k of keep) seen.add(k);
              }
              onMessage(message);
            }
          } catch {
            /* 单个群失败不影响其它群 */
          }
        }
      } catch {
        /* 单轮失败，下轮重试 */
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    return {
      stop: () => {
        stopped = true;
        clearInterval(timer);
        resolveDone();
      },
      done,
    };
  }

  async status(): Promise<unknown> {
    return this.runner.runJson(["auth", "show", "--status"]);
  }
}
