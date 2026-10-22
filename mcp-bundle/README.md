# mcp-bundle：DSH MCP 连接 bundle

按 DSH 官方推荐方式（`references/mcp-bundle.md`「Connect an MCP server」）做的**配置型 bundle**：只插入一条 `@deepseek-ai/dsh-mcp-client` 行，把 `im-connector` 注册成一个 MCP 连接，模型侧工具名为 `mcp__im__run`。

## 推荐安装（一步到位）

npm 包 `im-connector` 本身声明了 `dsh.bundle.patch`（指向本目录的 patch），所以装上包即完成注册：

```
plugin_manager install_bundle  target: im-connector
```

安装后 DSH 会：装包 → 应用 patch → 新增 MCP 连接（`serverName: im`），工具为 `mcp__im__run`。

## 手工安装（已有包或本地调试）

把本目录复制到任意位置，直接 `plugin_manager install_bundle`（target 指向该目录）。patch 用的是官方 stdio 形式，但**用 `node` 直接运行包内 server**（不走 `npx`，避免 Windows 下 Node 无法用管道 spawn `.cmd` shim 的问题）：

```yaml
- insert:
    - id: im-connector-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: im
        transport: stdio
        command: !!js process.execPath
        args:
          - !!js '`${ctx.get("profileContext").dir}/node_modules/im-connector/dist/mcp/server.js`'
        failOnStartupError: true
```

要点：
- `command: !!js process.execPath`：用运行 DSH 的同一个 node，跨平台；`args` 通过 Loader 的 `profileContext.dir` 定位到 **profile 的 node_modules 里安装的包**，无需绝对路径、无需 npx、无需全局安装。
- **不需要配 env**：`im-connector` 会通过包内 node_modules / `npm root -g` 自动解析 `dws` / `wecom-cli` 的 bin 脚本。需要覆盖时再加 env，且**不要把凭据写进 patch**（可用 `!!js process.env.X` 引用环境变量）。
- `failOnStartupError: true`：连接失败时让该行激活失败，便于发现问题（官方模板同款）。
- 对照官方 `templates/mcp/`：manifest 只需 name/version/`dsh.bundle.patch`（配置型 bundle 无 Host/Client 入口文件），display 元数据走 `locale/*.json` + `icon.svg`。

## 验证

安装后在会话里调用 `mcp__im__run`（例如 `{ provider: "dingtalk", args: ["contact", "+me"] }`）确认连接可用。
