// 把已安装的 dws 二进制复制到 vendor/dws/win32-x64/，供 npm 包携带（维护者用）。
// 用法：node scripts/vendor-dws.mjs [dws 包目录或 dws.exe 路径]
// 默认从 npm 全局 root 下的 dingtalk-workspace-cli 复制。
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dest = join(process.cwd(), "vendor", "dws", "win32-x64");

function resolveSource() {
  const arg = process.argv[2];
  if (arg !== undefined) {
    // 既接受包目录，也直接接受 exe 路径
    if (arg.endsWith(".exe")) return arg;
    return join(arg, "vendor", "dws.exe");
  }
  // Windows 上 npm 是 .cmd，必须走 shell
  const root = execFileSync("npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();
  return join(root, "dingtalk-workspace-cli", "vendor", "dws.exe");
}

const exe = resolveSource();
if (!existsSync(exe) || !statSync(exe).isFile()) {
  console.error(`找不到 dws.exe：${exe}`);
  console.error("请先 npm i -g dingtalk-workspace-cli，或传入 dws 包目录 / dws.exe 路径。");
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
copyFileSync(exe, join(dest, "dws.exe"));
console.log(`已复制 dws.exe → ${join(dest, "dws.exe")}`);
