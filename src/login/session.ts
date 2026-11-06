import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliRunner } from "../cli/runner.js";
import type { ImProviderSpec } from "../providers/types.js";

/** 一次登录会话的可观察状态。 */
export interface LoginSnapshot {
  provider: string;
  displayName: string;
  running: boolean;
  startedAt: number;
  endedAt?: number;
  exitCode: number | null;
  /** 输出尾部（用于展示授权链接 / 设备码 / 错误信息）。 */
  output: string;
  /** 二维码 PNG 的 data URL（企微扫码文件 / 钉钉设备码短链生成）。 */
  qrDataUrl?: string;
  /** 二维码文件路径（若 CLI 输出到文件）。 */
  qrPath?: string;
  /** 设备码流程的验证码（钉钉，扫码后如需手动输入）。 */
  userCode?: string;
}

/** 登录状态查询结果。 */
export interface LoginStatusResult {
  provider: string;
  authorized: boolean;
  running: boolean;
  /** 登录进程退出码（未结束时为 null）。 */
  exitCode: number | null;
  /** auth 查询的原始结果（JSON 或文本）。 */
  auth?: unknown;
  authError?: string;
  output: string;
  qrDataUrl?: string;
  userCode?: string;
}

interface LiveSession {
  child: ChildProcess;
  output: string;
  startedAt: number;
  endedAt?: number;
  exitCode: number | null;
  qrPath?: string;
  /** 二维码 data URL（企微读文件 / 设备码短链生成后缓存于此）。 */
  qrDataUrl?: string;
  /** 设备码流程：从输出解析出的授权短链（已含验证码）。 */
  deviceUrl?: string;
  userCode?: string;
  timer?: NodeJS.Timeout;
}

/** 每个 provider 最多一个进行中的登录会话。 */
const sessions = new Map<string, LiveSession>();

const MAX_OUTPUT = 8 * 1024;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const QR_WAIT_MS = 5_000;
/** 设备码流程等待授权链接出现在输出中的时限。 */
const DEVICE_URL_WAIT_MS = 8_000;

/** 设备码流程的授权信息。 */
export interface DeviceGrant {
  /** 已填入验证码的授权链接（扫码后手机上直接确认）。 */
  url: string;
  /** 验证码（部分场景需手动输入）。 */
  userCode?: string;
}

const DEVICE_URL_RE = /https:\/\/login\.dingtalk\.com\/oauth2\/device\/verify\.htm\?[^\s]+user_code=[A-Z0-9-]+/u;
const DEVICE_CODE_RE = /授权码[:：]\s*([A-Z0-9-]+)/u;

/** 从设备码流程输出中解析授权链接与验证码。 */
export function extractDeviceGrant(text: string): DeviceGrant | undefined {
  const url = DEVICE_URL_RE.exec(text)?.[0];
  if (url === undefined) return undefined;
  const userCode = DEVICE_CODE_RE.exec(text)?.[1];
  return { url, ...(userCode === undefined ? {} : { userCode }) };
}

const qrCache = new Map<string, string>();

/** 为任意文本生成二维码 PNG data URL（带缓存；失败返回 undefined）。 */
export async function qrDataUrlFor(text: string): Promise<string | undefined> {
  const hit = qrCache.get(text);
  if (hit !== undefined) return hit;
  try {
    const { toDataURL } = await import("qrcode");
    const url = await toDataURL(text, { width: 320, margin: 2 });
    qrCache.set(text, url);
    return url;
  } catch {
    return undefined;
  }
}

/** 若输出中已出现设备码授权链接则记录到会话。 */
function parseDeviceOutput(session: LiveSession): void {
  if (session.deviceUrl !== undefined) return;
  const grant = extractDeviceGrant(session.output);
  if (grant === undefined) return;
  session.deviceUrl = grant.url;
  if (grant.userCode !== undefined) session.userCode = grant.userCode;
}

/** 会话读取路径共用的二维码就绪逻辑：文件（企微）或短链生成（钉钉设备码）。 */
async function ensureQrDataUrl(session: LiveSession): Promise<void> {
  if (session.qrPath !== undefined && session.qrDataUrl === undefined && hasNonEmptyFile(session.qrPath)) {
    session.qrDataUrl = pngDataUrl(session.qrPath);
  }
  parseDeviceOutput(session);
  if (session.qrDataUrl === undefined && session.deviceUrl !== undefined) {
    session.qrDataUrl = await qrDataUrlFor(session.deviceUrl);
  }
}

/**
 * 发起登录（后台进程，不阻塞）：
 * - 钉钉：`dws auth login --recommend` 会打开浏览器完成授权；
 * - 企业微信：`auth init --noninteractive --output-qrcode <png>` 生成扫码图。
 * 返回会话快照；已有进行中的会话则直接返回当前状态。
 */
export async function startLogin(
  spec: ImProviderSpec,
  runner: CliRunner,
  opts: { bin?: string; mode?: "browser" | "device" } = {},
): Promise<LoginSnapshot> {
  const existing = sessions.get(spec.id);
  if (existing && existing.exitCode === null) {
    return await snapshot(spec, existing);
  }

  const launch = await runner.resolveLaunch(opts.bin);
  const base =
    opts.mode === "device" && spec.deviceLoginArgs !== undefined
      ? spec.deviceLoginArgs
      : (spec.loginArgs ?? ["auth", "login"]);
  const args = [...base];

  let qrPath: string | undefined;
  if (spec.qrOutputFlag) {
    qrPath = join(tmpdir(), `im-connector-${spec.id}-${Date.now()}.png`);
    if (existsSync(qrPath)) rmSync(qrPath, { force: true });
    args.push(spec.qrOutputFlag, qrPath);
  }

  const child = spawn(launch.command, [...launch.prefix, ...args], {
    shell: launch.shell,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const session: LiveSession = {
    child,
    output: "",
    startedAt: Date.now(),
    exitCode: null,
    qrPath,
  };
  sessions.set(spec.id, session);

  const append = (chunk: Buffer): void => {
    session.output = (session.output + chunk.toString("utf8")).slice(-MAX_OUTPUT);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("exit", (code) => {
    session.exitCode = code;
    session.endedAt = Date.now();
    if (session.timer) clearTimeout(session.timer);
  });
  child.on("error", (e) => {
    session.output = (session.output + `\n[launch error] ${e.message}`).slice(-MAX_OUTPUT);
    session.exitCode = -1;
    session.endedAt = Date.now();
  });
  session.timer = setTimeout(() => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }, LOGIN_TIMEOUT_MS);

  // 企业微信：等待二维码 PNG 写盘并写完（最多 QR_WAIT_MS）
  if (qrPath) {
    const deadline = Date.now() + QR_WAIT_MS;
    while (Date.now() < deadline && !hasNonEmptyFile(qrPath) && session.exitCode === null) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // 钉钉设备码：等待授权链接出现在输出中（最多 DEVICE_URL_WAIT_MS）
  if (opts.mode === "device" && qrPath === undefined) {
    const deadline = Date.now() + DEVICE_URL_WAIT_MS;
    while (Date.now() < deadline && session.exitCode === null && session.deviceUrl === undefined) {
      parseDeviceOutput(session);
      if (session.deviceUrl !== undefined) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  return await snapshot(spec, session);
}

/** 查询登录状态：auth 查询 + 会话运行状态 + 二维码（若仍在生成中）。 */
export async function loginStatus(
  spec: ImProviderSpec,
  runner: CliRunner,
  opts: { bin?: string } = {},
): Promise<LoginStatusResult> {
  const session = sessions.get(spec.id);
  const result: LoginStatusResult = {
    provider: spec.id,
    authorized: false,
    running: false,
    exitCode: session?.exitCode ?? null,
    output: session?.output ?? "",
  };
  if (session) {
    result.running = session.exitCode === null;
    await ensureQrDataUrl(session);
    if (session.qrDataUrl !== undefined) result.qrDataUrl = session.qrDataUrl;
    if (session.userCode !== undefined) result.userCode = session.userCode;
    // 存在登录会话时不再拉起 CLI 查询 auth：等待扫码期间每 3 秒轮询一次，
    // 逐次拉起 CLI 既慢又无意义；此场景下的授权判定由调用方按会话退出码推导。
    return result;
  }
  if (spec.authArgs) {
    try {
      const data = await runner.runJson(spec.authArgs, { bin: opts.bin });
      result.auth = data;
      result.authorized = authorizedOf(data);
    } catch (e) {
      result.authError = e instanceof Error ? e.message : String(e);
    }
  }
  return result;
}

/** 结束并清理登录会话。 */
export function stopLogin(provider: string): boolean {
  const session = sessions.get(provider);
  if (!session) return false;
  if (session.timer) clearTimeout(session.timer);
  try {
    session.child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  sessions.delete(provider);
  return true;
}

/** 把各种 CLI 的认证输出归一化为布尔值。 */
export function authorizedOf(data: unknown): boolean {
  if (typeof data === "string") {
    const text = data.trim().toLowerCase();
    return text === "authorized" || text === "ok" || text === "true";
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["authenticated", "authorized", "authorized_status", "logged_in", "success"]) {
      const value = record[key];
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() === "authorized" || value === "true";
    }
    // wecom-cli 的 auth show 可能包一层 results
    const nested = record.results ?? record.result;
    if (nested !== undefined) return authorizedOf(nested);
  }
  return false;
}

async function snapshot(spec: ImProviderSpec, session: LiveSession): Promise<LoginSnapshot> {
  const snap: LoginSnapshot = {
    provider: spec.id,
    displayName: spec.displayName,
    running: session.exitCode === null,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    exitCode: session.exitCode,
    output: session.output,
  };
  await ensureQrDataUrl(session);
  if (session.qrPath !== undefined) snap.qrPath = session.qrPath;
  if (session.qrDataUrl !== undefined) snap.qrDataUrl = session.qrDataUrl;
  if (session.userCode !== undefined) snap.userCode = session.userCode;
  return snap;
}

function pngDataUrl(path: string): string | undefined {
  try {
    const bytes = readFileSync(path);
    if (bytes.length === 0) return undefined;
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** PNG 是否已写盘且写完（CLI 会先创建空文件再写入内容）。 */
function hasNonEmptyFile(path: string): boolean {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}
