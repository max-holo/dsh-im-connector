import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
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
}

/** Host 侧管理面：扫码登录进程 + 状态聚合。 */
export class ImConnectHost {
  readonly config: JsonConfigStore;
  private login: LoginState = { running: false, output: "", done: true, exitCode: null };

  constructor(config: JsonConfigStore) {
    this.config = config;
  }

  startLogin(provider: string): { ok: boolean; error?: string } {
    const cmd = LOGIN_COMMANDS[provider];
    if (!cmd) return { ok: false, error: `unknown provider: ${provider}` };
    if (this.login.running) return { ok: false, error: "a login is already running" };
    this.login = { running: true, provider, output: "", done: false, exitCode: null };
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

  /** 聚合各渠道的接收开关与连接状态。 */
  async collectState(): Promise<{
    providers: Array<{ id: string; displayName: string; receive: boolean; connected: boolean }>;
  }> {
    const providers = [];
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
    }
    return { providers };
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
 * GET /im-connect/state、POST /im-connect/receive、POST /im-connect/login、GET /im-connect/login-status。
 * 全部经 connection.requestRejection 鉴权（未授权 401/403）。
 * 返回清理函数：插件卸载时注销全部路由。
 */
export function registerRoutes(
  ctx: { webServer: WebServerLike; connection: ConnectionLike },
  host: ImConnectHost,
): () => void {
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

  register("/im-connect/state", async (req, res) => {
    sendJson(res, 200, await host.collectState());
  });

  register("/im-connect/receive", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "POST only" });
      return;
    }
    const body = await readBody(req);
    host.config.setReceive(String(body.provider ?? ""), Boolean(body.enabled));
    sendJson(res, 200, { ok: true });
  });

  register("/im-connect/login", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "POST only" });
      return;
    }
    const body = await readBody(req);
    sendJson(res, 200, host.startLogin(String(body.provider ?? "")));
  });

  register("/im-connect/login-status", (req, res) => {
    sendJson(res, 200, host.getLoginStatus());
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
