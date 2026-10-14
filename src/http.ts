import { DingTalkError } from "./errors.js";
import type { ResolvedConnectorOptions } from "./config.js";
import { TokenManager } from "./token.js";
import { backoffDelay, sleep } from "./util.js";

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
}

type Domain = "api" | "oapi";
type Method = "GET" | "POST" | "PUT" | "DELETE";

function buildUrl(base: string, path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${base}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isRetryableError(e: unknown): boolean {
  if (e instanceof DingTalkError) return e.retryable;
  if (e instanceof Error && e.name === "TimeoutError") return true;
  // fetch() network failures surface as TypeError.
  return e instanceof TypeError;
}

/**
 * Thin HTTP layer over both DingTalk API domains:
 *
 * - `api`  → https://api.dingtalk.com (v1.0/v2.0 REST, token via
 *   `x-acs-dingtalk-access-token` header, errors via HTTP status).
 * - `oapi` → https://oapi.dingtalk.com (legacy, token via `access_token`
 *   query param, errors via `errcode` in a 200 response).
 *
 * Adds timeout, retry with exponential backoff for transient failures
 * (429/5xx/network), and normalized DingTalkError mapping.
 */
export class Http {
  constructor(
    private readonly options: ResolvedConnectorOptions,
    private readonly token: TokenManager,
  ) {}

  /** Call a new-style REST API (api.dingtalk.com). */
  async api<T = unknown>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>("api", method, path, opts);
  }

  /** Call a legacy OAPI (oapi.dingtalk.com). */
  async oapi<T = unknown>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>("oapi", method, path, opts);
  }

  private async request<T>(domain: Domain, method: Method, path: string, opts: RequestOptions): Promise<T> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.once<T>(domain, method, path, opts);
      } catch (e) {
        if (attempt >= this.options.maxRetries || !isRetryableError(e)) throw e;
        await sleep(backoffDelay(attempt, this.options.retryBaseDelayMs));
        attempt += 1;
      }
    }
  }

  private async once<T>(domain: Domain, method: Method, path: string, opts: RequestOptions): Promise<T> {
    const base = domain === "api" ? this.options.apiBase : this.options.oapiBase;
    const token = await this.token.getAccessToken();
    const query =
      domain === "oapi" ? { ...opts.query, access_token: token } : opts.query;
    const url = buildUrl(base, path, query);

    const headers: Record<string, string> = {};
    if (domain === "api") headers["x-acs-dingtalk-access-token"] = token;
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (e) {
      throw new DingTalkError({
        message: `Network failure calling ${method} ${path}: ${(e as Error).message}`,
        url,
        retryable: true,
      });
    }

    const text = await res.text();
    const json = text ? (safeJsonParse(text) as Record<string, unknown> | undefined) : undefined;

    if (domain === "api") {
      if (!res.ok) {
        throw new DingTalkError({
          message: (json?.message as string) ?? text.slice(0, 500) ?? res.statusText,
          code: json?.code as string | number | undefined,
          httpStatus: res.status,
          requestId: json?.requestId as string | undefined,
          url,
          retryable: res.status === 429 || res.status >= 500,
        });
      }
      return json as T;
    }

    // Legacy OAPI: HTTP is (almost) always 200; check errcode instead.
    const errcode = json?.errcode;
    if (typeof errcode === "number" && errcode !== 0) {
      throw new DingTalkError({
        message: (json?.errmsg as string) ?? `DingTalk OAPI error ${errcode}`,
        code: errcode,
        httpStatus: res.status,
        url,
        retryable: errcode === -1 || errcode === 90018,
      });
    }
    if (!res.ok) {
      throw new DingTalkError({
        message: text.slice(0, 500) || res.statusText,
        httpStatus: res.status,
        url,
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return json as T;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
