import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CliRunner } from "../cli/runner.js";
import { cliMissingHint, releaseStatus } from "../cli/release.js";
import { isCliError } from "../cli/errors.js";
import { listProviders } from "../providers/registry.js";
import type { ImProviderSpec } from "../providers/types.js";

/** 单个平台的自检结果（MCP `info` 工具与设置页共用）。 */
export interface ProviderInfo {
  id: string;
  displayName: string;
  bin: string;
  bundled: boolean;
  /** 是否找到了真实可执行入口（false 时 hint 给出修复方式）。 */
  available: boolean;
  resolved?: string;
  version?: string;
  auth?: unknown;
  authError?: string;
  /** 首次运行自动下载官方二进制的结果。 */
  download?: { attempted: boolean; ok: boolean; error?: string };
  /** 不可用时的可照做修复清单。 */
  hint?: string;
}

/** 平台目录（稳定、不调用 CLI）。 */
export interface ProviderCatalogueEntry {
  id: string;
  displayName: string;
  bin: string;
  bundled: boolean;
  examples: string[];
}

export function providerCatalogue(): ProviderCatalogueEntry[] {
  return listProviders().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    bin: p.bin,
    bundled: p.bundledCliDir !== undefined,
    examples: p.examples,
  }));
}

/**
 * 收集一个平台的自检信息：可执行入口、CLI 版本、登录状态。
 * 各步骤失败互不影响，只记录可读原因。
 */
export async function collectProviderInfo(spec: ImProviderSpec, binOverride?: string): Promise<ProviderInfo> {
  const runner = new CliRunner(spec);
  const info: ProviderInfo = {
    id: spec.id,
    displayName: spec.displayName,
    bin: spec.bin,
    bundled: spec.bundledCliDir !== undefined,
    available: false,
  };

  try {
    const probe = await runner.probe(binOverride);
    if (probe.resolved !== undefined) info.resolved = probe.resolved;
    info.available = probe.resolved !== undefined && !probe.fallback;
  } catch {
    /* 解析失败不影响其余字段 */
  }

  // 没找到可执行文件：把「为什么没有 + 怎么修」一起交给调用方（模型/用户）。
  if (!info.available) {
    const status = releaseStatus();
    if (status !== undefined) {
      info.download = {
        attempted: status.attempted,
        ok: status.ok,
        ...(status.error === undefined ? {} : { error: status.error }),
      };
    }
    if (spec.release !== undefined) info.hint = cliMissingHint(spec);
  }

  try {
    const exec = await runner.runRaw(spec.versionArgs ?? ["--version"], { bin: binOverride });
    const firstLine = exec.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine !== undefined) info.version = firstLine;
  } catch {
    /* 版本查询失败时回退 package.json */
  }
  if (info.version === undefined) {
    try {
      const require = createRequire(import.meta.url);
      const pkgJson = require.resolve(`${spec.npmPackage}/package.json`);
      const manifest = JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: string };
      if (manifest.version !== undefined) info.version = manifest.version;
    } catch {
      /* 包不在本地时保持未知 */
    }
  }

  if (spec.authArgs !== undefined) {
    try {
      info.auth = await runner.runJson([...spec.authArgs], { bin: binOverride });
    } catch (e) {
      info.authError = isCliError(e) ? e.message : e instanceof Error ? e.message : String(e);
    }
  }
  return info;
}

export function isAuthorizedInfo(info: ProviderInfo): boolean {
  if (info.authError !== undefined) return false;
  const auth = info.auth;
  if (typeof auth === "string") return /authoriz|authenticat/i.test(auth) && !/unauthoriz|unauthenticat/i.test(auth);
  if (auth !== null && typeof auth === "object") {
    const record = auth as Record<string, unknown>;
    if (record.authenticated === true) return true;
    if (typeof record.authenticated === "boolean") return record.authenticated;
  }
  return false;
}
