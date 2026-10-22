import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImProviderSpec } from "../providers/types.js";
import { CliError, parseErrorEnvelope } from "./errors.js";

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

  private async execute(
    displayArgs: string[],
    cliArgs: string[],
    opts?: CliRunOptions,
  ): Promise<CliExecution> {
    const launch = await this.launch(opts?.bin);
    const finalArgs = [...launch.prefix, ...cliArgs];
    const command = `${this.spec.bin} ${displayArgs.join(" ")}`;
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
          }),
        );
      });
      child.on("exit", (code) => {
        opts?.signal?.removeEventListener("abort", onAbort);
        const parsed = parseStdoutJson(stdout);
        if (code !== 0) {
          const envelope = parseErrorEnvelope(stderr);
          reject(
            new CliError({
              message:
                envelope?.error?.message ?? stderr.trim() ?? `${this.spec.bin} exited with code ${code}`,
              command,
              stderr,
              exitCode: code,
              code: envelope?.error?.code,
              category: envelope?.error?.category,
              reason: envelope?.error?.reason,
              retryable: envelope?.error?.retryable,
              hint: envelope?.error?.hint,
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
    // 3) 随包携带的 CLI 二进制（如 vendor/dws/win32-x64/dws.exe，开箱即用）
    if (bin === this.spec.bin) {
      const bundled = bundledCliExecutable(this.spec);
      if (bundled) {
        return { command: bundled, prefix: [], shell: false };
      }
      // 4) 回退：npm 全局安装的 CLI
      const globalRoot = await npmGlobalRoot();
      if (globalRoot) {
        const script = join(globalRoot, ...this.spec.binScript.split("/"));
        if (existsSync(script)) {
          return { command: process.execPath, prefix: [script], shell: false };
        }
      }
      // 5) 通过 package.json 的 bin 字段再找一次（处理 binScript 与安装布局不一致）
      const viaManifest = await cliScriptFromManifest(this.spec);
      if (viaManifest) {
        return { command: process.execPath, prefix: [viaManifest], shell: false };
      }
    }
    // 6) 回退：shell 执行（Windows shim）
    return { command: bin, prefix: [], shell: process.platform === "win32" };
  }
}

/** 包根目录（dist/cli → 包根；源码运行时为仓库根）。 */
function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

async function npmGlobalRoot(): Promise<string | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run("npm", ["root", "-g"], { timeout: 10_000, windowsHide: true });
    const root = String(stdout).trim();
    return root || null;
  } catch {
    return null;
  }
}
