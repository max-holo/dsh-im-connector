/**
 * 按需下载官方 CLI 二进制（GitHub Releases）。
 *
 * 包里只携带 win32-x64 兜底；其他平台（macOS / Linux / arm）首次使用时
 * 从官方 release 取对应资产，用同一 release 的 checksums.txt 校验 sha256，
 * 解压到用户缓存目录后直接执行。这样 `安装插件 → 直接可用` 在所有平台成立，
 * 且 npm 包不必带几百 MB 的多平台二进制。
 *
 * 诊断只写 stderr：MCP 的 stdout 是 JSON-RPC 协议通道，不能混入日志。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CliReleaseSpec, ImProviderSpec } from "../providers/types.js";

/** 下载一个 release 资产可注入的测试钩子与平台覆盖。 */
export interface ReleaseOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  /** 覆盖「下载 URL → 本地文件」，测试用。 */
  fetchFile?: (url: string, dest: string) => Promise<void>;
  /** 覆盖「下载 URL → 文本」，测试用。 */
  fetchText?: (url: string) => Promise<string>;
  /** 诊断输出，默认 stderr。 */
  log?: (message: string) => void;
}

/** 最近一次自动下载的结果：`info` 工具据此解释「为什么没有 dws」。 */
export interface ReleaseAttempt {
  /** 是否真的发起过下载（命中缓存或未启用下载时为 false）。 */
  attempted: boolean;
  ok: boolean;
  path?: string;
  error?: string;
}

let lastAttempt: ReleaseAttempt | undefined;

/** 读取最近一次自动下载结果（只读）。 */
export function releaseStatus(): ReleaseAttempt | undefined {
  return lastAttempt;
}

/**
 * 一个用户/模型可以照做的修复清单：安装官方 CLI、走镜像、指定路径、离线模式。
 * @param spec - 目标平台规格（只需 bin 与 release）。
 */
export function cliMissingHint(spec: ImProviderSpec): string {
  const status = lastAttempt;
  const reason = status?.error === undefined ? "" : `（${status.error}）`;
  const repo = spec.release?.repo ?? "DingTalk-Real-AI/dingtalk-workspace-cli";
  return [
    `${spec.bin} 不可用：本机没有找到它，自动下载也没有成功${reason}。请任选一种方式修复后重试：`,
    `1) 安装官方 CLI：macOS/Linux \`curl -fsSL https://raw.githubusercontent.com/${repo}/main/scripts/install.sh | sh\`；Windows \`irm https://raw.githubusercontent.com/${repo}/main/scripts/install.ps1 | iex\``,
    `2) 走镜像下载：设置环境变量 DINGTALK_DWS_DOWNLOAD_BASE=<镜像前缀> 后重启 DSH，再调用一次 info`,
    `3) 已有 ${spec.bin}：设置 DINGTALK_DWS_BIN=/绝对路径/${spec.bin} 后重启 DSH`,
    `4) 离线环境：设置 DINGTALK_DWS_NO_DOWNLOAD=1，并把 ${spec.bin} 放到 PATH 或 ~/.local/bin`,
  ].join("\n");
}

/** 用户缓存根目录：IM_CONNECTOR_CACHE_DIR > LOCALAPPDATA/XDG_CACHE_HOME > ~/.cache。 */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.IM_CONNECTOR_CACHE_DIR?.trim();
  if (override !== undefined && override !== "") return override;
  if (process.platform === "win32") {
    const local = env.LOCALAPPDATA?.trim();
    if (local !== undefined && local !== "") return join(local, "im-connector");
  }
  const xdg = env.XDG_CACHE_HOME?.trim();
  if (xdg !== undefined && xdg !== "") return join(xdg, "im-connector");
  return join(homedir(), ".cache", "im-connector");
}

/** 平台 + 架构键，如 "darwin-arm64"。 */
export function releasePlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

/** 该平台对应的 release 资产名；没有则 undefined。 */
export function releaseAssetName(spec: CliReleaseSpec, key: string): string | undefined {
  return spec.assets[key];
}

/** 解析 checksums.txt（`<sha256>  <file>` 或 `<sha256> *<file>`）。 */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([0-9a-fA-F]{64})[ \t]+\*?(.+)$/.exec(line);
    if (match === null) continue;
    sums.set(match[2]!.trim(), match[1]!.toLowerCase());
  }
  return sums;
}

function executableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "dws.exe" : "dws";
}

function pointerFile(key: string, env?: NodeJS.ProcessEnv): string {
  return join(cacheRoot(env), "dws", `current-${key}`);
}

/** 已经下载好的二进制（指针文件或缓存扫描）。 */
export function installedReleaseCli(
  spec: ImProviderSpec,
  options: ReleaseOptions = {},
): string | undefined {
  if (spec.release === undefined) return undefined;
  const platform = options.platform ?? process.platform;
  const key = releasePlatformKey(platform, options.arch ?? process.arch);
  const exe = executableName(platform);
  const pointer = pointerFile(key, options.env);
  try {
    if (existsSync(pointer)) {
      const recorded = readFileSync(pointer, "utf8").trim();
      if (recorded !== "" && existsSync(recorded)) return recorded;
    }
  } catch {
    /* 指针损坏时继续扫描 */
  }
  const root = join(cacheRoot(options.env), "dws");
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(root, entry.name, key, exe);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* 缓存目录还不存在 */
  }
  return undefined;
}

let attempted: Promise<string | undefined> | undefined;

/**
 * 确保有可用的官方二进制：命中缓存直接返回，否则下载 + 校验 + 解压。
 * 每个进程只尝试一次；失败返回 undefined，由调用方回退到 PATH。
 */
export async function ensureReleaseCli(
  spec: ImProviderSpec,
  options: ReleaseOptions = {},
): Promise<string | undefined> {
  const release = spec.release;
  if (release === undefined) return undefined;
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string): void => { process.stderr.write(`[im-connector] ${message}\n`); });
  if (env[release.disableEnv ?? "DINGTALK_DWS_NO_DOWNLOAD"] === "1") {
    lastAttempt = { attempted: false, ok: false, error: "自动下载已被 DINGTALK_DWS_NO_DOWNLOAD=1 关闭" };
    return undefined;
  }
  const existing = installedReleaseCli(spec, options);
  if (existing !== undefined) {
    lastAttempt = { attempted: false, ok: true, path: existing };
    return existing;
  }
  if (attempted !== undefined) return attempted;
  attempted = downloadRelease(release, options, log).then(
    (path) => {
      lastAttempt = path === undefined
        ? { attempted: true, ok: false, error: "官方未提供该平台的构建" }
        : { attempted: true, ok: true, path };
      return path;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      lastAttempt = { attempted: true, ok: false, error: message };
      log(`自动下载 dws 失败：${message}`);
      return undefined;
    },
  );
  return attempted;
}

async function downloadRelease(
  release: CliReleaseSpec,
  options: ReleaseOptions,
  log: (message: string) => void,
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const key = releasePlatformKey(platform, options.arch ?? process.arch);
  const asset = releaseAssetName(release, key);
  if (asset === undefined) {
    log(`官方没有 ${key} 的 dws 构建`);
    return undefined;
  }
  const version = env[release.versionEnv ?? "DINGTALK_DWS_VERSION"]?.trim() || "latest";
  // DINGTALK_DWS_DOWNLOAD_BASE 覆盖下载前缀（内网镜像 / GitHub 代理 / 测试）。
  const override = env.DINGTALK_DWS_DOWNLOAD_BASE?.trim();
  const base = override !== undefined && override !== ""
    ? override.replace(/\/+$/, "")
    : version === "latest"
      ? `https://github.com/${release.repo}/releases/latest/download`
      : `https://github.com/${release.repo}/releases/download/${encodeURIComponent(version)}`;
  const fetchText = options.fetchText ?? fetchTextFrom;
  const fetchFile = options.fetchFile ?? downloadToFile;
  const deadlineMs = Number(env.DINGTALK_DWS_DOWNLOAD_TIMEOUT_MS ?? 180_000);
  const checksums = parseChecksums(await withDeadline(fetchText(`${base}/${release.checksumsAsset ?? "checksums.txt"}`), deadlineMs, "checksums.txt"));
  const expected = checksums.get(asset);
  if (expected === undefined) throw new Error(`checksums.txt 未列出 ${asset}`);
  log(`下载 dws（${key}，${asset}，${version}）…`);
  const staging = mkdtempSync(join(tmpdir(), "im-connector-dws-"));
  try {
    const archive = join(staging, asset);
    await withDeadline(fetchFile(`${base}/${asset}`, archive), deadlineMs, asset);
    const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
    if (actual !== expected) throw new Error(`${asset} 的 sha256 与 checksums.txt 不一致`);
    const target = join(cacheRoot(options.env), "dws", version, key);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    extract(archive, target);
    const exe = findExecutable(target, executableName(platform));
    if (exe === undefined) throw new Error(`解压后没有找到 ${executableName(platform)}`);
    chmodSync(exe, 0o755);
    mkdirSync(join(cacheRoot(options.env), "dws"), { recursive: true });
    writeFileSync(pointerFile(key, options.env), exe, "utf8");
    log(`dws 已就绪：${exe}`);
    return exe;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** 用系统 tar 解压（macOS/Linux 自带 bsdtar/GNU tar；Windows 10+ 自带 bsdtar，可解 zip）。 */
function extract(archive: string, target: string): void {
  const args = archive.toLowerCase().endsWith(".zip")
    ? ["-xf", archive, "-C", target]
    : ["-xzf", archive, "-C", target];
  execFileSync("tar", args, { stdio: "ignore", windowsHide: true });
}

function findExecutable(dir: string, name: string): string | undefined {
  const direct = join(dir, name);
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = join(dir, entry.name, name);
    if (existsSync(nested)) return nested;
  }
  return undefined;
}

const REDIRECT_LIMIT = 5;
const FETCH_TIMEOUT_MS = 180_000;

/** 给下载加墙钟期限：连接建立后数据迟迟不来时（例如被墙），超时即失败而不是一直挂住。 */
async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 下载超时（${ms}ms）`)), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** GET 一个 URL，手动跟随重定向（GitHub release 资产会 302 到对象存储）。 */
function requestUrl(url: string, redirects = 0): Promise<import("node:http").IncomingMessage> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const getter = parsed.protocol === "http:" ? httpGet : httpsGet;
    const request = getter(url, { timeout: FETCH_TIMEOUT_MS }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location !== undefined) {
        response.resume();
        if (redirects >= REDIRECT_LIMIT) {
          reject(new Error(`重定向过多：${url}`));
          return;
        }
        requestUrl(new URL(location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`下载失败（HTTP ${status}）：${url}`));
        return;
      }
      resolve(response);
    });
    request.on("timeout", () => request.destroy(new Error(`下载超时（${FETCH_TIMEOUT_MS}ms）：${url}`)));
    request.on("error", reject);
  });
}

async function fetchTextFrom(url: string): Promise<string> {
  const response = await requestUrl(url);
  return new Promise<string>((resolve, reject) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => { text += chunk; });
    response.on("end", () => resolve(text));
    response.on("error", reject);
  });
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const response = await requestUrl(url);
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(dest);
    response.pipe(out);
    out.on("finish", () => out.close(() => resolve()));
    out.on("error", reject);
    response.on("error", reject);
  });
}
