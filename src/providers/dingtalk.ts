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
  versionArgs: ["--version"],
  authArgs: ["auth", "status"],
  examples: [
    '["contact","+me"]',
    '["contact","+search-user","--query","张三"]',
    '["calendar","+today"]',
    '["todo","+get-my-tasks"]',
    '["oa","approval","list-pending"] / ["oa","approval","detail","--instance-id","<id>"]',
    '["attendance","+check-result","--users","u1,u2","--start","2026-10-01","--end","2026-10-10"]',
    '["report","inbox","list"] / ["report","entry","get","--report-id","<id>"]',
    '["doc","read","--node","<docId|url>"] / ["wiki","+space-list"]',
    '["chat","+chat-messages","--group","<群名|id>","--limit","20"] / ["chat","+search-msg","--query","<kw>"]',
    '写：["chat","+messages-send","--group","<cid>","--markdown","内容","--title","标题","--yes"]',
    '其他服务域（dws --help 查看）：aicard / api / attendance / audit / contract / devapp / devdoc / ding / drive / hrbrain / live / mail / minutes / sheet / whiteboard / wiki …',
  ],
};
