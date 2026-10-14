import { appendFile, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** 一条被 Stream 捕获的钉钉消息。 */
export interface CapturedMessage {
  /** 本地捕获时间（ISO-8601）。 */
  capturedAt: string;
  /** Stream topic（如 /v1.0/im/bot/messages/get）。 */
  topic?: string;
  /** 消息 ID。 */
  msgId?: string;
  /** 会话 ID（群聊 conversationId / 单聊 conversationId）。 */
  conversationId?: string;
  /** "1"=单聊，"2"=群聊。 */
  conversationType?: string;
  /** 发送者 userId（企业内）。 */
  senderStaffId?: string;
  senderNick?: string;
  senderCorpId?: string;
  robotCode?: string;
  msgtype?: string;
  /** 提取出的文本内容（仅 text 消息），其它类型看 raw。 */
  content?: string | null;
  /** 消息产生时间（Unix 毫秒，钉钉侧）。 */
  createAt?: number;
  /** 原始消息体。 */
  raw?: unknown;
}

export interface CapturedMessageFilter {
  conversationId?: string;
  conversationType?: string;
  senderStaffId?: string;
  senderNick?: string;
  keyword?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * 说明：钉钉开放平台不提供任意历史消息读取 API（合规限制）。
 * 本连接器通过 Stream 模式实时接收机器人所在会话的消息并落盘，
 * 之后即可用 messages.listCapturedMessages() 读取。
 */
export function appendCapturedMessage(file: string, message: CapturedMessage): void {
  const dir = dirname(file);
  if (dir && dir !== "." && dir !== file) {
    mkdirSync(dir, { recursive: true });
  }
  appendFile(file, JSON.stringify(message) + "\n", "utf8", () => {
    // 异步追加；读取端容错坏行。
  });
}

export function readCapturedMessages(file: string): CapturedMessage[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const messages: CapturedMessage[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as CapturedMessage);
    } catch {
      // skip corrupted line
    }
  }
  return messages;
}

export function filterCapturedMessages(
  messages: CapturedMessage[],
  filter: CapturedMessageFilter,
): CapturedMessage[] {
  const from = filter.from ? Date.parse(filter.from) : undefined;
  const to = filter.to ? Date.parse(filter.to) : undefined;
  const keyword = filter.keyword?.toLowerCase();
  let result = messages.filter((m) => {
    if (filter.conversationId && m.conversationId !== filter.conversationId) return false;
    if (filter.conversationType && m.conversationType !== filter.conversationType) return false;
    if (filter.senderStaffId && m.senderStaffId !== filter.senderStaffId) return false;
    if (filter.senderNick && m.senderNick !== filter.senderNick) return false;
    if (keyword && !(m.content ?? "").toLowerCase().includes(keyword)) return false;
    if (from !== undefined && Date.parse(m.capturedAt) < from) return false;
    if (to !== undefined && Date.parse(m.capturedAt) > to) return false;
    return true;
  });
  result = result.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  if (filter.limit && filter.limit > 0) result = result.slice(0, filter.limit);
  return result;
}

/** 把 Stream 下行帧（机器人消息）规范化为 CapturedMessage。 */
export function normalizeRobotMessage(downstream: {
  headers?: { topic?: string };
  data: string;
}): CapturedMessage {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(downstream.data) as Record<string, unknown>;
  } catch {
    data = { rawText: downstream.data };
  }
  const text = data.text as { content?: string } | undefined;
  return {
    capturedAt: new Date().toISOString(),
    topic: downstream.headers?.topic,
    msgId: data.msgId as string | undefined,
    conversationId: data.conversationId as string | undefined,
    conversationType: data.conversationType as string | undefined,
    senderStaffId: data.senderStaffId as string | undefined,
    senderNick: data.senderNick as string | undefined,
    senderCorpId: data.senderCorpId as string | undefined,
    robotCode: data.robotCode as string | undefined,
    msgtype: data.msgtype as string | undefined,
    content: data.msgtype === "text" ? (text?.content ?? null) : null,
    createAt: data.createAt as number | undefined,
    raw: data,
  };
}

export interface CaptureHandle {
  stop(): void;
}

/**
 * 启动 Stream 模式消息捕获（需要应用开通"机器人-Stream 模式"）。
 * 收到的机器人消息会写入 captureFile（JSONL），并触发 onMessage 回调。
 */
export async function startMessageCapture(opts: {
  appKey: string;
  appSecret: string;
  captureFile: string;
  onMessage?: (message: CapturedMessage) => void;
  onError?: (error: unknown) => void;
  log?: (message: string) => void;
}): Promise<CaptureHandle> {
  const { DWClient, TOPIC_ROBOT } = await import("dingtalk-stream");
  const client = new DWClient({
    clientId: opts.appKey,
    clientSecret: opts.appSecret,
  });
  client.registerCallbackListener(TOPIC_ROBOT, (downstream: { headers: { topic?: string }; data: string }) => {
    try {
      const message = normalizeRobotMessage(downstream);
      appendCapturedMessage(opts.captureFile, message);
      opts.onMessage?.(message);
    } catch (e) {
      opts.onError?.(e);
    }
  });
  opts.log?.(`Connecting to DingTalk Stream (topic ${TOPIC_ROBOT}) ...`);
  await client.connect();
  opts.log?.("Stream capture connected. Waiting for messages ...");
  return {
    stop: () => {
      try {
        client.disconnect();
      } catch (e) {
        opts.onError?.(e);
      }
    },
  };
}

