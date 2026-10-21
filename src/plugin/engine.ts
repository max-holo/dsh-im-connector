import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listChannels } from "../channels/registry.js";
import type { ImChannel, ImInboundMessage } from "../channels/types.js";

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
export function createEngine(
  ctx: EngineContext,
  channels: ImChannel[] = listChannels(),
  opts: { isEnabled?: (providerId: string) => boolean } = {},
): () => void {
  const log = ctx.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const store = new JsonSessionMap(dataFile(ctx));
  const stops: Array<() => void> = [];
  const selfIds = new Set<string>();
  let disposed = false;

  const dispatch = async (channel: ImChannel, message: ImInboundMessage): Promise<void> => {
    if (disposed) return;
    try {
      if (opts.isEnabled && !opts.isEnabled(channel.providerId)) return;
      if (!gateAllows(message, selfIds)) return;
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
        await channel.sendText({ conversationId: message.conversationId }, reply.trim());
        log.info(`[im-connect] replied to ${channel.providerId}:${message.conversationId}`);
      }
    } catch (e) {
      log.error(`[im-connect] dispatch failed: ${(e as Error)?.message ?? String(e)}`);
    }
  };

  // 启动各渠道监听
  void (async () => {
    for (const channel of channels) {
      if (opts.isEnabled && !opts.isEnabled(channel.providerId)) {
        log.info(`[im-connect] ${channel.providerId} receive disabled, listener skipped`);
        continue;
      }
      try {
        const handle = await channel.listen((m) => {
          void dispatch(channel, m);
        });
        stops.push(handle.stop);
        log.info(`[im-connect] ${channel.providerId} listener started`);
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
      } catch (e) {
        log.warn(`[im-connect] ${channel.providerId} listen failed: ${String(e)}`);
      }
    }
  })();

  const stop = (): void => {
    disposed = true;
    for (const s of stops) {
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

/** 准入：群聊必须显式 @ 机器人；跳过自己发送的消息（防回环）。 */
export function gateAllows(message: ImInboundMessage, selfIds: ReadonlySet<string>): boolean {
  if (message.senderId && selfIds.has(message.senderId)) return false;
  if (message.conversationType === "group") return message.mentionedBot === true;
  return true; // 私聊：P2 先放行，白名单在 P3
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
