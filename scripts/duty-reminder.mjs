#!/usr/bin/env node
// 值班提醒定时任务执行器
//
// 触发规则：某天 D 为「触发日」当且仅当 D 是工作日，且 D+1 是休息日。
//   休息日 = 周六/周日（非调休上班日）或法定节假日（含调休放假日）
//   工作日 = 周一~周五（非法定节假日）或调休上班日（周末补班）
// 即：每个周末前的最后一个工作日、每个法定节假日开始前的最后一个工作日各触发一次。
// 值班人按休息日逐个轮换（每人一天）：杨春艳 → 余海 → 丁桐 → 马玄，循环。
//
// 用法：
//   node scripts/duty-reminder.mjs --list [--days N]     列出未来 N 天（默认 60）触发日与值班人
//   node scripts/duty-reminder.mjs --send [--date YYYY-MM-DD]   发送提醒（默认今天；--date 仅测试用）
//   node scripts/duty-reminder.mjs --dry-run [--date YYYY-MM-DD] 走 dws --dry-run 预览调用，不真正发送
//
// 依赖：已安装并登录的 dws（dingtalk-workspace-cli）。
// 节假日日历在 scripts/duty-config.json 维护（2027 年安排公布后补入即可）。

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "duty-config.json");
const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

// ---------- 日期工具（本地时区 Asia/Shanghai） ----------
function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtCnDate(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// ---------- 休息日 / 工作日 / 触发日 ----------
const restSet = new Set();
const makeupSet = new Set();
for (const h of Object.values(cfg.holidays)) {
  for (const s of h.restDays) restSet.add(s);
  for (const s of h.makeupWorkdays) makeupSet.add(s);
}

function isRestDay(d) {
  const s = fmt(d);
  if (restSet.has(s)) return true;
  const w = d.getDay(); // 0=周日 6=周六
  if ((w === 0 || w === 6) && !makeupSet.has(s)) return true;
  return false;
}
function isWorkday(d) {
  const s = fmt(d);
  if (makeupSet.has(s)) return true;
  const w = d.getDay();
  if (w >= 1 && w <= 5 && !restSet.has(s)) return true;
  return false;
}
function isTrigger(d) {
  return isWorkday(d) && isRestDay(addDays(d, 1));
}

// 从触发日 D 起，休息区段（D+1 开始的连续休息日）
function restBlock(triggerDate) {
  let start = addDays(triggerDate, 1);
  let end = start;
  while (isRestDay(addDays(end, 1))) end = addDays(end, 1);
  return { start: fmt(start), end: fmt(end) };
}

// 休息日数量（[fromStr, toStr] 闭区间），用于计算轮换序号（每人一天）
function countRestDays(fromStr, toStr) {
  let c = 0;
  for (let d = parseDate(fromStr); fmt(d) <= toStr; d = addDays(d, 1)) {
    if (isRestDay(d)) c++;
  }
  return c;
}

// 轮换：第一个休息日 → firstPerson，之后每过一个休息日轮到下一个人
function dutyForRestDay(restDayStr) {
  const idx = (countRestDays(cfg.anchor.firstRestDate, restDayStr) - 1) % cfg.rotation.length;
  return cfg.rotation[idx];
}

// ---------- 消息构造 ----------
// 把休息区段内每个休息日按「值班日期@值班人员」排成一行，收集所有被 @ 的人
function buildMessage(triggerStr) {
  const block = restBlock(parseDate(triggerStr));
  const lines = [];
  const atIds = [];
  const seen = new Set();
  for (let d = parseDate(block.start); fmt(d) <= block.end; d = addDays(d, 1)) {
    if (!isRestDay(d)) continue;
    const p = dutyForRestDay(fmt(d));
    if (!seen.has(p.openDingtalkId)) {
      seen.add(p.openDingtalkId);
      atIds.push(p.openDingtalkId);
    }
    lines.push(
      cfg.message.lineTemplate
        .replaceAll("{date}", fmtCnDate(d))
        .replaceAll("{weekday}", WEEKDAY_CN[d.getDay()])
        .replaceAll("{at}", `<@${p.openDingtalkId}>`)
        .replaceAll("{name}", p.name),
    );
  }
  return { block, markdown: lines.join("\n\n"), title: cfg.message.title, atIds };
}

// ---------- dws 调用 ----------
// 与 src/dws/runner.ts 一致：优先用 node 直接跑全局安装的 bin/dws.js，
// 规避 Windows 下 .cmd/.ps1 shim 无法被 spawn(shell:false) 拉起的问题。
function npmGlobalRootSync() {
  const r = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  return (r.stdout || "").trim() || null;
}

function resolveLaunch() {
  const bin = process.env.DINGTALK_DWS_BIN || "dws";
  if (bin !== "dws" && /\.(c?js|mjs)$/i.test(bin) && existsSync(bin)) {
    return { command: process.execPath, prefix: [bin], shell: false };
  }
  if (bin !== "dws" && existsSync(bin)) {
    return { command: bin, prefix: [], shell: false };
  }
  if (bin === "dws") {
    const root = npmGlobalRootSync();
    if (root) {
      const script = path.join(root, "dingtalk-workspace-cli", "bin", "dws.js");
      if (existsSync(script)) {
        return { command: process.execPath, prefix: [script], shell: false };
      }
    }
  }
  return { command: bin, prefix: [], shell: process.platform === "win32" };
}

function runDws(args) {
  const spec = resolveLaunch();
  const r = spawnSync(spec.command, [...spec.prefix, ...args], {
    encoding: "utf8",
    shell: spec.shell,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error };
}

function sendFor(triggerStr, { dryRun = false } = {}) {
  const { block, markdown, title, atIds } = buildMessage(triggerStr);
  const args = [
    "chat", "+messages-send",
    "--group", cfg.group.openConversationId,
    "--markdown", markdown,
    "--title", title,
    "--identity", cfg.send.identity,
    "--at-open-dingtalk-ids", atIds.join(","),
    dryRun ? "--dry-run" : "--yes",
    "--format", "json",
  ];
  const res = runDws(args);
  if (res.error) {
    console.error(`dws 启动失败：${res.error.message}`);
    return res;
  }
  if (dryRun) {
    console.log(`[dry-run] 触发日 ${triggerStr}（周期 ${block.start} ~ ${block.end}，@ ${atIds.length} 人）`);
    console.log("dws args:", args.join(" "));
    console.log(res.stdout || res.stderr);
    return;
  }
  if (res.status === 0) {
    console.log(`已发送：${triggerStr}（周期 ${block.start} ~ ${block.end}）`);
  } else {
    console.error(`发送失败（exit ${res.status}）：`);
    console.error(res.stderr || res.stdout);
  }
  return res;
}

// ---------- CLI ----------
function parseArgs(argv) {
  const opts = { mode: null, days: 60, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") opts.mode = "list";
    else if (a === "--send") opts.mode = "send";
    else if (a === "--dry-run") opts.mode = "dry-run";
    else if (a === "--days") opts.days = Number(argv[++i]);
    else if (a === "--date") opts.date = argv[++i];
  }
  return opts;
}

function todayStr() {
  return fmt(new Date());
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === "list") {
    const start = todayStr();
    const end = fmt(addDays(parseDate(start), opts.days));
    console.log(`未来 ${opts.days} 天触发日（${start} ~ ${end}）：`);
    let any = false;
    for (let d = parseDate(start); fmt(d) <= end; d = addDays(d, 1)) {
      if (!isTrigger(d)) continue;
      const s = fmt(d);
      const block = restBlock(d);
      console.log(`  ${s} ${WEEKDAY_CN[d.getDay()]}（发送日，值班周期 ${block.start} ~ ${block.end}）`);
      for (let r = parseDate(block.start); fmt(r) <= block.end; r = addDays(r, 1)) {
        if (!isRestDay(r)) continue;
        const p = dutyForRestDay(fmt(r));
        console.log(`      ${fmtCnDate(r)}（${WEEKDAY_CN[r.getDay()]}） @${p.name}`);
      }
      any = true;
    }
    if (!any) console.log("  （无）");
    return;
  }

  const target = opts.date || todayStr();
  if (!isTrigger(parseDate(target))) {
    console.log(`${target} 不是触发日，无需发送。`);
    return;
  }
  sendFor(target, { dryRun: opts.mode === "dry-run" });
}

main();
