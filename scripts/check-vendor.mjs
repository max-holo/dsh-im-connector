// 发布防护：vendor/dws/win32-x64 只允许 dws.exe 一个文件。
// exe 一旦运行就会在自身旁边解出 dll / manifest / lock / skt.bin 等机器相关
// 运行时产物，绝不能随之发布；此脚本在 prepublishOnly 阶段强制拦截。
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "vendor", "dws", "win32-x64");
const files = readdirSync(dir);
const extra = files.filter((name) => name !== "dws.exe");
if (extra.length > 0) {
  console.error(`vendor/dws/win32-x64 含多余文件（只允许 dws.exe）：${extra.join(", ")}`);
  console.error("请运行 node scripts/vendor-dws.mjs 重新生成（脚本会清理目录），且不要原地运行该 exe。");
  process.exit(1);
}
console.log(`vendor check OK：仅 dws.exe（${files.length} 个文件）`);
