import type { ImProviderSpec } from "./types.js";

/** 钉钉：通过 dws（dingtalk-workspace-cli）透传。 */
export const dingtalk: ImProviderSpec = {
  id: "dingtalk",
  displayName: "钉钉",
  bin: "dws",
  npmPackage: "dingtalk-workspace-cli",
  binScript: "dingtalk-workspace-cli/bin/dws.js",
  formatArgs: ["--format", "json"],
  envBin: "DINGTALK_DWS_BIN",
  bundledCliDir: "vendor/dws",
  // 包里只带 win32-x64 兜底（离线 Windows 可用）；macOS / Linux / arm 架构
  // 首次使用时按需从官方 release 下载并校验。
  release: {
    repo: "DingTalk-Real-AI/dingtalk-workspace-cli",
    assets: {
      "win32-x64": "dws-windows-amd64.zip",
      "win32-arm64": "dws-windows-arm64.zip",
      "darwin-x64": "dws-darwin-amd64.tar.gz",
      "darwin-arm64": "dws-darwin-arm64.tar.gz",
      "linux-x64": "dws-linux-amd64.tar.gz",
      "linux-arm64": "dws-linux-arm64.tar.gz",
    },
  },
  versionArgs: ["--version"],
  authArgs: ["auth", "status"],
  loginArgs: ["auth", "login", "--recommend"],
  deviceLoginArgs: ["auth", "login", "--device"],
  examples: [
    '["contact","+me"] / ["contact","+search-user","--query","张三"]',
    '["calendar","+today"] / ["calendar","+create","--title","评审会","--start","2026-11-06 10:00"]',
    '["todo","+get-my-tasks"] / ["todo","+create","--title","提交周报","--due","2026-11-07 18:00"]',
    '["oa","approval","list-pending"] / ["oa","approval","detail","--instance-id","<id>"]',
    '["attendance","+check-result","--users","u1,u2","--start","2026-10-01","--end","2026-10-10"]',
    '["report","template","list"] / ["report","entry","submit","--template-id","<id>","--contents-file","<json>"]',
    '["doc","read","--node","<docId|url>"] / ["wiki","+space-list"] / ["drive","list"]',
    '["chat","+chat-messages","--group","<群名|id>","--limit","20"] / ["chat","+search-msg","--query","<kw>"]',
    '["mail","inbox","list"] / ["minutes","list"] / ["sheet","get","--node","<id>"]',
    '["aicard","+validate","--file","<a2ui.json>"] / ["api","<method>","--path","<openapi>"]',
    '["agoal","+my-goals"] / ["hrbrain","talent","search","--query","<kw>"] / ["contract","list"]',
    '写：["chat","+messages-send","--group","<cid>","--markdown","内容","--title","标题","--yes"]',
  ],
};
