import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function dataDirOf(ctx: EngineContext): string {
  const dir = ctx.baseDir ?? join(process.env.TEMP ?? "/tmp", "im-connect");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dataFile(ctx: EngineContext): string {
  return join(dataDirOf(ctx), "session-map.json");
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
  /** 调试：是否允许处理「自己」发的消息（自测用，生产默认返回 false）。 */
  allowSelf?: () => boolean;
  /** 回复收集的静默判定时长（毫秒），默认 2500；测试可调小。 */
  replyIdleMs?: number;
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

/**
 * 回收孤儿监听：插件重装/重激活时，上一次实例遗留的 dws listen 进程不会随
 * 卸载回调可靠终止（Loader 不一定触发 dispose），启动前统一清理。
 * 只匹配 node.exe 且命令行含 listen-im 的进程，不影响 DSH Host 自身。
 */
function reclaimOrphanListeners(): void {
  if (process.platform !== "win32") return;
  try {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'listen-im' -and $_.CommandLine -notmatch 'tsx' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { windowsHide: true },
    );
  } catch {
    /* ignore */
  }
}

export function createEngine(
  ctx: EngineContext,
  channels: ImChannel[] = listChannels(),
  opts: EngineOptions = {},
): () => void {
  reclaimOrphanListeners();
  const log = ctx.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const store = new JsonSessionMap(dataFile(ctx));
  const activeStops = new Set<() => void>();
  const selfIds = new Set<string>();
  const selfNames = new Set<string>();
  let disposed = false;

  // 代际守卫：Loader 卸载时不保证触发 dispose，旧实例的监督循环会不断复活监听。
  // 每次激活写入新代际标记；旧代际的循环与派发据此自动失效。
  const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const generationFile = join(dataDirOf(ctx), "engine-generation");
  try {
    writeFileSync(generationFile, generation);
  } catch {
    /* ignore */
  }
  const isCurrentGeneration = (): boolean => {
    try {
      return readFileSync(generationFile, "utf8").trim() === generation;
    } catch {
      return false;
    }
  };

  const dispatch = async (channel: ImChannel, message: ImInboundMessage): Promise<void> => {
    if (disposed || !isCurrentGeneration()) return;
    // 诊断日志：精确定位派发链路卡点（写文件，Host 内可观察）。
    const diag = (line: string): void => {
      try {
        appendFileSync(join(dataDirOf(ctx), "dispatch.log"), `${new Date().toISOString()} ${line}\n`);
      } catch {
        /* ignore */
      }
    };
    diag(`recv provider=${channel.providerId} conv=${message.conversationId} type=${message.conversationType} sender=${message.senderName ?? message.senderId ?? "?"} at=${String(message.mentionedBot)} text=${message.text.slice(0, 40)}`);
    try {
      if (opts.isEnabled && !opts.isEnabled(channel.providerId)) return;
      const target: ImSendTarget =
        message.conversationType === "direct"
          ? {
              conversationId: message.conversationId,
              kind: "direct",
              userId: message.senderId,
              openDingTalkId: message.senderOpenDingTalkId,
            }
          : { conversationId: message.conversationId, kind: "group" };
      const isApproved = opts.access
        ? (senderId: string) => opts.access!.isApproved(channel.providerId, senderId)
        : undefined;
      if (!gateAllows(message, selfIds, isApproved, selfNames, opts.allowSelf?.() ?? false)) {
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
      diag(`session=${sessionId}`);
      const requestId = `im-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      // prompt 前先 resolve/resume 会话的 Agent
      await ctx.sessionController.resolveAgent(sessionId);
      diag("resolveAgent ok");
      await ctx.sessionController.prompt(
        {
          requestId,
          sessionId,
          mode: "queue",
          content: [{ type: "text", text: message.text }],
        },
        new AbortController().signal,
      );
      diag("prompt accepted, collecting reply");
      const reply = await collectReply(
        ctx,
        sessionId,
        (e) => diag(`collect error: ${(e as Error)?.message ?? String(e)}`),
        { idleMs: opts.replyIdleMs },
      );
      diag(`collected ${reply.length} chars: ${reply.slice(0, 80)}`);
      if (reply.trim()) {
        await channel.sendText(target, reply.trim());
        diag(`sendText ok (group=${target.kind === "group" ? target.conversationId : target.openDingTalkId})`);
        log.info(`[im-connect] replied to ${channel.providerId}:${message.conversationId}`);
      } else {
        diag("empty reply, skip send");
      }
    } catch (e) {
      diag(`ERROR ${(e as Error)?.message ?? String(e)}`);
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
    while (!disposed && isCurrentGeneration()) {
      let handle: { stop: () => void; done: Promise<void> } | undefined;
      try {
        log.info(`[im-connect] ${channel.providerId} listener starting`);
        handle = await channel.listen((m) => {
          void dispatch(channel, m);
        });
        // 监听建立期间可能已被新代际取代：立即停掉，避免竞态泄漏。
        if (disposed || !isCurrentGeneration()) {
          try {
            handle.stop();
          } catch {
            /* ignore */
          }
          break;
        }
        activeStops.add(handle.stop);
        // 解析“自己”的身份，防止把自己发出的回复当新消息形成回环
        try {
          const status = (await channel.status()) as {
            user_id?: string;
            userid?: string;
            user_name?: string;
            user_name_en?: string;
          };
          const selfId = status.user_id ?? status.userid;
          if (selfId) selfIds.add(String(selfId));
          if (status.user_name) selfNames.add(status.user_name);
        } catch {
          /* 身份解析失败不影响监听 */
        }
        await handle.done;
      } catch (e) {
        log.warn(`[im-connect] ${channel.providerId} listen failed: ${String(e)}`);
      }
      if (handle) activeStops.delete(handle.stop);
      if (disposed || !isCurrentGeneration()) break;
      // 重启前先确保旧句柄已停止（避免旧监听进程残留在同一实例的多次重启中累积）
      try {
        handle?.stop();
      } catch {
        /* ignore */
      }
      log.warn(`[im-connect] ${channel.providerId} listener ended, restarting in ${backoff}ms`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  };

  // 启动各渠道监听（含监督重启）。监听常驻，接收开关只在派发层生效——
  // 这样开关两个方向都能立即生效，不需要重启插件/DSH。
  for (const channel of channels) {
    log.info(
      `[im-connect] ${channel.providerId} listener starting (receive=${
        opts.isEnabled ? opts.isEnabled(channel.providerId) : true
      })`,
    );
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
    // 兜底：清理竞态窗口内未登记句柄而残留的监听进程。
    reclaimOrphanListeners();
  };
  ctx.onDispose?.(stop);
  return stop;
}

/** 准入：跳过自己；群聊必须显式 @ 机器人；私聊需在白名单（未配置白名单则放行）。 */
export function gateAllows(
  message: ImInboundMessage,
  selfIds: ReadonlySet<string>,
  isApproved?: (senderId: string) => boolean,
  selfNames?: ReadonlySet<string>,
  allowSelf = false,
): boolean {
  if (!allowSelf) {
    if (message.senderId && selfIds.has(message.senderId)) return false;
    // 钉钉事件只带 sender 名称（无 staffId），用名字兜底跳过自己
    if (selfNames && message.senderName && selfNames.has(message.senderName)) return false;
  }
  if (message.conversationType === "group") return message.mentionedBot === true;
  if (!message.senderId) return false;
  return isApproved ? isApproved(message.senderId) : true;
}

/**
 * 自检：在本机跑一轮真实的 Agent 回合（建会话 → 派发 → 收集回复），
 * 用于验证「引擎 → 会话 → 回复」整条链路，不依赖 IM 收发。
 */
export async function runSelfTest(ctx: EngineContext): Promise<{
  ok: boolean;
  sessionId?: string;
  reply?: string;
  elapsedMs?: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    const created = await ctx.sessionController.create({});
    const sessionId = created.sessionId;
    await ctx.sessionController.resolveAgent(sessionId);
    await ctx.sessionController.prompt(
      {
        requestId: `selftest-${Date.now().toString(36)}`,
        sessionId,
        mode: "queue",
        content: [{ type: "text", text: "自检：请只回复「自检通过」四个字，不要调用任何工具。" }],
      },
      new AbortController().signal,
    );
    const reply = await collectReply(ctx, sessionId);
    return { ok: true, sessionId, reply: reply.trim(), elapsedMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e), elapsedMs: Date.now() - started };
  }
}

/** 跟随会话流收集本轮回复文本。
 * 兼容 LLM 重试（可能先出现一次 end 再重新 start）：收到 end 后若静默 idleMs
 * 才视为本轮结束；总时长上限 maxMs。 */
async function collectReply(
  ctx: EngineContext,
  sessionId: string,
  onError?: (e: unknown) => void,
  opts: { idleMs?: number; maxMs?: number } = {},
): Promise<string> {
  const idleMs = opts.idleMs ?? 2_500;
  const maxMs = opts.maxMs ?? 180_000;
  const ac = new AbortController();
  const parts: string[] = [];
  const queue: Array<{ type: "start" } | { type: "chunk"; chunk: unknown } | { type: "end" }> = [];
  let finished = false;
  let sawEnd = false;
  let lastActivity = Date.now();
  const startedAt = Date.now();

  // 后台消费：把 follow 流里的 assistant-stream 帧推进队列
  void (async () => {
    try {
      const frames = ctx.sessionController.follow(
        { address: { kind: "session", sessionId }, assistantStream: true },
        ac.signal,
      );
      for await (const frame of frames) {
        if (frame.type !== "assistant-stream") continue;
        queue.push(frame.frame);
      }
    } catch (e) {
      onError?.(e);
    } finally {
      finished = true;
    }
  })();

  while (Date.now() - startedAt < maxMs) {
    const frame = queue.shift();
    if (frame) {
      lastActivity = Date.now();
      if (frame.type === "chunk") {
        const c = frame.chunk as { type?: string; text?: string } | null;
        if (c && typeof c === "object" && c.type === "text-delta" && typeof c.text === "string") {
          parts.push(c.text);
        }
      } else if (frame.type === "end") {
        sawEnd = true;
      } else if (frame.type === "start") {
        sawEnd = false; // 新一轮尝试开始，重置结束判定
      }
      continue;
    }
    if (finished) break;
    // 已看到 end 且静默超过 idleMs → 本轮结束
    if (sawEnd && Date.now() - lastActivity > idleMs) break;
    await new Promise((r) => setTimeout(r, Math.min(100, Math.max(10, Math.floor(idleMs / 2)))));
  }
  ac.abort();
  return parts.join("");
}
