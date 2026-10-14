export interface ConnectorOptions {
  /** 企业内部应用 AppKey (aka clientId). */
  appKey: string;
  /** 企业内部应用 AppSecret (aka clientSecret). */
  appSecret: string;
  /** Override the new REST API base URL (tests / proxies). */
  apiBase?: string;
  /** Override the legacy OAPI base URL (tests / proxies). */
  oapiBase?: string;
  /** Max retries for transient failures (429 / 5xx / network). Default 3. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 20000. */
  timeoutMs?: number;
  /** Base delay for retry backoff in milliseconds. Default 300. */
  retryBaseDelayMs?: number;
  /** Where captured Stream messages are stored. Default ./.dingtalk-capture.jsonl */
  captureFile?: string;
}

export interface ResolvedConnectorOptions {
  appKey: string;
  appSecret: string;
  apiBase: string;
  oapiBase: string;
  maxRetries: number;
  timeoutMs: number;
  retryBaseDelayMs: number;
  captureFile: string;
}

export const DEFAULT_API_BASE = "https://api.dingtalk.com";
export const DEFAULT_OAPI_BASE = "https://oapi.dingtalk.com";
export const DEFAULT_CAPTURE_FILE = ".dingtalk-capture.jsonl";

export function resolveOptions(opts: ConnectorOptions): ResolvedConnectorOptions {
  if (!opts.appKey || !opts.appSecret) {
    throw new Error(
      "DingTalk connector requires appKey and appSecret (create an 企业内部应用 on the DingTalk developer console).",
    );
  }
  return {
    appKey: opts.appKey,
    appSecret: opts.appSecret,
    apiBase: (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, ""),
    oapiBase: (opts.oapiBase ?? DEFAULT_OAPI_BASE).replace(/\/+$/, ""),
    maxRetries: opts.maxRetries ?? 3,
    timeoutMs: opts.timeoutMs ?? 20_000,
    retryBaseDelayMs: opts.retryBaseDelayMs ?? 300,
    captureFile: opts.captureFile ?? DEFAULT_CAPTURE_FILE,
  };
}

/**
 * Load connector options from environment variables:
 * DINGTALK_APP_KEY, DINGTALK_APP_SECRET (required),
 * DINGTALK_API_BASE, DINGTALK_OAPI_BASE, DINGTALK_CAPTURE_FILE (optional).
 * Returns null when credentials are missing.
 */
export function loadEnvOptions(env: NodeJS.ProcessEnv = process.env): ConnectorOptions | null {
  const appKey = env.DINGTALK_APP_KEY?.trim();
  const appSecret = env.DINGTALK_APP_SECRET?.trim();
  if (!appKey || !appSecret) return null;
  return {
    appKey,
    appSecret,
    apiBase: env.DINGTALK_API_BASE?.trim() || undefined,
    oapiBase: env.DINGTALK_OAPI_BASE?.trim() || undefined,
    captureFile: env.DINGTALK_CAPTURE_FILE?.trim() || undefined,
  };
}
