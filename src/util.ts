export type DateInput = Date | string | number;

export function toDate(value: DateInput): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  // Direct parse first: ISO date-time ("2026-10-01T00:00:00+08:00"),
  // date-only ("2026-10-01", UTC midnight), etc.
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  // Fall back to numeric strings (epoch millis).
  const asNumber = new Date(Number(value));
  if (!Number.isNaN(asNumber.getTime())) return asNumber;
  throw new Error(`Invalid date value: ${JSON.stringify(value)}`);
}

export function toEpochMs(value: DateInput): number {
  return toDate(value).getTime();
}

/** Format as local "yyyy-MM-dd HH:mm:ss" (required by attendance OAPIs). */
export function formatDateTimeLocal(value: DateInput): string {
  const d = toDate(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Format as ISO-8601 with timezone (required by calendar APIs). */
export function toIsoDateTime(value: DateInput): string {
  return toDate(value).toISOString();
}

/** Split [from, to) into consecutive windows of at most `maxDays` days. */
export function splitRangeIntoWindows(from: DateInput, to: DateInput, maxDays: number): Array<{ from: Date; to: Date }> {
  const start = toDate(from).getTime();
  const end = toDate(to).getTime();
  if (end <= start) return [{ from: toDate(from), to: toDate(to) }];
  const span = maxDays * 24 * 60 * 60 * 1000;
  const windows: Array<{ from: Date; to: Date }> = [];
  for (let cursor = start; cursor < end; cursor += span) {
    windows.push({ from: new Date(cursor), to: new Date(Math.min(cursor + span, end)) });
  }
  return windows;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter: base * 2^attempt + [0, base). */
export function backoffDelay(attempt: number, baseMs: number): number {
  return baseMs * 2 ** attempt + Math.random() * baseMs;
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
