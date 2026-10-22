import type { ImProviderSpec } from "./types.js";

/** 企业微信：通过 wecom-cli（@wecom/cli）透传。JSON 为默认输出，无需 --format。 */
export const wecom: ImProviderSpec = {
  id: "wecom",
  displayName: "企业微信",
  bin: "wecom-cli",
  npmPackage: "@wecom/cli",
  binScript: "@wecom/cli/bin/wecom.js",
  formatArgs: [],
  envBin: "WECOM_CLI_BIN",
  versionArgs: ["--version"],
  authArgs: ["auth", "show", "--status"],
  loginArgs: ["auth", "init", "--noninteractive"],
  qrOutputFlag: "--output-qrcode",
  examples: [
    '["contact","users","search","--keywords","张三"]',
    '["chat","messages","list","--chat-id","<id>","--begin-time","2026-10-01 00:00:00","--end-time","2026-10-21 00:00:00"]',
    '["message","send","--chat-id","<id>","--msg-type","text","--text","{\\"content\\":\\"通知\\"}"]',
    '["auth","show","--status"]',
    '通用形态：["<service>","<resource>","<operation>",...flags]；--schema 查看方法 schema，--page-count 自动分页（NDJSON），--dry-run 预览不发送。',
  ],
};
