import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProviderConfig {
  /** 是否接收入站消息（监听开关）。 */
  receive: boolean;
}

export type ImConnectConfigData = { providers: Record<string, ProviderConfig> };

const DEFAULTS: ImConnectConfigData = {
  providers: {
    dingtalk: { receive: true },
    wecom: { receive: false },
  },
};

export function resolveDataDir(): string {
  const dir = join(process.env.TEMP ?? "/tmp", "im-connect");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 连接器配置：按需读写 JSON 文件（无内存缓存，任何实例读到最新状态）。 */
export class JsonConfigStore {
  constructor(private readonly file: string) {}

  getReceive(providerId: string): boolean {
    return this.load().providers[providerId]?.receive ?? false;
  }

  setReceive(providerId: string, enabled: boolean): void {
    const data = this.load();
    data.providers[providerId] = { receive: enabled };
    try {
      writeFileSync(this.file, JSON.stringify(data, null, 2));
    } catch {
      /* 落盘失败不阻断 */
    }
  }

  list(): Array<{ provider: string; receive: boolean }> {
    return Object.entries(this.load().providers).map(([provider, c]) => ({
      provider,
      receive: c.receive,
    }));
  }

  private load(): ImConnectConfigData {
    try {
      const loaded = JSON.parse(readFileSync(this.file, "utf8")) as Partial<ImConnectConfigData>;
      return { providers: { ...DEFAULTS.providers, ...(loaded.providers ?? {}) } };
    } catch {
      return { providers: { ...DEFAULTS.providers } };
    }
  }
}
