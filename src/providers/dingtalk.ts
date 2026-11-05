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
  versionArgs: ["--version"],
  authArgs: ["auth", "status"],
  loginArgs: ["auth", "login", "--recommend"],
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
