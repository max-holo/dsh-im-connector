/**
 * Unified error type for all DingTalk API failures.
 *
 * - New REST APIs (api.dingtalk.com /v1.0, /v2.0) answer with
 *   HTTP status + `{ code, message, requestId }`.
 * - Legacy OAPI (oapi.dingtalk.com) answers HTTP 200 + `{ errcode, errmsg }`.
 */
export class DingTalkError extends Error {
  /** API error code (string for REST APIs, number for OAPI errcode). */
  readonly code?: string | number;
  readonly httpStatus?: number;
  readonly requestId?: string;
  readonly url?: string;
  /** Whether the failure is transient and the request can be retried. */
  readonly retryable: boolean;

  constructor(init: {
    message: string;
    code?: string | number;
    httpStatus?: number;
    requestId?: string;
    url?: string;
    retryable?: boolean;
  }) {
    super(init.message);
    this.name = "DingTalkError";
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.requestId = init.requestId;
    this.url = init.url;
    this.retryable = init.retryable ?? false;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      requestId: this.requestId,
      retryable: this.retryable,
    };
  }
}

export function isDingTalkError(e: unknown): e is DingTalkError {
  return e instanceof DingTalkError;
}
