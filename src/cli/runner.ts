import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
    // 3) 默认 bin：解析 npm 全局包内脚本
    if (bin === this.spec.bin) {
      const globalRoot = await npmGlobalRoot();
      if (globalRoot) {
        const script = join(globalRoot, ...this.spec.binScript.split("/"));
        if (existsSync(script)) {
          return { command: process.execPath, prefix: [script], shell: false };
        }
      }
    }
    // 4) 回退：shell 执行（Windows shim）
    return { command: bin, prefix: [], shell: process.platform === "win32" };
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
