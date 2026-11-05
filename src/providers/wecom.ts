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
  loginArgs: ["auth", "init", "--noninteractive", "--no-browser"],
  qrOutputFlag: "--output-qrcode",
  examples: [
    '["contact","users","search","--keywords","张三"]',
    '["message","aibot","sessions","list"]',
    '["message","aibot","send","--json","{\\"chat_id\\":\\"<id>\\",\\"msg_type\\":\\"markdown\\",\\"markdown\\":{\\"content\\":\\"通知\\"}}"]',
    '["todo","create","--title","提交周报","--due","2026-11-07 18:00"] / ["todo","list"]',
    '["calendar","create","--title","评审会","--start","2026-11-06 10:00"] / ["calendar","list"]',
    '["doc","create","--title","会议纪要"] / ["smartpage","create","--title","周报"]',
    '["sheet","create","--title","数据表"] / ["disk","list"] / ["email","list"]',
    '["auth","show","--status"]',
    '通用形态：["<service>","<resource>","<operation>",...flags]；--schema 查看方法 schema，--page-count 自动分页（NDJSON），--dry-run 预览不发送。',
  ],
};
