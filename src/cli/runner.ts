import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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

interface LaunchSpec {
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

  async run(args: string[], opts?: CliRunOptions): Promise<CliExecution> {
    const spec = await this.launch(opts?.bin);
    const finalArgs = [...spec.prefix, ...args, ...this.spec.formatArgs];
    const command = `${this.spec.bin} ${args.join(" ")}`;
    return new Promise<CliExecution>((resolve, reject) => {
      const child = spawn(spec.command, finalArgs, {
        shell: spec.shell,
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
            message: `Failed to launch ${this.spec.bin} (${spec.command}): ${e.message}`,
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
    // 3) 随包安装的 CLI（optionalDependencies 里的依赖，开箱即用）
    if (bin === this.spec.bin) {
      const local = localCliScript(this.spec);
      if (local) {
        return { command: process.execPath, prefix: [local], shell: false };
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

/**
 * 解析随包安装的 CLI 脚本（包内 node_modules，如 optionalDependencies）。
 * 返回可直接用 `node <script>` 执行的脚本路径；找不到返回 undefined。
 */
function localCliScript(spec: ImProviderSpec): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve(`${spec.npmPackage}/package.json`);
    const pkgDir = dirname(pkgJson);
    // binScript = "<npmPackage>/bin/xxx.js" → 相对包目录的脚本路径
    const rel = spec.binScript.slice(spec.npmPackage.length + 1);
    const script = join(pkgDir, rel);
    if (existsSync(script)) return script;
    return undefined;
  } catch {
    return undefined;
  }
}

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
