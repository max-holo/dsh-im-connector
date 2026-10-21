// 构建自包含插件 bundle：
// 1) esbuild 打包 src/plugin/index.ts → im-connect/index.js（内联所有本地依赖）
// 2) 复制为版本化入口 index-<hash>.js 并更新 exports（让重装插件时 ESM 模块 URL
//    变化，从而加载新代码；DSH Loader 按 URL 缓存模块，替换已安装包通常需重启）。
import { build } from "esbuild";
import { copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = join(root, "im-connect");
const entry = join(bundleDir, "index.js");
const pkgPath = join(bundleDir, "package.json");

await build({
  entryPoints: [join(root, "src/plugin/index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: entry,
  banner: {
    js: "import { createRequire as __esmRequire } from 'node:module'; var require = __esmRequire(import.meta.url);",
  },
});

const code = readFileSync(entry);
const hash = createHash("sha256").update(code).digest("hex").slice(0, 8);
const versioned = `index-${hash}.js`;
copyFileSync(entry, join(bundleDir, versioned));

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.exports = { ...(pkg.exports ?? {}), ".": `./${versioned}` };
pkg.files = ["index*.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"];
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

for (const f of readdirSync(bundleDir)) {
  if (/^index-[0-9a-f]{8}\.js$/.test(f) && f !== versioned) {
    rmSync(join(bundleDir, f), { force: true });
  }
}
console.log(`bundle -> ${versioned}`);
