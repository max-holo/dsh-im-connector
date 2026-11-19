/**
 * Host half of the im-connector bundle.
 *
 * The MCP connection is inserted by the bundle patch; this row exists so the
 * package is a Loader entry (which lets the client-module system load the
 * `dsh.client` browser half) and it serves the JSON routes the settings page
 * uses: provider status, login flow, resource browsing, and the user config.
 */

import { createRequire } from "node:module";
import { collectProviderInfo, providerCatalogue, type ProviderInfo } from "./control/providers.js";
import { configBinOverrides, configPath, loadConfig, saveConfig } from "./config/store.js";
import { getProvider } from "./providers/registry.js";
import type { ImProviderSpec } from "./providers/types.js";
import { CliRunner } from "./cli/runner.js";
import { loginStatus, startLogin } from "./login/session.js";
import { readResourceText } from "./mcp/resources.js";

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

/** 读取请求体（上限 64KB）。 */
async function readBody(req: HttpRequest): Promise<string> {
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
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function readJsonBody(req: HttpRequest): Promise<Record<string, unknown>> {
  const text = await readBody(req);
  if (text === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require("../package.json") as { version?: string };
    return manifest.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** 把登录快照压成设置页需要的形状（含二维码 data URL；提示按平台区分）。 */
function loginPayload(spec: ImProviderSpec, snapshot: Awaited<ReturnType<typeof startLogin>>): Record<string, unknown> {
  return {
    provider: snapshot.provider,
    displayName: snapshot.displayName,
    running: snapshot.running,
    exitCode: snapshot.exitCode,
    qrPath: snapshot.qrPath,
    qrDataUrl: snapshot.qrDataUrl,
    userCode: snapshot.userCode,
    outputTail: snapshot.output.slice(-600),
    hint:
      snapshot.qrDataUrl !== undefined
        ? "请用手机扫描二维码完成授权，然后点击「刷新状态」。"
        : spec.qrOutputFlag !== undefined
          ? "正在生成二维码，请稍候…"
          : "请在浏览器完成授权（钉钉会自动打开浏览器），然后点击「刷新状态」。",
  };
}

/** 平台检测结果的短缓存：设置页打开、chip 轮询、并发打开共用一次检测。 */
const INFO_CACHE_TTL_MS = 30_000;
let infoCache: { at: number; providers: ProviderInfo[] } | undefined;
let infoInFlight: Promise<ProviderInfo[]> | undefined;

function invalidateInfoCache(): void {
  infoCache = undefined;
}

/** 并行检测全部平台（CLI 版本 / 入口 / 登录态），带 TTL 缓存与并发去重。 */
async function detectProviders(): Promise<ProviderInfo[]> {
  if (infoCache !== undefined && Date.now() - infoCache.at < INFO_CACHE_TTL_MS) return infoCache.providers;
  if (infoInFlight !== undefined) return infoInFlight;
  infoInFlight = (async () => {
    const overrides = configBinOverrides();
    const specs = providerCatalogue()
      .map((entry) => getProvider(entry.id))
      .filter((spec): spec is ImProviderSpec => spec !== undefined);
    const providers = await Promise.all(specs.map((spec) => collectProviderInfo(spec, overrides[spec.id])));
    infoCache = { at: Date.now(), providers };
    return providers;
  })();
  try {
    return await infoInFlight;
  } finally {
    infoInFlight = undefined;
  }
}

async function handleInfo(req: HttpRequest, res: HttpResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.searchParams.get("fresh") === "1") invalidateInfoCache();
    const providers = await detectProviders();
    sendJson(res, 200, { ok: true, version: packageVersion(), providers });
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
    const snapshot = await startLogin(spec, new CliRunner(spec), {
      mode,
      bin: configBinOverrides()[spec.id],
    });
    sendJson(res, 200, { ok: true, ...loginPayload(spec, snapshot) });
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
    const status = await loginStatus(spec, new CliRunner(spec), { bin: configBinOverrides()[spec.id] });
    // 会话感知的授权判定：登录进程退出码优先。
    // 旧凭据仍有效时 auth 查询会立刻返回 authorized，不能当作「本次扫码成功」的证据；
    // 会话失败时如实报未授权（平台徽标仍由 /info 的平台级查询展示）。
    const succeeded = status.exitCode === 0;
    const failed = status.exitCode !== null && status.exitCode !== 0;
    if (succeeded) invalidateInfoCache();
    sendJson(res, 200, {
      ok: true,
      provider: status.provider,
      authorized: failed ? false : succeeded ? true : status.authorized,
      running: status.running,
      exitCode: status.exitCode,
      qrDataUrl: status.qrDataUrl,
      userCode: status.userCode,
      authError: status.authError,
      outputTail: status.output.slice(-400),
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: errorMessage(error) });
  }
}

function handleConfig(req: HttpRequest, res: HttpResponse): void {
  void (async () => {
    try {
      if (req.method === "PUT" || req.method === "POST") {
        const body = await readJsonBody(req);
        const saved = saveConfig(body);
        sendJson(res, 200, { ok: true, config: saved, path: configPath() });
        return;
      }
      sendJson(res, 200, { ok: true, config: loadConfig(), path: configPath() });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorMessage(error) });
    }
  })();
}

function handleResources(req: HttpRequest, res: HttpResponse): void {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const uri = url.searchParams.get("uri") ?? "";
      const entry = await readResourceText(uri, { binOverrides: configBinOverrides() });
      if (entry === undefined) {
        sendJson(res, 404, { ok: false, error: `unknown resource "${uri}"` });
        return;
      }
      sendJson(res, 200, { ok: true, ...entry });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: errorMessage(error) });
    }
  })();
}

// ---- npm download stats ------------------------------------------------------
// /api/im-connector/downloads: last-week point + the summed range since the
// package's first publish. Success caches 30 min on the host, failure 5 min.
const NPM_PACKAGE = "im-connector";
const NPM_SINCE = "2026-10-22"; // time.created of the npm package
let downloadsCache: { at: number; ok: boolean; data: Record<string, unknown> } | null = null;

async function fetchJsonFrom(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return (await response.json()) as Record<string, unknown>;
}

async function fetchDownloads(): Promise<Record<string, unknown>> {
  const today = new Date().toISOString().slice(0, 10);
  const [week, range] = await Promise.all([
    fetchJsonFrom(`https://api.npmjs.org/downloads/point/last-week/${NPM_PACKAGE}`, 8000),
    fetchJsonFrom(`https://api.npmjs.org/downloads/range/${NPM_SINCE}:${today}/${NPM_PACKAGE}`, 8000),
  ]);
  let total = 0;
  const days = range.downloads;
  if (Array.isArray(days)) {
    for (const day of days as Array<{ downloads?: unknown }>) {
      total += Number(day?.downloads) || 0;
    }
  }
  return {
    lastWeek: Number(week.downloads) || 0,
    total,
    since: NPM_SINCE,
    weekStart: typeof week.start === "string" ? week.start : null,
    weekEnd: typeof week.end === "string" ? week.end : null,
  };
}

function handleDownloads(_req: HttpRequest, res: HttpResponse): void {
  const serve = (payload: Record<string, unknown>): void => sendJson(res, 200, payload);
  if (downloadsCache !== null && Date.now() - downloadsCache.at < (downloadsCache.ok ? 1800000 : 300000)) {
    serve({ ok: downloadsCache.ok, ...downloadsCache.data, cachedAt: downloadsCache.at });
    return;
  }
  void (async () => {
    try {
      const data = await fetchDownloads();
      downloadsCache = { at: Date.now(), ok: true, data };
      serve({ ok: true, ...data, cachedAt: downloadsCache.at });
    } catch (error) {
      const message = errorMessage(error);
      downloadsCache = { at: Date.now(), ok: false, data: { error: message } };
      serve({ ok: false, error: message, cachedAt: downloadsCache.at });
    }
  })();
}

export function apply(ctx: { get(name: string): unknown; effect(callback: () => void | (() => void)): unknown }): void {
  const server = ctx.get("webServer") as WebServer | undefined;
  if (server === undefined) return;

  const routes: { path: string; handler: (req: HttpRequest, res: HttpResponse) => void }[] = [
    { path: "/api/im-connector/info", handler: (req, res) => { void handleInfo(req, res); } },
    { path: "/api/im-connector/login", handler: (req, res) => { void handleLogin(req, res); } },
    { path: "/api/im-connector/login-status", handler: (req, res) => { void handleLoginStatus(req, res); } },
    { path: "/api/im-connector/config", handler: handleConfig },
    { path: "/api/im-connector/resources", handler: handleResources },
    { path: "/api/im-connector/downloads", handler: handleDownloads },
  ];
  for (const route of routes) {
    ctx.effect(() => server.register({ kind: "exact", path: route.path, handler: route.handler }));
  }
}
