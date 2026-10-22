// MCP stdio 冒烟测试：启动编译后的 MCP server，走 initialize → tools/list。
// 期望 `run`（业务透传）与 `info`（版本/登录自检）两个工具。tools/list 不触发网络。
// 用法：先 pnpm build，然后 node scripts/mcp-smoke.mjs
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/mcp/server.js"], {
  env: { ...process.env },
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const responses = [];
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) {
      try {
        responses.push(JSON.parse(line));
      } catch {
        // ignore non-JSON noise
      }
    }
  }
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
const waitFor = (id, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for response id ${id}`)), timeoutMs);
    const check = () => {
      const found = responses.find((r) => r.id === id);
      if (found) {
        clearTimeout(timer);
        resolve(found);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  },
});
const init = await waitFor(1);
console.log(`initialized: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const tools = await waitFor(2);
const names = tools.result.tools.map((t) => t.name);
console.log(`tools/list returned ${names.length} tool(s): ${names.join(", ")}`);
if (names.length !== 2 || !names.includes("run") || !names.includes("info")) {
  console.error(`FAIL: expected "run" and "info" tools`);
  child.kill();
  process.exit(1);
}
child.stdin.end();
console.log("MCP smoke test OK");
process.exit(0);
