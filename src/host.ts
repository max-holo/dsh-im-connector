/**
 * Host half of the im-connector bundle.
 *
 * The MCP connection is inserted by the bundle patch; this row exists so the
 * package is a Loader entry (which lets the client-module system load the
 * `dsh.client` browser half) and it serves the read-only JSON routes the
 * settings page uses to show provider status and drive the login flow.
 */

import { collectProviderInfo, providerCatalogue } from "./control/providers.js";
import { getProvider } from "./providers/registry.js";
import { CliRunner } from "./cli/runner.js";
import { loginStatus, startLogin } from "./login/session.js";

export const name = "im-connector-host";

/** 设置页需要读取的宿主能力。 */
export const inject = ["webServer"];

interface HttpResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body?: string): unknown;
}

interface HttpRequest {
  method?: string;
  url?: string;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface WebServer {
  register(route: { kind: "exact"; path: string; handler(req: HttpRequest, res: HttpResponse): void }): () => void;
}

function sendJson(res: HttpResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取 POST 的 JSON body（上限 64KB）。 */
async function readJsonBody(req: HttpRequest): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > 64 * 1024) {
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => resolve());
    req.on("error", (error: unknown) => reject(new Error(errorMessage(error))));
  });
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** 把登录快照压成设置页需要的形状（含二维码 data URL）。 */
function loginPayload(snapshot: Awaited<ReturnType<typeof startLogin>>): Record<string, unknown> {
  return {
    provider: snapshot.provider,
    displayName: snapshot.displayName,
    running: snapshot.running,
    exitCode: snapshot.exitCode,
    qrPath: snapshot.qrPath,
    qrDataUrl: snapshot.qrDataUrl,
    outputTail: snapshot.output.slice(-600),
    hint: snapshot.qrDataUrl
      ? "请用手机扫描二维码完成授权，然后点击「刷新状态」。"
      : "请在浏览器完成授权（钉钉会自动打开浏览器），然后点击「刷新状态」。",
  };
}

async function handleInfo(res: HttpResponse): Promise<void> {
  try {
    const providers = [];
    for (const entry of providerCatalogue()) {
      const spec = getProvider(entry.id);
      if (spec === undefined) continue;
      providers.push(await collectProviderInfo(spec));
    }
    sendJson(res, 200, { ok: true, providers });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: errorMessage(error) });
  }
}

async function handleLogin(req: HttpRequest, res: HttpResponse): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const providerId = typeof body.provider === "string" ? body.provider : "";
    const spec = getProvider(providerId);
    if (spec === undefined) {
      sendJson(res, 400, { ok: false, error: `unknown provider "${providerId}"` });
      return;
    }
    const mode = body.mode === "device" ? "device" : "browser";
    const snapshot = await startLogin(spec, new CliRunner(spec), { mode });
    sendJson(res, 200, { ok: true, ...loginPayload(snapshot) });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: errorMessage(error) });
  }
}

async function handleLoginStatus(req: HttpRequest, res: HttpResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const providerId = url.searchParams.get("provider") ?? "";
    const spec = getProvider(providerId);
    if (spec === undefined) {
      sendJson(res, 400, { ok: false, error: `unknown provider "${providerId}"` });
      return;
    }
    const status = await loginStatus(spec, new CliRunner(spec));
    sendJson(res, 200, {
      ok: true,
      provider: status.provider,
      authorized: status.authorized,
      running: status.running,
      exitCode: status.exitCode,
      qrDataUrl: status.qrDataUrl,
      authError: status.authError,
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: errorMessage(error) });
  }
}

export function apply(ctx: { get(name: string): unknown; effect(callback: () => void | (() => void)): unknown }): void {
  const server = ctx.get("webServer") as WebServer | undefined;
  if (server === undefined) return;

  ctx.effect(() =>
    server.register({
      kind: "exact",
      path: "/api/im-connector/info",
      handler: (_req, res) => {
        void handleInfo(res);
      },
    }),
  );
  ctx.effect(() =>
    server.register({
      kind: "exact",
      path: "/api/im-connector/login",
      handler: (req, res) => {
        void handleLogin(req, res);
      },
    }),
  );
  ctx.effect(() =>
    server.register({
      kind: "exact",
      path: "/api/im-connector/login-status",
      handler: (req, res) => {
        void handleLoginStatus(req, res);
      },
    }),
  );
}
