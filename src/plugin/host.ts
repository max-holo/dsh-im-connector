import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import QRCode from "qrcode";
import { listChannels } from "../channels/registry.js";
import type { ImChannel } from "../channels/types.js";
import type { JsonConfigStore } from "./config.js";

/** 各平台的扫码登录命令（终端二维码）。 */
const LOGIN_COMMANDS: Record<string, { bin: string; args: string[] }> = {
  dingtalk: { bin: "dws", args: ["auth", "login", "--device", "--recommend"] },
  wecom: { bin: "wecom-cli", args: ["auth", "init", "--noninteractive"] },
};

export interface LoginState {
  running: boolean;
  provider?: string;
  output: string;
  done: boolean;
  exitCode: number | null;
  /** 从登录输出中提取的授权 URL（用于渲染二维码图片）。 */
  url?: string;
  startedAt: number;
}

/** 从终端输出提取第一个授权链接。 */
export function extractLoginUrl(output: string): string | undefined {
  const m = output.match(/https?:\/\/[^\s"'<>)\]]+/);
  return m ? m[0] : undefined;
}

/** Host 侧管理面：扫码登录进程 + 状态聚合。 */
export class ImConnectHost {
  readonly config: JsonConfigStore;
  private login: LoginState = {
    running: false,
    output: "",
    done: true,
    exitCode: null,
    startedAt: 0,
  };

  constructor(config: JsonConfigStore) {
    this.config = config;
  }

  startLogin(provider: string): { ok: boolean; error?: string } {
    const cmd = LOGIN_COMMANDS[provider];
    if (!cmd) return { ok: false, error: `unknown provider: ${provider}` };
    if (this.login.running) return { ok: false, error: "a login is already running" };
    this.login = { running: true, provider, output: "", done: false, exitCode: null, startedAt: Date.now() };
    const child = spawn(cmd.bin, cmd.args, {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const append = (chunk: Buffer): void => {
      this.login.output += chunk.toString("utf8");
      if (this.login.output.length > 20000) {
        this.login.output = this.login.output.slice(-20000);
      }
      if (!this.login.url) this.login.url = extractLoginUrl(this.login.output);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("exit", (code) => {
      this.login.running = false;
      this.login.done = true;
      this.login.exitCode = code;
    });
    return { ok: true };
  }

  getLoginStatus(): LoginState {
    return { ...this.login };
  }

  /** 聚合各渠道的接收开关、连接状态、待批准与白名单。 */
  async collectState(): Promise<{
    providers: Array<{ id: string; displayName: string; receive: boolean; connected: boolean }>;
    pending: Array<{
      provider: string;
      senderId: string;
      senderName?: string;
      lastText: string;
      firstSeenAt: number;
      lastSeenAt: number;
    }>;
  }> {
    const providers = [];
    const pending = [];
    for (const channel of listChannels()) {
      let connected = false;
      try {
        connected = await isConnected(channel);
      } catch {
        connected = false;
      }
      providers.push({
        id: channel.providerId,
        displayName: displayNameOf(channel.providerId),
        receive: this.config.getReceive(channel.providerId),
        connected,
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
    return { providers, pending };
  }

  /** 当前登录授权 URL 的二维码 PNG（无登录时 null）。 */
  async qrImage(): Promise<Buffer | null> {
    if (!this.login.url) return null;
    try {
      return await QRCode.toBuffer(this.login.url, { width: 264, margin: 2 });
    } catch {
      return null;
    }
  }
}

async function isConnected(channel: ImChannel): Promise<boolean> {
  const status = (await channel.status()) as
    | string
    | { authenticated?: boolean; token_valid?: boolean };
  if (typeof status === "string") return status.trim() === "authorized"; // wecom
  if (status && typeof status === "object") return Boolean(status.authenticated ?? status.token_valid);
  return false;
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
 * GET /im-connect/api/state、POST /im-connect/api/receive、POST /im-connect/api/login、
 * GET /im-connect/api/login-status、GET /im-connect/api/qr.png、POST /im-connect/api/approve。
 * 全部经 connection.requestRejection 鉴权（未授权 401/403）。
 * 返回清理函数：插件卸载时注销全部路由。
 */
export function registerRoutes(
  ctx: { webServer: WebServerLike; connection: ConnectionLike },
  host: ImConnectHost,
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
