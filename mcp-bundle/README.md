# mcp-bundle：DSH MCP 连接 bundle（可选）

这是给 **DeepSeek Harness (DSH)** 用的 MCP 连接 bundle，让 DSH 把 `im-connector` 注册成一个 MCP 连接（工具名 `mcp__im__run`）。

使用方式：

1. 把本目录复制到你自己的目录（例如 `~/dsh-plugins/im-connector-mcp`）
2. 编辑 `cordis.patch.yml`，把 `env` 里的两个路径改成你机器上的实际路径：
   - `DINGTALK_DWS_BIN`：dws 的 bin 脚本绝对路径（`npm root -g` + `dingtalk-workspace-cli/bin/dws.js`）
   - `WECOM_CLI_BIN`：wecom-cli 的 bin 脚本绝对路径（`npm root -g` + `@wecom/cli/bin/wecom.js`）
   - `args` 里的 `dist/mcp/server.js` 改成 `im-connector` 安装后的实际路径（全局安装时用 `npm root -g` 下的 `im-connector/dist/mcp/server.js`）
3. 在 DSH 里安装该 bundle（`plugin_manager install_bundle`，target 指向上面的目录）

> 如果你用全局安装方式，也可以直接在 DSH profile 的 cordis patch 里加一行 MCP server 配置，
> 由 DSH 的 MCP client 直接 spawn `im-connector`（stdio）。两种方式等价。
