// 诊断脚本：抓取 dws listen-im 的真实事件 payload（30 秒后退出）。
// 用法：node capture-event.mjs <kind>
import { spawn } from "node:child_process";

const kind = process.argv[2] || "all-group";
const DWS = "D:/software_setup/nodejs/node_modules/dingtalk-workspace-cli/bin/dws.js";
const child = spawn(
  process.execPath,
  [DWS, "event", "+listen-im", "--kind", kind, "--format", "ndjson"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      console.log("EVENT " + JSON.stringify(JSON.parse(line)));
    } catch {
      console.log("RAW " + line.slice(0, 300));
    }
  }
});
child.stderr.on("data", (d) => console.log("STDERR " + d.toString("utf8").trim().slice(0, 300)));
setTimeout(() => {
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  process.exit(0);
}, 30000);
