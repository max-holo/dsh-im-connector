#!/usr/bin/env node
// 汇总研发中心同事最近一次周报（发现 + 读取正文）
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function npmGlobalRootSync() {
  const r = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32", windowsHide: true });
  return (r.stdout || "").trim() || null;
}
function resolveLaunch() {
  const bin = process.env.DINGTALK_DWS_BIN || "dws";
  if (bin !== "dws" && existsSync(bin)) return { command: bin, prefix: [], shell: false };
  const root = npmGlobalRootSync();
  if (root) {
    const script = path.join(root, "dingtalk-workspace-cli", "bin", "dws.js");
    if (existsSync(script)) return { command: process.execPath, prefix: [script], shell: false };
  }
  return { command: bin, prefix: [], shell: process.platform === "win32" };
}
function runDws(args) {
  const spec = resolveLaunch();
  const r = spawnSync(spec.command, [...spec.prefix, ...args], { encoding: "utf8", shell: spec.shell, windowsHide: true });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const members = [
  { name: "余海", userId: "16934533618351091" },
  { name: "丁桐", userId: "4442645524645743" },
  { name: "王丽莉", userId: "16914754271765648" },
  { name: "杨春艳", userId: "273667153326283606" },
  { name: "刘晨", userId: "2264616140677712" },
  { name: "杨妍轩", userId: "17446040854467038" },
];

const start = "2026-10-05T00:00:00+08:00";
const end = "2026-11-04T23:59:59+08:00";

for (const m of members) {
  const res = runDws(["report", "+inbox-list", "--start", start, "--end", end, "--sender-user-ids", m.userId, "--cursor", "0", "--size", "20", "--format", "json"]);
  let data = null;
  try { data = JSON.parse(res.stdout); } catch { /* ignore */ }
  const reports = (data && data.data && data.data.reports) || [];
  const weekly = reports.filter((r) => /周报/.test(r.templateName || "")).sort((a, b) => b.createTime - a.createTime);
  const latest = weekly[0];
  const kinds = [...new Set(reports.map((r) => r.templateName))].join(",");
  if (!latest) {
    console.log(`### ${m.name} (${m.userId})：30 天内收件箱无周报（报告类型：${kinds || "无"}，共 ${reports.length} 篇）`);
    continue;
  }
  const t = new Date(latest.createTime);
  const entry = runDws(["report", "entry", "get", "--report-id", latest.reportId, "--format", "json"]);
  console.log(`### ${m.name} (${m.userId}) 最近周报 reportId=${latest.reportId} 时间=${t.toISOString()} (${t.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })})`);
  console.log("ENTRY_JSON_BEGIN");
  console.log(entry.stdout || entry.stderr);
  console.log("ENTRY_JSON_END");
}
