export type FlagValue = string | number | boolean | undefined | null;

export interface FlagMap {
  [key: string]: FlagValue | FlagValue[];
}

/**
 * 把参数对象转换为 dws 的 flag 数组（kebab-case key → `--key value`）。
 * - undefined/null/false 跳过；true → 布尔 flag `--key`
 * - 数组 → 逗号分隔 CSV（dws 的 `strings` flag 语义）
 * - 其它标量 → `--key <String(value)>`
 */
export function buildFlags(map: FlagMap): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined || value === null || value === false) continue;
    if (Array.isArray(value)) {
      const filtered = value.filter(
        (v): v is string | number => v !== undefined && v !== null && v !== false && v !== "",
      );
      if (filtered.length === 0) continue;
      out.push(`--${key}`, filtered.map(String).join(","));
      continue;
    }
    if (value === true) {
      out.push(`--${key}`);
      continue;
    }
    out.push(`--${key}`, String(value));
  }
  return out;
}
