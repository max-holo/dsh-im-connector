/** CLI 错误信封（dws 风格；其它 CLI 若无结构化信封则回退到原始 stderr）。 */
export interface CliErrorEnvelope {
  error?: {
    code?: number | string;
    category?: string;
    message?: string;
    reason?: string;
    retryable?: boolean;
    retry_after_seconds?: number;
    hint?: string;
    actions?: string[];
    details?: unknown;
    trace_id?: string;
    server_error_code?: string;
  };
}

/** 由底层 CLI 命令失败引发的统一错误。 */
export class CliError extends Error {
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
    this.name = "CliError";
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

export function isCliError(e: unknown): e is CliError {
  return e instanceof CliError;
}

/** 从 stderr 文本提取结构化错误信封；失败返回 undefined（调用方回退原始文本）。 */
export function parseErrorEnvelope(stderr: string): CliErrorEnvelope | undefined {
  const text = stderr.trim();
  if (!text) return undefined;
  const direct = tryParse(text);
  if (direct?.error) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed?.error) return parsed;
  }
  for (const line of text.split(/\r?\n/)) {
    const parsed = tryParse(line.trim());
    if (parsed?.error) return parsed;
  }
  return undefined;
}

function tryParse(text: string): CliErrorEnvelope | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as CliErrorEnvelope;
  } catch {
    return undefined;
  }
}
