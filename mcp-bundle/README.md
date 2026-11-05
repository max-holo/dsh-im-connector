# mcp-bundle：DSH 连接 bundle（MCP 连接 + 浏览器 toolview）

按 DSH 官方推荐方式做的 bundle，一次安装完成两件事：

1. **`im-connector-mcp`**：插入 `@deepseek-ai/dsh-mcp-client` 行，把本包注册成 MCP 连接（工具 `mcp__im__run` 等）；
2. **`im-connector-client`**：插入本包的 host 行，使 `dsh.client` 声明的**浏览器 toolview** 生效——登录工具的二维码在聊天里内联显示（不再只落附件预览）。

## 推荐安装（一步到位）

npm 包 `im-connector` 声明了 `dsh.bundle.patch`（指向本目录的 patch）与 `dsh.client`，所以装上包即完成注册：

```
plugin_manager install_bundle  target: im-connector
```

安装后 DSH 会：装包 → 应用 patch → 新增 MCP 连接（`serverName: im`）→ 加载浏览器 toolview。

## 手工安装（已有包或本地调试）

把本目录复制到任意位置，直接 `plugin_manager install_bundle`（target 指向该目录）。patch 完整内容：

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
        startupTimeoutMs: 30000
        closeTimeoutMs: 5000
        expandTemplates: true
        failOnStartupError: true
    - id: im-connector-client
      name: 'im-connector/host'
```

要点：
- `command: !!js process.execPath`：用运行 DSH 的同一个 node；`args` 通过 Loader 的 `profileContext.dir` 定位到 **profile 的 node_modules 里安装的包**，无需绝对路径、无需 npx、无需全局安装。
- `startupTimeoutMs` / `closeTimeoutMs`：限制单次连接与关闭的预算（新版 mcp-client 字段）。
- `expandTemplates: true`：允许在 env/args 里写 `${credential:REF}`，由 DSH 凭据服务注入（凭据不落配置）。
- **不需要配 env**：`im-connector` 会通过包内 node_modules / 内置二进制 / `npm root -g` 自动解析 `dws` / `wecom-cli`。
- manifest：`dsh.bundle.patch` + `dsh.client`（platform/web）+ `exports["./host"]`、`exports["./client"]`，display 元数据走 `locale/*.json` + `icon.svg`。

## 验证

安装后在会话里调用 `mcp__im__run`（例如 `{ provider: "dingtalk", args: ["contact", "+me"] }`）确认连接可用；调用 `mcp__im__login` 应看到二维码**内联**在聊天里。
