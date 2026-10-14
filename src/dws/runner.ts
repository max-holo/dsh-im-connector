import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DwsError, parseErrorEnvelope } from "./errors.js";

export type DwsFormat = "json" | "ndjson" | "raw" | "pretty" | "compact";

export interface DwsRunOptions {
  profile?: string;
  timeoutSec?: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface DwsExecution {
  /** 人类可读的命令，如 `dws calendar +today`。 */
  command: string;
  /** 传给 dws 进程的最终参数（不含解释器/脚本前缀）。 */
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** stdout 解析后的 JSON（无法解析时为 null）。 */
  data: unknown;
}

interface LaunchSpec {
  /** 实际执行的命令（node / dws / 显式可执行文件）。 */
  command: string;
  /** 追加在命令之后、业务参数之前的前缀参数（如 dws.js 脚本路径）。 */
  prefix: string[];
  /** 是否用 shell 执行（Windows .cmd/.ps1 shim 需要）。 */
  shell: boolean;
}

/**
 * 运行 `dws` CLI 的执行器。
 *
 * - 通过 `npm root -g` 解析全局安装的 dingtalk-workspace-cli 的 bin/dws.js，
 *   用 node 直接运行（规避 Windows 下 .cmd/.ps1 shim 无法被 spawn(shell:false) 拉起的问题）；
 * - 显式传入 `.js` 路径（测试用 fake dws）时直接以 node 运行；
 * - 否则回退到 shell 执行 `dws`。
 *
 * 每次调用追加 `--format json`（stream 为 ndjson）与可选 `--profile`/`--timeout`。
 * 失败时解析 stderr 中的错误信封并抛出 DwsError。
 */
export class DwsRunner {
  constructor(private readonly options: { bin: string; timeoutSec: number }) {}

  get bin(): string {
    return this.options.bin;
  }

  /** 运行并返回解析后的 stdout JSON。失败抛 DwsError。 */
  async runJson(args: string[], opts?: DwsRunOptions): Promise<unknown> {
    const exec = await this.run(args, opts);
    return exec.data;
  }

  async run(args: string[], opts?: DwsRunOptions): Promise<DwsExecution> {
    const spec = await this.launch();
    const profile = opts?.profile;
    const timeoutSec = opts?.timeoutSec ?? this.options.timeoutSec;
    const finalArgs = [
      ...spec.prefix,
      ...args,
      "--format",
      "json",
      ...(profile ? ["--profile", profile] : []),
      // dws 默认 timeout 为 30 秒，仅在与默认不同时显式传递。
      ...(timeoutSec !== 30 ? ["--timeout", String(timeoutSec)] : []),
    ];
    return this.exec(spec, finalArgs, `dws ${args.join(" ")}`, opts);
  }

  /**
   * 以 NDJSON 流式执行（用于 `dws event consume` / `event +listen-im`）。
   * 每收到完整一行调用 onLine；返回句柄，stop() 优雅停止（SIGTERM + 关闭 stdin）。
   */
  stream(args: string[], onLine: (line: string) => void, opts?: DwsRunOptions): Promise<{ stop: () => void }> {
    return this.launch().then((spec) => {
      const profile = opts?.profile;
      const finalArgs = [
        ...spec.prefix,
        ...args,
        "--format",
        "ndjson",
        ...(profile ? ["--profile", profile] : []),
      ];
      const child = spawn(spec.command, finalArgs, {
        shell: spec.shell,
        cwd: opts?.cwd,
        env: { ...process.env, ...opts?.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let buffer = "";
      let stderrBuf = "";
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString("utf8");
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, "");
          buffer = buffer.slice(idx + 1);
          if (line.trim()) onLine(line);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", (d) => {
        stderrBuf += d.toString("utf8");
      });
      child.on("error", (e) => {
        onLine(`\u0000error:${e.message}`);
      });
      child.on("exit", (code) => {
        // 让调用方通过 onLine 之外的能力感知结束：以特殊前缀行发出（仅在非零退出时）。
        if (code !== 0 && code !== null && stderrBuf.trim()) {
          onLine(`\u0000stderr:${stderrBuf.trim()}`);
        }
      });
      if (opts?.signal) {
        opts.signal.addEventListener(
          "abort",
          () => {
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
          },
          { once: true },
        );
      }
      return {
        stop: () => {
          try {
            child.stdin.end();
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        },
      };
    });
  }

  private async exec(
    spec: LaunchSpec,
    args: string[],
    command: string,
    opts?: DwsRunOptions,
  ): Promise<DwsExecution> {
    return new Promise<DwsExecution>((resolve, reject) => {
      const child = spawn(spec.command, args, {
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
          new DwsError({
            message: `Failed to launch dws (${spec.command}): ${e.message}`,
            command,
            retryable: true,
          }),
        );
      });
      child.on("exit", (code) => {
        if (opts?.signal) opts.signal.removeEventListener("abort", onAbort);
        const parsed = parseStdoutJson(stdout);
        if (code !== 0) {
          const envelope = parseErrorEnvelope(stderr);
          reject(
            new DwsError({
              message: envelope?.error?.message ?? stderr.trim() ?? `dws exited with code ${code}`,
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
        resolve({
          command,
          args,
          stdout,
          stderr,
          exitCode: code,
          data: parsed,
        });
      });
    });
  }

  private async launch(): Promise<LaunchSpec> {
    const bin = this.options.bin || "dws";
    // 1) 显式 node 脚本（测试 fake dws 或用户指到 .js）
    if (bin !== "dws" && /\.(c?js|mjs)$/i.test(bin) && existsSync(bin)) {
      return { command: process.execPath, prefix: [bin], shell: false };
    }
    // 2) 显式可执行文件
    if (bin !== "dws" && existsSync(bin)) {
      return { command: bin, prefix: [], shell: false };
    }
    // 3) 默认 "dws"：优先解析全局安装的 bin/dws.js
    if (bin === "dws") {
      const globalRoot = await npmGlobalRoot();
      if (globalRoot) {
        const script = join(globalRoot, "dingtalk-workspace-cli", "bin", "dws.js");
        if (existsSync(script)) {
          return { command: process.execPath, prefix: [script], shell: false };
        }
      }
    }
    // 4) 回退：shell 执行（Windows 下 dws.cmd 需要 shell）
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
