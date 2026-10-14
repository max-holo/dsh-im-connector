import { DingTalkError } from "./errors.js";
import type { ResolvedConnectorOptions } from "./config.js";

interface TokenResponse {
  accessToken?: string;
  expireIn?: number;
  code?: string;
  message?: string;
}

/**
 * Fetches and caches the enterprise access token
 * (POST {apiBase}/v1.0/oauth2/accessToken). Refreshed 5 minutes before
 * expiry; concurrent callers share a single in-flight request.
 */
export class TokenManager {
  private cache?: { token: string; expiresAt: number };
  private inflight?: Promise<string>;

  constructor(private readonly options: ResolvedConnectorOptions) {}

  async getAccessToken(): Promise<string> {
    if (this.cache && Date.now() < this.cache.expiresAt) return this.cache.token;
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Drop the cached token (e.g. after an invalid-token error). */
  invalidate(): void {
    this.cache = undefined;
  }

  private async fetchToken(): Promise<string> {
    const url = `${this.options.apiBase}/v1.0/oauth2/accessToken`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appKey: this.options.appKey, appSecret: this.options.appSecret }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (e) {
      throw new DingTalkError({
        message: `Failed to reach DingTalk token endpoint: ${(e as Error).message}`,
        url,
        retryable: true,
      });
    }
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !body.accessToken) {
      throw new DingTalkError({
        message: `Failed to obtain access token: ${body.message ?? res.statusText}`,
        code: body.code,
        httpStatus: res.status,
        url,
      });
    }
    const expireIn = body.expireIn ?? 7200;
    this.cache = {
      token: body.accessToken,
      // Refresh 5 minutes early, but keep at least 60s validity.
      expiresAt: Date.now() + Math.max(expireIn - 300, 60) * 1000,
    };
    return body.accessToken;
  }
}
