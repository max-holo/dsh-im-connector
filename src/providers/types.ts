/**
 * 一个 IM 平台（provider）接入规格：如何找到它的 CLI、如何请求 JSON 输出。
 * 未来接入飞书 / Discord 等，只需新增一个 spec 并注册进 registry。
 */
export interface ImProviderSpec {
  /** 稳定 id，用于 MCP 工具的 provider 参数，如 "dingtalk" / "wecom"。 */
  id: string;
  /** 人类可读名称。 */
  displayName: string;
  /** 默认命令名（PATH 上的 shim），如 "dws" / "wecom-cli"。 */
  bin: string;
  /** npm 全局包名，用于解析 bin 脚本（规避 Windows .cmd/.ps1 shim）。 */
  npmPackage: string;
  /** 包内 bin 脚本相对路径（含作用域，用 / 分隔），如 "@wecom/cli/bin/wecom.js"。 */
  binScript: string;
  /** 追加在业务参数之后、用于请求 JSON 输出的 flag；JSON 为默认输出的 CLI 用空数组。 */
  formatArgs: string[];
  /** 覆盖 bin 的环境变量名（可选），如 "DINGTALK_DWS_BIN"。 */
  envBin?: string;
  /** 随包携带的 CLI 二进制目录（相对包根），按 `<platform>-<arch>/` 子目录查找，如 "vendor/dws"。 */
  bundledCliDir?: string;
  /** 查询 CLI 版本的原始参数（不追加 formatArgs），如 ["--version"]。 */
  versionArgs?: string[];
  /** 查询登录状态的命令（走 JSON 输出），如 ["auth","status"]。 */
  authArgs?: string[];
  /** 登录/授权命令（在 MCP 工具里后台执行），如 ["auth","login","--recommend"]。 */
  loginArgs?: string[];
  /** 设备码登录命令（无头/扫码场景），如 ["auth","login","--device"]；缺省回落 loginArgs。 */
  deviceLoginArgs?: string[];
  /** 扫码输出图片的参数名（值为 PNG 路径），如 wecom-cli 的 "--output-qrcode"。 */
  qrOutputFlag?: string;
  /** 展示在 MCP 工具描述里的示例命令（数组形式，便于模型理解）。 */
  examples: string[];
}
