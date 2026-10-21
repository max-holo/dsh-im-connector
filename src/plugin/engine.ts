import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listChannels } from "../channels/registry.js";
import type { ImChannel, ImInboundMessage, ImSendTarget } from "../channels/types.js";

/** 最小化 Host 结构类型：插件在 DSH Host 内运行，避免硬依赖 DSH 类型包。 */

interface SessionControllerLike {
  resolveAgent(sessionId: string): Promise<{ agent?: unknown; error?: unknown }>;
  create(request: { cwd?: string; agentPreset?: string }): Promise<{ sessionId: string }>;
  prompt(
    request: {
      requestId: string;
      sessionId: string;
      mode: "queue" | "steer";
      content: Array<{ type: "text"; text: string }>;
      clientTimeZone?: string;
    },
    signal: AbortSignal,
  ): Promise<{ accepted: true }>;
  follow(
    request: { address: { kind: "session"; sessionId: string }; assistantStream?: true },
    signal: AbortSignal,
  ): AsyncIterable<FollowFrame>;
}

type FollowFrame =
  | { type: "snapshot" | "event" }
  | { type: "assistant-stream"; frame: StreamFrame };

type StreamFrame =
  | { type: "start" }
  | { type: "chunk"; chunk: unknown }
  | { type: "end" };

export interface EngineContext {
  sessionController: SessionControllerLike;
  baseDir?: string;
  logger?: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  /** 插件卸载钩子（cordis ctx.on('dispose')）。 */
  onDispose?(fn: () => void): void;
}

/** IM 会话 ↔ DSH 会话映射，文件落盘。 */
class JsonSessionMap {
  private data: Record<string, string> = {};
  constructor(private readonly file: string) {
    try {
      this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      this.data = {};
    }
  }
  get(key: string): string | undefined {
    return this.data[key];
  }
  put(key: string, sessionId: string): void {
    this.data[key] = sessionId;
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch {
      /* 落盘失败不阻断流程 */
    }
  }
}

function dataFile(ctx: EngineContext): string {
  const dir = ctx.baseDir ?? join(process.env.TEMP ?? "/tmp", "im-connect");
  mkdirSync(dir, { recursive: true });
  return join(dir, "session-map.json");
}

/**
 * 平台无关引擎：
 * 入站消息 → Gate 准入（群聊必须 @、跳过自己）→ Router（会话映射）→
 * Dispatcher（resolveAgent → prompt → follow 收集回复 → 渠道回发）。
 * 渠道只收发；引擎不写死任何平台名。
 */
export interface EngineOptions {
  /** 平台级接收开关。 */
  isEnabled?: (providerId: string) => boolean;
  /** 私聊准入：白名单判定 + 待批准登记。 */
  access?: {
    isApproved(providerId: string, senderId: string): boolean;
    /** 返回是否首次出现（用于一次性提示）。 */
    recordPending(
      providerId: string,
      message: { senderId: string; senderName?: string; text: string },
    ): boolean;
    markNotified(providerId: string, senderId: string): void;
  };
}

const PENDING_NOTICE = "【IM 连接】你的消息已进入待批准列表，管理员批准后即可与本机助手对话。";

export function createEngine(
  ctx: EngineContext,
  channels: ImChannel[] = listChannels(),
  opts: EngineOptions = {},
): () => void {
  const log = ctx.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const store = new JsonSessionMap(dataFile(ctx));
  const activeStops = new Set<() => void>();
  const selfIds = new Set<string>();
  let disposed = false;

  const dispatch = async (channel: ImChannel, message: ImInboundMessage): Promise<void> => {
    if (disposed) return;
    try {
      if (opts.isEnabled && !opts.isEnabled(channel.providerId)) return;
      const target: ImSendTarget =
        message.conversationType === "direct"
          ? { conversationId: message.conversationId, kind: "direct", userId: message.senderId }
          : { conversationId: message.conversationId, kind: "group" };
      const isApproved = opts.access
        ? (senderId: string) => opts.access!.isApproved(channel.providerId, senderId)
        : undefined;
      if (!gateAllows(message, selfIds, isApproved)) {
        // 未批准的私聊：登记待批准，首次发一次性提示。
        if (
          opts.access &&
          message.conversationType === "direct" &&
          message.senderId &&
          !opts.access.isApproved(channel.providerId, message.senderId)
        ) {
          const first = opts.access.recordPending(channel.providerId, {
            senderId: message.senderId as string,
            senderName: message.senderName,
            text: message.text,
          });
          if (first) {
            opts.access.markNotified(channel.providerId, message.senderId);
            try {
              await channel.sendText(target, PENDING_NOTICE);
            } catch {
              /* 提示失败不阻断 */
            }
          }
        }
        return;
      }
      const key = `${channel.providerId}:${message.conversationId}`;
      let sessionId = store.get(key);
      if (!sessionId) {
        const created = await ctx.sessionController.create({});
        sessionId = created.sessionId;
        store.put(key, sessionId);
        log.info(`[im-connect] new session ${sessionId} for ${key}`);
      }
      const requestId = `im-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      // prompt 前先 resolve/resume 会话的 Agent
      await ctx.sessionController.resolveAgent(sessionId);
      await ctx.sessionController.prompt(
        {
          requestId,
          sessionId,
          mode: "queue",
          content: [{ type: "text", text: message.text }],
        },
        new AbortController().signal,
      );
      const reply = await collectReply(ctx, sessionId);
      if (reply.trim()) {
        await channel.sendText(target, reply.trim());
        log.info(`[im-connect] replied to ${channel.providerId}:${message.conversationId}`);
      }
    } catch (e) {
      log.error(`[im-connect] dispatch failed: ${(e as Error)?.message ?? String(e)}`);
    }
  };

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * 渠道监听监督：listen 意外退出（进程被杀/断连）后按退避重启，
   * 保证 Host 重启或监听进程崩溃后能自愈。
   */
  const supervise = async (channel: ImChannel): Promise<void> => {
    let backoff = 5_000;
    while (!disposed) {
      let handle: { stop: () => void; done: Promise<void> } | undefined;
      try {
        log.info(`[im-connect] ${channel.providerId} listener starting`);
        handle = await channel.listen((m) => {
          void dispatch(channel, m);
        });
        activeStops.add(handle.stop);
        // 解析“自己”的身份，防止把自己发出的回复当新消息形成回环
        try {
          const status = (await channel.status()) as {
            user_id?: string;
            userid?: string;
          };
          const selfId = status.user_id ?? status.userid;
          if (selfId) selfIds.add(String(selfId));
        } catch {
          /* 身份解析失败不影响监听 */
        }
        await handle.done;
      } catch (e) {
        log.warn(`[im-connect] ${channel.providerId} listen failed: ${String(e)}`);
      }
      if (handle) activeStops.delete(handle.stop);
      if (disposed) break;
      log.warn(`[im-connect] ${channel.providerId} listener ended, restarting in ${backoff}ms`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  };

  // 启动各渠道监听（含监督重启）
  for (const channel of channels) {
    if (opts.isEnabled && !opts.isEnabled(channel.providerId)) {
      log.info(`[im-connect] ${channel.providerId} receive disabled, listener skipped`);
      continue;
    }
    void supervise(channel);
  }

  const stop = (): void => {
    disposed = true;
    for (const s of [...activeStops]) {
      try {
        s();
      } catch {
        /* ignore */
      }
    }
  };
  ctx.onDispose?.(stop);
  return stop;
}

/** 准入：跳过自己；群聊必须显式 @ 机器人；私聊需在白名单（未配置白名单则放行）。 */
export function gateAllows(
  message: ImInboundMessage,
  selfIds: ReadonlySet<string>,
  isApproved?: (senderId: string) => boolean,
): boolean {
  if (message.senderId && selfIds.has(message.senderId)) return false;
  if (message.conversationType === "group") return message.mentionedBot === true;
  if (!message.senderId) return false;
  return isApproved ? isApproved(message.senderId) : true;
}

/** 跟随会话流收集本轮回复文本（text-delta 拼接，end 即止）。 */
async function collectReply(ctx: EngineContext, sessionId: string): Promise<string> {
  const ac = new AbortController();
  const parts: string[] = [];
  try {
    const frames = ctx.sessionController.follow(
      { address: { kind: "session", sessionId }, assistantStream: true },
      ac.signal,
    );
    for await (const frame of frames) {
      if (frame.type !== "assistant-stream") continue;
      const f = frame.frame;
      if (f.type === "chunk") {
        const c = f.chunk as { type?: string; text?: string } | null;
        if (c && typeof c === "object" && c.type === "text-delta" && typeof c.text === "string") {
          parts.push(c.text);
        }
      } else if (f.type === "end") {
        ac.abort();
        break;
      }
    }
  } catch {
    /* stream closed / aborted */
  }
  return parts.join("");
}
