/** dws 错误信封（写到 stderr 的稳定外层结构）。 */
export interface DwsErrorEnvelope {
  error?: {
    code?: number | string;
    category?: string;
    message?: string;
    reason?: string;
    retryable?: boolean;
    retry_after_seconds?: number;
    next_retry_at?: string;
    hint?: string;
    actions?: string[];
    details?: unknown;
    trace_id?: string;
    server_error_code?: string;
  };
}

/** 由 dws 命令失败引发的统一错误。 */
export class DwsError extends Error {
  readonly code?: number | string;
  readonly category?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
  readonly hint?: string;
  readonly actions?: string[];
  readonly command: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(init: {
    message: string;
    command: string;
    stderr?: string;
    exitCode?: number | null;
    code?: number | string;
    category?: string;
    reason?: string;
    retryable?: boolean;
    hint?: string;
    actions?: string[];
  }) {
    super(init.message);
    this.name = "DwsError";
    this.code = init.code;
    this.category = init.category;
    this.reason = init.reason;
    this.retryable = init.retryable;
    this.hint = init.hint;
    this.actions = init.actions;
    this.command = init.command;
    this.stderr = init.stderr ?? "";
    this.exitCode = init.exitCode ?? null;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      command: this.command,
      code: this.code,
      category: this.category,
      reason: this.reason,
      retryable: this.retryable,
      hint: this.hint,
      actions: this.actions,
      exitCode: this.exitCode,
    };
  }
}

export function isDwsError(e: unknown): e is DwsError {
  return e instanceof DwsError;
}

/**
 * 从 stderr 文本中提取 dws 错误信封。dws 在 JSON 模式下把错误写进 stderr，
 * 结构为 `{"error":{...}}`；也可能夹带进程噪声，因此做一次容错定位。
 */
export function parseErrorEnvelope(stderr: string): DwsErrorEnvelope | undefined {
  const text = stderr.trim();
  if (!text) return undefined;
  // 1) 整段就是 JSON
  const direct = tryParse(text);
  if (direct && direct.error) return direct;
  // 2) 定位第一个 '{' 到最后一个 '}' 的子串
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    const parsed = tryParse(slice);
    if (parsed && parsed.error) return parsed;
  }
  // 3) 逐行扫描
  for (const line of text.split(/\r?\n/)) {
    const parsed = tryParse(line.trim());
    if (parsed && parsed.error) return parsed;
  }
  return undefined;
}

function tryParse(text: string): DwsErrorEnvelope | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as DwsErrorEnvelope;
  } catch {
    return undefined;
  }
}
