export interface ConnectorOptions {
  /** dws 可执行入口。默认 "dws"（走 npm 全局安装解析）。测试可传 fake dws.js 路径。 */
  dwsBin?: string;
  /** 一次性指定组织/账号（`corpId:userId`），可选。 */
  profile?: string;
  /** 传给 dws 的 HTTP 超时（秒）。默认 30。 */
  timeoutSec?: number;
  /** 附加环境变量（如 DWS_CHANNEL），可选。 */
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedConnectorOptions {
  dwsBin: string;
  profile?: string;
  timeoutSec: number;
  env?: NodeJS.ProcessEnv;
}

export function resolveOptions(opts: ConnectorOptions): ResolvedConnectorOptions {
  return {
    dwsBin: opts.dwsBin?.trim() || "dws",
    profile: opts.profile?.trim() || undefined,
    timeoutSec: opts.timeoutSec ?? 30,
    env: opts.env,
  };
}

/**
 * 从环境变量加载配置：
 * DINGTALK_DWS_BIN、DINGTALK_DWS_PROFILE、DINGTALK_DWS_TIMEOUT（可选）。
 * 连接器本身不强制凭证——认证由 dws 的 OAuth 登录态（dws auth login）管理。
 */
export function loadEnvOptions(env: NodeJS.ProcessEnv = process.env): ConnectorOptions | null {
  const dwsBin = env.DINGTALK_DWS_BIN?.trim();
  const profile = env.DINGTALK_DWS_PROFILE?.trim();
  const timeoutSec = env.DINGTALK_DWS_TIMEOUT ? Number(env.DINGTALK_DWS_TIMEOUT) : undefined;
  // dws 走本地登录态，无需强制的 appKey/appSecret；无任何配置也可运行（用默认 dws）。
  if (!dwsBin && !profile && !timeoutSec) return null;
  return {
    ...(dwsBin ? { dwsBin } : {}),
    ...(profile ? { profile } : {}),
    ...(timeoutSec && Number.isFinite(timeoutSec) ? { timeoutSec } : {}),
  };
}
