import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getProvider, listProviders } from "../providers/registry.js";

/**
 * 用户级配置（MCP server 与设置页共用，保存于 ~/.im-connector/config.json）：
 * - `bins`：provider id → CLI 入口覆盖（等价于 DINGTALK_DWS_BIN / WECOM_CLI_BIN）
 * - `defaultProvider`：跨平台默认值（工具调用仍需显式 provider，此处供 UI 预选）
 */
export interface ImConnectorConfig {
  bins?: Record<string, string>;
  defaultProvider?: string;
}

export function configPath(): string {
  return join(homedir(), ".im-connector", "config.json");
}

/** 只保留合法字段：未知 provider、非字符串路径一律丢弃。 */
export function normalizeConfig(value: unknown): ImConnectorConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const config: ImConnectorConfig = {};

  const bins = record.bins;
  if (bins !== null && typeof bins === "object" && !Array.isArray(bins)) {
    const kept: Record<string, string> = {};
    for (const [id, path] of Object.entries(bins as Record<string, unknown>)) {
      if (typeof path !== "string") continue;
      const trimmed = path.trim();
      if (trimmed === "" || getProvider(id) === undefined) continue;
      kept[id] = trimmed;
    }
    if (Object.keys(kept).length > 0) config.bins = kept;
  }

  if (typeof record.defaultProvider === "string" && getProvider(record.defaultProvider) !== undefined) {
    config.defaultProvider = record.defaultProvider;
  }
  return config;
}

export function loadConfig(): ImConnectorConfig {
  try {
    // 容错 BOM：Windows 记事本等编辑器保存的 JSON 常带 BOM，会让 JSON.parse 失败
    const raw = readFileSync(configPath(), "utf8").replace(/^\uFEFF/u, "");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveConfig(value: unknown): ImConnectorConfig {
  const config = normalizeConfig(value);
  const file = configPath();
  mkdirSync(dirname(file), { recursive: true });
  // 无 BOM 写入，保证 JSON.parse 可直接读取
  writeFileSync(file, JSON.stringify(config, null, 2), { encoding: "utf8" });
  return config;
}

/** 配置里的 provider 覆盖，用于 CliRunner 的 bin 参数。 */
export function configBinOverrides(config: ImConnectorConfig = loadConfig()): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const id of listProviders().map((p) => p.id)) {
    const bin = config.bins?.[id];
    if (bin !== undefined) overrides[id] = bin;
  }
  return overrides;
}
