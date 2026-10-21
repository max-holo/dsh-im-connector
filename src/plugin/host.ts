import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import QRCode from "qrcode";
import { listChannels } from "../channels/registry.js";
import { wecomHealth } from "../channels/wecom.js";
import type { ImChannel } from "../channels/types.js";
import { resolveDataDir, type JsonConfigStore } from "./config.js";

/** 登录超时：超时仍未完成则终止进程并标记 timeout。 */
const LOGIN_TIMEOUT_MS = 180_000;

export interface LoginState {
  state: "idle" | "waiting" | "authorized" | "failed" | "timeout";
  provider?: string;
  output: string;
  error?: string;
  /** 从输出中提取的授权 URL。 */
  url?: string;
  /** wecom-cli 用 --output-qrcode 直接写出的二维码 PNG 路径。 */
  qrFile?: string;
  startedAt: number;
  finishedAt?: number;
}

/** 各平台扫码命令：钉钉设备流（不自动开浏览器）；企微机器人授权（直接输出二维码 PNG）。 */
function loginCommand(provider: string): { bin: string; args: string[]; qrFile?: string } | null {
  if (provider === "dingtalk") {
    return { bin: "dws", args: ["auth", "login", "--device", "--no-browser"] };
  }
  if (provider === "wecom") {
    const qrFile = join(resolveDataDir(), "wecom-login-qr.png");
    return {
      bin: "wecom-cli",
      args: ["auth", "init", "--noninteractive", "--no-browser", "--output-qrcode", qrFile],
      qrFile,
    };
  }
  return null;
}

/** 从终端输出提取第一个授权链接。 */
export function extractLoginUrl(output: string): string | undefined {
  const m = output.match(/https?:\/\/[^\s"'<>)\]]+/);
  return m ? m[0] : undefined;
}

/** Host 侧管理面：扫码登录进程 + 状态聚合。 */
export class ImConnectHost {
  readonly config: JsonConfigStore;
  private login: LoginState = { state: "idle", output: "", startedAt: 0 };
  private loginChild?: ReturnType<typeof spawn>;
  /** 连接状态缓存（provider → 上次探测结果），避免每次 /state 都 spawn CLI。 */
  private readonly statusCache = new Map<
    string,
    { at: number; value: { connected: boolean; account?: string } }
  >();

  constructor(config: JsonConfigStore) {
    this.config = config;
  }

  startLogin(provider: string): { ok: boolean; error?: string } {
    const cmd = loginCommand(provider);
    if (!cmd) return { ok: false, error: `unknown provider: ${provider}` };
    if (this.login.state === "waiting") return { ok: false, error: "a login is already running" };
    this.login = { state: "waiting", provider, output: "", startedAt: Date.now(), qrFile: cmd.qrFile };
    const child = spawn(cmd.bin, cmd.args, {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.loginChild = child;
    const append = (chunk: Buffer): void => {
      this.login.output += chunk.toString("utf8");
      if (this.login.output.length > 20000) {
        this.login.output = this.login.output.slice(-20000);
      }
      if (!this.login.url) this.login.url = extractLoginUrl(this.login.output);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const finish = (code: number | null): void => {
      if (this.login.state !== "waiting") return;
      this.login.finishedAt = Date.now();
      this.login.state = code === 0 ? "authorized" : "failed";
      if (code !== 0) {
        this.login.error = summarizeOutput(this.login.output) ?? `登录进程退出码 ${code}`;
      }
    };
    child.on("exit", (code) => finish(code));
    return { ok: true };
  }

  getLoginStatus(): LoginState {
    // 超时看护：等待超过 LOGIN_TIMEOUT_MS 仍未完成 → 终止并标记
    if (this.login.state === "waiting" && Date.now() - this.login.startedAt > LOGIN_TIMEOUT_MS) {
      this.killLoginChild();
      this.login.state = "timeout";
      this.login.finishedAt = Date.now();
      this.login.error = `登录未在 ${Math.round(LOGIN_TIMEOUT_MS / 1000)} 秒内完成`;
    }
    return { ...this.login };
  }

  /** 聚合各渠道的接收开关、连接状态、账号、待批准、能力健康度与远程指令配置。 */
  async collectState(): Promise<{
    providers: Array<{
      id: string;
      displayName: string;
      receive: boolean;
      connected: boolean;
      account?: string;
      receiveHealth?: { ok: boolean; reason?: string };
    }>;
    pending: Array<{
      provider: string;
      senderId: string;
      senderName?: string;
      lastText: string;
      firstSeenAt: number;
      lastSeenAt: number;
    }>;
    command: { enabled: boolean; prefix: string };
    triggers: { atMe: boolean };
  }> {
    const providers = [];
    const pending = [];
    for (const channel of listChannels()) {
      // 连接状态缓存 15s：每次 /state 都 spawn CLI 会拖慢页面（开关响应慢的主因之一）
      const cached = this.statusCache.get(channel.providerId);
      let connected: boolean;
      let account: string | undefined;
      if (cached && Date.now() - cached.at < 15_000) {
        ({ connected, account } = cached.value);
      } else {
        try {
          const status = (await channel.status()) as
            | string
            | {
                authenticated?: boolean;
                token_valid?: boolean;
                user_name?: string;
                corp_name?: string;
              };
          if (typeof status === "string") {
            connected = status.trim() === "authorized";
            account = connected ? "已授权" : undefined;
          } else if (status && typeof status === "object") {
            connected = Boolean(status.authenticated ?? status.token_valid);
            if (status.user_name) account = status.corp_name ? `${status.user_name} @ ${status.corp_name}` : status.user_name;
          } else {
            connected = false;
          }
        } catch {
          connected = false;
        }
        this.statusCache.set(channel.providerId, { at: Date.now(), value: { connected, account } });
      }
      providers.push({
        id: channel.providerId,
        displayName: displayNameOf(channel.providerId),
        receive: this.config.getReceive(channel.providerId),
        connected,
        account,
        receiveHealth:
          channel.providerId === "wecom"
            ? wecomHealth.lastError
              ? { ok: false, reason: wecomHealth.lastError }
              : wecomHealth.lastProbeAt
                ? { ok: true }
                : undefined
            : undefined,
      });
      for (const p of this.config.listPending(channel.providerId)) {
        pending.push({
          provider: channel.providerId,
          senderId: p.senderId,
          senderName: p.senderName,
          lastText: p.lastText,
          firstSeenAt: p.firstSeenAt,
          lastSeenAt: p.lastSeenAt,
        });
      }
    }
    pending.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return {
      providers,
      pending,
      command: this.config.getCommand(),
      triggers: this.config.getTriggers(),
    };
  }

  /** 当前登录二维码 PNG：climp 写的文件优先，其次用提取到的 URL 现场生成。 */
  async qrImage(): Promise<Buffer | null> {
    if (this.login.state === "waiting" && this.login.qrFile) {
      try {
        return readFileSync(this.login.qrFile);
      } catch {
        /* 文件尚未生成，回退 URL */
      }
    }
    if (!this.login.url) return null;
    try {
      return await QRCode.toBuffer(this.login.url, { width: 264, margin: 2 });
    } catch {
      return null;
    }
  }

  private killLoginChild(): void {
    const child = this.loginChild;
    if (!child) return;
    try {
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
}

/** 从登录输出中提取可读的错误摘要（取最后一个非空行，截断）。 */
function summarizeOutput(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  const last = lines[lines.length - 1];
  return last.length > 300 ? last.slice(0, 300) : last;
}

async function isConnected(channel: ImChannel): Promise<boolean> {
  return (await channel.status()) !== undefined;
}

function displayNameOf(id: string): string {
  return id === "dingtalk" ? "钉钉" : id === "wecom" ? "企业微信" : id;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

interface WebServerLike {
  register(route: {
    kind: "exact" | "prefix";
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
  }): () => void;
}

interface ConnectionLike {
  requestRejection(req: IncomingMessage): 401 | 403 | undefined;
}

/**
 * 注册管理 HTTP 路由（与 Web GUI 同源，浏览器 fetch 相对路径即可）：
 * GET  /im-connect/api/state | POST /receive | POST /login | GET /login-status |
 * GET  /qr.png | POST /approve | POST /selftest
 * 全部经 connection.requestRejection 鉴权（未授权 401/403）。
 * 返回清理函数：插件卸载时注销全部路由。
 */
export function registerRoutes(
  ctx: { webServer: WebServerLike; connection: ConnectionLike },
  host: ImConnectHost,
  selfTest?: () => Promise<unknown>,
): () => void {
  const BASE = "/im-connect/api";
  const disposers: Array<() => void> = [];
  const register = (
    path: string,
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  ): void => {
    try {
      disposers.push(
        ctx.webServer.register({
          kind: "exact",
          path,
          handler: async (req, res) => {
            if (!guard(req, res)) return;
            await handler(req, res);
          },
        }),
      );
    } catch (e) {
      // 重复注册（异常卸载残留）不阻断激活：沿用已有路由。
      console.warn(`[im-connect] route ${path} registration skipped: ${(e as Error)?.message}`);
    }
  };

  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection !== undefined) {
      res.writeHead(rejection);
      res.end();
      return false;
    }
    return true;
  };

  register(`${BASE}/state`, async (req, res) => {
    sendJson(res, 200, await host.collectState());
  });

  register(`${BASE}/receive`, async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "POST only" });
      return;
    }
    const body = await readBody(req);
    host.config.setReceive(String(body.provider ?? ""), Boolean(body.enabled));
    sendJson(res, 200, { ok: true });
  });

  register(`${BASE}/login`, async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "POST only" });
      return;
    }
    const body = await readBody(req);
    sendJson(res, 200, host.startLogin(String(body.provider ?? "")));
  });

  register(`${BASE}/login-status`, (req, res) => {
    sendJson(res, 200, host.getLoginStatus());
  });

  register(`${BASE}/qr.png`, async (req, res) => {
    const png = await host.qrImage();
    if (!png) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    res.end(png);
  });

  register(`${BASE}/approve`, async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "POST only" });
      return;
    }
    const body = await readBody(req);
    sendJson(
      res,
      200,
      host.config.approve(String(body.provider ?? ""), String(body.senderId ?? ""), Boolean(body.approved)),
    );
  });

  register(`${BASE}/command`, async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "POST only" });
      return;
    }
    const body = await readBody(req);
    host.config.setCommand({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      prefix: typeof body.prefix === "string" && body.prefix.trim() ? body.prefix.trim() : undefined,
    });
    sendJson(res, 200, { ok: true, command: host.config.getCommand() });
  });

  register(`${BASE}/triggers`, async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "POST only" });
      return;
    }
    const body = await readBody(req);
    host.config.setTriggers({
      atMe: typeof body.atMe === "boolean" ? body.atMe : undefined,
    });
    sendJson(res, 200, { ok: true, triggers: host.config.getTriggers() });
  });

  register(`${BASE}/selftest`, async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "POST only" });
      return;
    }
    if (!selfTest) {
      sendJson(res, 503, { ok: false, error: "self-test not wired" });
      return;
    }
    sendJson(res, 200, await selfTest());
  });

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  };
}
