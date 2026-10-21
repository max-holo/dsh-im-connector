import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProviderConfig {
  /** 是否接收入站消息（监听开关）。 */
  receive: boolean;
}

export interface PendingEntry {
  senderId: string;
  senderName?: string;
  lastText: string;
  firstSeenAt: number;
  lastSeenAt: number;
  notified: boolean;
}

export type ImConnectConfigData = {
  providers: Record<string, ProviderConfig>;
  /** 已批准的私聊发送者（provider → senderId[]），落盘。 */
  whitelist: Record<string, string[]>;
  /** 调试：允许处理「自己」发的消息（仅用于自测，生产默认关闭）。 */
  debug?: { allowSelf?: boolean };
  /** 远程指令：自己在群里发「<prefix> 指令」触发本机 Agent（仅本人账号生效）。 */
  command?: { enabled?: boolean; prefix?: string };
};

const DEFAULTS: ImConnectConfigData = {
  providers: {
    dingtalk: { receive: true },
    wecom: { receive: false },
  },
  whitelist: {},
  debug: { allowSelf: false },
  command: { enabled: true, prefix: "AI:" },
};

const PENDING_LIMIT = 50;

export function resolveDataDir(): string {
  const dir = join(process.env.TEMP ?? "/tmp", "im-connect");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 连接器配置：按需读写 JSON 文件（无内存缓存，任何实例读到最新状态）。 */
export class JsonConfigStore {
  /** 待批准列表（易变，内存态；重启后清空，发送者再次私聊会重新进入）。 */
  private pending: Record<string, PendingEntry[]> = {};

  constructor(private readonly file: string) {}

  getReceive(providerId: string): boolean {
    return this.load().providers[providerId]?.receive ?? false;
  }

  setReceive(providerId: string, enabled: boolean): void {
    const data = this.load();
    data.providers[providerId] = { receive: enabled };
    this.save(data);
  }

  list(): Array<{ provider: string; receive: boolean }> {
    return Object.entries(this.load().providers).map(([provider, c]) => ({
      provider,
      receive: c.receive,
    }));
  }

  // ---------- 私聊准入白名单 ----------

  isApproved(providerId: string, senderId: string): boolean {
    return (this.load().whitelist[providerId] ?? []).includes(senderId);
  }

  /** 记录一条未批准的私聊；返回是否首次出现（用于一次性提示）。 */
  recordPending(
    providerId: string,
    entry: { senderId: string; senderName?: string; text: string },
  ): boolean {
    const list = (this.pending[providerId] ??= []);
    const existing = list.find((p) => p.senderId === entry.senderId);
    const now = Date.now();
    if (existing) {
      existing.lastText = entry.text.slice(0, 200);
      existing.lastSeenAt = now;
      return false;
    }
    list.push({
      senderId: entry.senderId,
      senderName: entry.senderName,
      lastText: entry.text.slice(0, 200),
      firstSeenAt: now,
      lastSeenAt: now,
      notified: false,
    });
    if (list.length > PENDING_LIMIT) list.shift();
    return true;
  }

  markNotified(providerId: string, senderId: string): void {
    const entry = (this.pending[providerId] ?? []).find((p) => p.senderId === senderId);
    if (entry) entry.notified = true;
  }

  listPending(providerId: string): PendingEntry[] {
    return [...(this.pending[providerId] ?? [])].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  /** 批准/拒绝一条待批准私聊。批准则进白名单（落盘）。 */
  approve(providerId: string, senderId: string, approved: boolean): { ok: boolean } {
    const list = this.pending[providerId] ?? [];
    const idx = list.findIndex((p) => p.senderId === senderId);
    if (idx < 0) return { ok: false };
    list.splice(idx, 1);
    if (approved) {
      const data = this.load();
      const wl = data.whitelist[providerId] ?? [];
      if (!wl.includes(senderId)) {
        data.whitelist[providerId] = [...wl, senderId];
        this.save(data);
      }
    }
    return { ok: true };
  }

  listWhitelist(providerId: string): string[] {
    return [...(this.load().whitelist[providerId] ?? [])];
  }

  /** 调试开关：是否允许处理自己发送的消息（自测用）。 */
  getAllowSelf(): boolean {
    return Boolean(this.load().debug?.allowSelf);
  }

  /** 远程指令配置：enabled + prefix。 */
  getCommand(): { enabled: boolean; prefix: string } {
    const c = this.load().command;
    return { enabled: c?.enabled ?? true, prefix: c?.prefix || "AI:" };
  }

  setCommand(patch: { enabled?: boolean; prefix?: string }): void {
    const data = this.load();
    data.command = {
      enabled: patch.enabled ?? data.command?.enabled ?? true,
      prefix: patch.prefix || data.command?.prefix || "AI:",
    };
    this.save(data);
  }

  private load(): ImConnectConfigData {
    try {
      const loaded = JSON.parse(readFileSync(this.file, "utf8")) as Partial<ImConnectConfigData>;
      return {
        providers: { ...DEFAULTS.providers, ...(loaded.providers ?? {}) },
        whitelist: loaded.whitelist ?? {},
        debug: { ...DEFAULTS.debug, ...(loaded.debug ?? {}) },
        command: { ...DEFAULTS.command, ...(loaded.command ?? {}) },
      };
    } catch {
      return {
        providers: { ...DEFAULTS.providers },
        whitelist: {},
        debug: { ...DEFAULTS.debug },
        command: { ...DEFAULTS.command },
      };
    }
  }

  private save(data: ImConnectConfigData): void {
    try {
      writeFileSync(this.file, JSON.stringify(data, null, 2));
    } catch {
      /* 落盘失败不阻断 */
    }
  }
}
