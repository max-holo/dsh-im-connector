# IM Connect 架构设计（双向 IM 插件）

目标：把钉钉 / 企业微信（未来飞书、Discord 等）接入 DSH，实现
① **页面配置连接器 + 扫码登录**；② **双向对话**——用户在 IM 里 @ 机器人下任务，
本机 DSH Agent 执行并把回复推回 IM 会话。

## 1. 分层架构

```
┌ Client（DSH Web UI）
│  设置页「IM 连接」：添加/移除连接器、扫码登录、启停开关、连接状态
│  远程调用：ctx.remote 命名空间（imConnect）→ Host
├ Host（插件主体，cordis 服务）
│  engine（平台无关，不写死任何 IM 名）
│   ├ ChannelManager   连接器生命周期：按配置启动/停止/重连各渠道监听
│   ├ Router           IM 会话 ↔ DSH Session 映射（持久化于 storageDomain）
│   ├ Dispatcher       入站消息 → sessionController.prompt → 订阅回复流 → 渠道回发
│   └ Gate             准入：群聊必须 @ 机器人；私聊走白名单；命令权限
│  channels/（平台适配器，只做「收发」两件事，不创建 Agent）
│   ├ dingtalk    收：dws event +listen-im（Stream NDJSON）；发：dws chat +messages-send
│   └ wecom       收：chat groups/messages list 轮询；发：wecom-cli message send
├ Connector core（可复用的 npm 包层）
│   CliRunner（spawn CLI + JSON/NDJSON 解析 + 错误信封映射）
│   ImProviderSpec 注册表（CLI 定位、格式差异、示例）
└ 底层 CLI：dws（钉钉）/ wecom-cli（企业微信）
```

设计铁律（对齐参考项目「引擎不写死平台名、渠道不创建 agent」）：
- **engine 只依赖 `ImChannel` 接口**，新增平台 = 新增一个 channel 适配器 + 注册。
- **渠道只收发**，不触碰 DSH 会话/Agent；会话派发全部由 Dispatcher 完成。
- **每条 IM 会话 = 一个独立 DSH Session**，网页任务与 IM 会话互不混淆。

## 2. 双向对话是怎么做的（核心机制）

```
用户在群里 @机器人 ──▶ [1] 渠道监听进程（dws Stream 长连接 / wecom 轮询）
     │ 入站消息（会话ID、发送者、文本、是否@机器人）
     ▼
[2] Gate 准入：群聊未 @ → 忽略；私聊非白名单 → 提示待批准
     ▼
[3] Router：查 storageDomain 里 `provider:account:chatId → sessionId` 映射；
     没有则先 sessionController.create() 建新会话并登记
     ▼
[4] Dispatcher：sessionController.prompt({ sessionId, message }) 把用户文本注入会话，
     DSH 的 Agent Loop 正常驱动 Agent（工具、多步、Goal 等全部复用）
     ▼
[5] 回复采集：订阅该 Session 的 agent/assistant-stream（流式帧）+ agent/status（idle⇄running）；
     回合结束时把最终文本（必要时分片）交给渠道 sendText 回发到原 IM 会话
     ▼
[6] 循环：同一聊天继续 @ / 私聊 → 命中同一 Session，上下文连续
```

这正好回答「怎么和机器人对话」：不是插件自己跑一个 LLM，而是
**插件把 IM 消息翻译成 DSH 会话的输入，并把 DSH Agent 的输出翻译回 IM 消息**。

## 3. 已核对的 DSH 扩展点（本机 Harness 实测）

| 用途 | Service / Event |
|---|---|
| 建会话 / 派发用户消息 | `sessionController.create()` / `sessionController.prompt()`（Host 服务） |
| 会话流式订阅 | `agent/assistant-stream`（进程内流帧）、`sessionController.follow()`（Remote stream） |
| 回合结束 / 状态 | `agent/status`（idle ⇄ running）、`session/event`（durable feed） |
| 长连接监听进程 | `subprocess.spawn()`（dws Stream 子进程） |
| 轮询 | `timer.interval()`（wecom 消息轮询，带 cursor 推进） |
| 连接器配置持久化 | `storage` / `storageDomain`（channels.json + 会话映射表） |
| 扫码凭据落盘 | `credentials.set/unset`（敏感凭据进凭据服务，不回显） |
| 设置页表单 | `settings.configure()` + 插件 Config schema → 自动渲染表单 |
| 回调/管理 HTTP | `webServer.register(route)`（企微回调等）+ `connection.requestRejection`（认证） |
| 回复卡片/富文本 | 后续用各平台卡片 API（钉钉 AI Card 等），v1 先纯文本 |

## 4. Provider 与 Channel 的工程化分层

- `ImProviderSpec`（现有）：描述一个平台的 **CLI 能力**（命令定位、JSON 格式差异）。
- `ImChannel`（新增）：描述一个平台的 **收发语义**（`sendText` / `listen` / `status`），
  内部用 CliRunner 执行 CLI——因此可用 fake CLI 全量单测，不依赖真实账号。

```ts
interface ImChannel {
  providerId: string;
  sendText(target: { conversationId: string }, text: string): Promise<unknown>;
  listen(onMessage: (m: ImInboundMessage) => void): Promise<{ stop(): void }>;
  status(): Promise<unknown>;
}
```

## 5. 扫码登录设计

- 钉钉：`dws auth login --device --recommend`（终端二维码 + 轮询等待登录完成）。
- 企业微信：`wecom-cli auth init --noninteractive`（终端二维码，扫码后自动完成）。
- UI「添加连接器」→ 调用 Host `imConnect.startQrLogin(provider)` → Host 起子进程捕获
  二维码文本 → 通过 Remote 流推给设置页渲染 → 登录完成后标记 `connected`。
- 凭据本身留在各 CLI 本地（插件不保存 AppSecret/Token 明文；需要时走 `credentials` 服务）。

## 6. 分阶段路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | 架构文档 + 渠道抽象 + dingtalk/wecom 收发通道 + CliRunner NDJSON 流 + 单测 | 本轮 |
| P2 | Host engine（ChannelManager / Router / Dispatcher / Gate）+ 插件 bundle 安装 | 待做 |
| P3 | Client 设置页（添加连接器、扫码、启停、状态、待批准列表） | 待做 |
| P4 | 增强：卡片/按钮回复、文件图片、工具审批回 IM、多账号 | 待做 |
