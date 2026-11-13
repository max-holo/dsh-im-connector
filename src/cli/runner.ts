import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImProviderSpec } from "../providers/types.js";
import { CliError, parseErrorEnvelope } from "./errors.js";
import { cliMissingHint, ensureReleaseCli } from "./release.js";

export interface CliRunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
  /** 覆盖 bin（测试注入 fake CLI 用）。 */
  bin?: string;
}

export interface CliExecution {
  /** 人类可读命令，如 `wecom-cli contact users search`。 */
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** stdout 解析后的 JSON（无法解析时为原始文本）。 */
  data: unknown;
}

export interface LaunchSpec {
  command: string;
  prefix: string[];
  shell: boolean;
  /** 没有找到任何真实 CLI，只能把裸命令交给 shell/PATH 解析（通常意味着不可用）。 */
  fallback?: boolean;
}

/**
 * 通用 CLI 透传执行器：按 provider 规格定位 CLI（npm 全局 bin 脚本 → node 直跑，
 * 规避 Windows shim），追加 provider 的 formatArgs，收集 stdout/stderr，解析 JSON，
 * 非零退出时映射错误信封为 CliError。
 */
export class CliRunner {
  constructor(private readonly spec: ImProviderSpec) {}

  get providerId(): string {
    return this.spec.id;
  }

  /** 运行并返回解析后的 stdout JSON；失败抛 CliError。 */
  async runJson(args: string[], opts?: CliRunOptions): Promise<unknown> {
    const exec = await this.run(args, opts);
    return exec.data;
  }

  /** 运行命令（追加 provider 的 formatArgs）。 */
  async run(args: string[], opts?: CliRunOptions): Promise<CliExecution> {
    return this.execute(args, [...args, ...this.spec.formatArgs], opts);
  }

  /** 运行原始命令（不追加 formatArgs，用于 --version 等非业务查询）。 */
  async runRaw(args: string[], opts?: CliRunOptions): Promise<CliExecution> {
    return this.execute(args, args, opts);
  }

  /** 解析实际使用的 CLI 入口（脚本路径或命令名），用于诊断。 */
  async resolveScript(binOverride?: string): Promise<string> {
    const launch = await this.launch(binOverride);
    return launch.shell ? launch.command : (launch.prefix[0] ?? launch.command);
  }

  /** 暴露启动规格（供登录会话等需要自行 spawn 的场景复用解析逻辑）。 */
  async resolveLaunch(binOverride?: string): Promise<LaunchSpec> {
    return this.launch(binOverride);
  }

  /**
   * 探测是否找到了真实的 CLI 入口（区别于「交给 PATH 兜底」）。
   * @returns 找到时为脚本/可执行路径；只有 PATH 兜底时 `fallback: true`。
   */
  async probe(binOverride?: string): Promise<{ resolved?: string; fallback: boolean }> {
    const launch = await this.launch(binOverride);
    if (launch.fallback === true) return { fallback: true };
    const resolved = launch.shell ? launch.command : (launch.prefix[0] ?? launch.command);
    return { resolved, fallback: false };
  }

  private async execute(
    displayArgs: string[],
    cliArgs: string[],
    opts?: CliRunOptions,
  ): Promise<CliExecution> {
    const launch = await this.launch(opts?.bin);
    const finalArgs = [...launch.prefix, ...cliArgs];
    const command = `${this.spec.bin} ${displayArgs.join(" ")}`;
    // 没有任何真实 CLI 时（PATH 兜底），失败原因对用户没意义；把修复清单带上。
    const missingHint = launch.fallback === true && this.spec.release !== undefined ? cliMissingHint(this.spec) : undefined;
    return new Promise<CliExecution>((resolve, reject) => {
      const child = spawn(launch.command, finalArgs, {
        shell: launch.shell,
        cwd: opts?.cwd,
        env: { ...process.env, ...opts?.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString("utf8");
      });
      const onAbort = (): void => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      };
      if (opts?.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      child.on("error", (e) => {
        reject(
          new CliError({
            message: `Failed to launch ${this.spec.bin} (${launch.command}): ${e.message}`,
            command,
            retryable: true,
            hint: missingHint,
          }),
        );
      });
      child.on("exit", (code) => {
        opts?.signal?.removeEventListener("abort", onAbort);
        const parsed = parseStdoutJson(stdout);
        if (code !== 0) {
          const envelope = parseErrorEnvelope(stderr);
          // wecom-cli 把结构化错误写在 stdout（errcode/errmsg），stderr 为空时也要取出可读原因。
          const wecom = envelope === undefined ? parseWecomError(stdout) : undefined;
          const message =
            (envelope?.error?.message ?? wecom?.message ?? stderr.trim()) || `${this.spec.bin} exited with code ${code}`;
          reject(
            new CliError({
              message,
              command,
              stderr,
              exitCode: code,
              code: envelope?.error?.code ?? wecom?.errcode,
              category: envelope?.error?.category,
              reason: envelope?.error?.reason,
              retryable: envelope?.error?.retryable,
              hint: envelope?.error?.hint ?? wecom?.hint ?? missingHint,
              actions: envelope?.error?.actions,
            }),
          );
          return;
        }
        resolve({ command, args: finalArgs, stdout, stderr, exitCode: code, data: parsed });
      });
    });
  }

  private async launch(binOverride?: string): Promise<LaunchSpec> {
    const env = process.env[this.spec.envBin ?? ""]?.trim();
    const bin = binOverride?.trim() || env || this.spec.bin;
    // 1) 显式 node 脚本
    if (bin !== this.spec.bin && /\.(c?js|mjs)$/i.test(bin) && existsSync(bin)) {
      return { command: process.execPath, prefix: [bin], shell: false };
    }
    // 2) 显式可执行文件
    if (bin !== this.spec.bin && existsSync(bin)) {
      return { command: bin, prefix: [], shell: false };
    }
    if (bin === this.spec.bin) {
      // 3) 官方独立安装（~/.local/bin，dws upgrade 自升级保持最新）
      const standalone = standaloneCliExecutable(this.spec);
      if (standalone) {
        return { command: standalone, prefix: [], shell: false };
      }
      // 4) npm 全局安装的 CLI（node wrapper，用户自维护）
      const globalRoot = await npmGlobalRoot();
      if (globalRoot) {
        const script = join(globalRoot, ...this.spec.binScript.split("/"));
        if (existsSync(script)) {
          return { command: process.execPath, prefix: [script], shell: false };
        }
      }
      // 5) 本地依赖（require.resolve 到包内 node_modules）
      const viaManifest = await cliScriptFromManifest(this.spec);
      if (viaManifest) {
        return { command: process.execPath, prefix: [viaManifest], shell: false };
      }
      // 6) 随包携带的兜底二进制（仅部分平台；版本随包发布可能滞后于官方最新）
      const bundled = bundledCliExecutable(this.spec);
      if (bundled) {
        return { command: bundled, prefix: [], shell: false };
      }
      // 7) PATH 上已有的 CLI（brew / scoop / 手工安装的 shim）
      const onPath = pathCliExecutable(this.spec.bin);
      if (onPath !== undefined) {
        const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(onPath);
        return { command: onPath, prefix: [], shell: viaShell };
      }
      // 8) 官方 release 按需下载（macOS / Linux / arm 等包里未携带的平台）
      const released = await ensureReleaseCli(this.spec);
      if (released) {
        return { command: released, prefix: [], shell: false };
      }
    }
    // 9) 回退：shell 执行（Windows shim）
    return { command: bin, prefix: [], shell: process.platform === "win32", fallback: true };
  }
}

/** 包根目录（dist/cli → 包根；源码运行时为仓库根）。 */
function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * 官方独立安装的 CLI 可执行文件（dws install.ps1/install.sh 的默认位置
 * `~/.local/bin/<bin>[.exe]`；`<bin> upgrade` 在此自升级保持最新）。
 */
function standaloneCliExecutable(spec: ImProviderSpec): string | undefined {
  const exe = process.platform === "win32" ? `${spec.bin}.exe` : spec.bin;
  const candidate = join(homedir(), ".local", "bin", exe);
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * 解析随包携带的 CLI 可执行文件：`<包根>/<bundledCliDir>/<platform>-<arch>/<exe>`。
 * 找不到（平台未携带）返回 undefined，由全局安装或 shell 回退。
 */
function bundledCliExecutable(spec: ImProviderSpec): string | undefined {
  if (spec.bundledCliDir === undefined) return undefined;
  const exe = process.platform === "win32" ? `${spec.bin}.exe` : spec.bin;
  const candidate = join(packageRoot(), spec.bundledCliDir, `${process.platform}-${process.arch}`, exe);
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * 在 PATH 上查找同名的 CLI 可执行文件（Windows 依次尝试 .exe/.cmd/.bat）。
 * @param bin - 命令名。
 * @param env - 环境变量，默认 process.env（测试注入用）。
 * @returns 绝对路径，找不到时 undefined。
 */
export function pathCliExecutable(bin: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dirs = (env.PATH ?? env.Path ?? "").split(process.platform === "win32" ? ";" : ":");
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""];
  for (const dir of dirs) {
    const trimmed = dir.trim().replace(/^"|"$/g, "");
    if (trimmed === "") continue;
    for (const suffix of suffixes) {
      const candidate = join(trimmed, bin + suffix);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * 解析随包安装的 CLI 脚本（包内 node_modules，如 optionalDependencies）。
 * 返回可直接用 `node <script>` 执行的脚本路径；找不到返回 undefined。
 */

/** 通过包 manifest 的 bin 字段定位脚本（兼容 binScript 与实际 bin 布局不同的情况）。 */
async function cliScriptFromManifest(spec: ImProviderSpec): Promise<string | undefined> {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve(`${spec.npmPackage}/package.json`);
    const manifest = JSON.parse(readFileSync(pkgJson, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const pkgDir = dirname(pkgJson);
    const bins = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
    for (const rel of bins) {
      const script = join(pkgDir, rel);
      if (existsSync(script)) return script;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function parseStdoutJson(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** wecom-cli 的错误信封：结构化错误写在 stdout，形如 `{errcode, errmsg, help_message}`。 */
function parseWecomError(stdout: string): { errcode: number; message: string; hint?: string } | undefined {
  const text = stdout.trim();
  if (!text.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(text) as { errcode?: unknown; errmsg?: unknown; help_message?: unknown };
    if (typeof parsed.errcode !== "number" || parsed.errcode === 0) return undefined;
    const message = typeof parsed.errmsg === "string" && parsed.errmsg !== ""
      ? parsed.errmsg
      : `wecom-cli errcode ${parsed.errcode}`;
    const hint = typeof parsed.help_message === "string" ? parsed.help_message : undefined;
    return { errcode: parsed.errcode, message, ...(hint === undefined ? {} : { hint }) };
  } catch {
    return undefined;
  }
}

/** 进程内缓存的 npm 全局根（解析一次即可；失败不缓存，下次重试）。 */
let npmGlobalRootMemo: string | undefined;

async function npmGlobalRoot(): Promise<string | null> {
  if (npmGlobalRootMemo !== undefined) return npmGlobalRootMemo;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    // Windows 上 npm 是 .cmd shim：必须走 shell；整串命令传参避免 DEP0190（args+shell 不转义）
    const { stdout } =
      process.platform === "win32"
        ? await run("npm root -g", { timeout: 10_000, windowsHide: true, shell: true })
        : await run("npm", ["root", "-g"], { timeout: 10_000, windowsHide: true });
    // cmd 输出可能带 CRLF 与多行；取最后一个非空行（即路径）
    const root = String(stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .pop() ?? "";
    if (root !== "") npmGlobalRootMemo = root;
    return root || null;
  } catch {
    return null;
  }
}
