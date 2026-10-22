// 把已安装的 dws 二进制复制到 vendor/dws/win32-x64/，供 npm 包携带（维护者用）。
// 用法：node scripts/vendor-dws.mjs [dws 包目录]
// 默认从 npm 全局 root 下的 dingtalk-workspace-cli 复制。
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dest = join(process.cwd(), "vendor", "dws", "win32-x64");
const pkgDir = process.argv[2] ?? (() => {
  const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  return join(root, "dingtalk-workspace-cli");
})();

const exe = join(pkgDir, "vendor", "dws.exe");
if (!existsSync(exe)) {
  console.error(`找不到 dws.exe：${exe}`);
  console.error("请先 npm i -g dingtalk-workspace-cli，或从 GitHub release 的 dws-windows-amd64.zip 解压后传入包目录。");
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
copyFileSync(exe, join(dest, "dws.exe"));
console.log(`已复制 dws.exe → ${join(dest, "dws.exe")}`);
