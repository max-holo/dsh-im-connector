import { listProviders } from "../providers/registry.js";

/**
 * MCP server instructions：进入模型系统提示（DSH 会原样拼入）。
 * 写清调用约定、资源入口与常见错误，减少误用。
 */
export function buildInstructions(): string {
  const providers = listProviders()
    .map((p) => `- ${p.id}: ${p.displayName}（CLI: \`${p.bin}\`）`)
    .join("\n");

  return `# im-connector：Agent → IM 渠道 CLI 桥

本服务把钉钉 dws 与企业微信 wecom-cli 的原生命令透传给模型。已接入：

${providers}

## 调用约定

- \`run\` 的参数 \`args\` 是目标 CLI 的原生命令参数数组，不是自然语言；返回值是该 CLI 的 JSON 输出（非 JSON 时返回原始文本）。
- 写操作（发消息、提交日报/审批、修改文档等）必须由用户明确要求；先确认目标与内容，可用 \`--dry-run\` 预览（两平台都支持），确认后钉钉加 \`--yes\` 执行。
- 首次使用或命令异常时先调 \`info\`：返回各平台 CLI 版本、登录状态与实际可执行入口。
- 登录：\`login\` 发起授权（企业微信返回二维码图片与可内联的 markdown；钉钉拉起浏览器，远程环境用 \`mode:"device"\`），\`login_status\` 确认；凭据由 CLI 自己保存，本服务不接触。
- 优先用 \`--format json\` 之外的默认 JSON 输出；需要字段裁剪时用 CLI 自带 \`--jq\`/\`--fields\`。
- 用户可见的回复使用可读名称（群名、人名、标题），不要把内部 ID 当作展示内容。

## 资源（只读发现，按需读取）

- \`im://providers\` — 平台目录与示例命令
- \`im://dingtalk/services\` — dws 服务域清单（contact/chat/calendar/todo/oa/doc/wiki/mail/minutes/attendance/report/sheet/whiteboard/aitable/agoal/hrbrain 等）
- \`im://wecom/sessions\` — 机器人最近会话（按最后消息时间倒序）
- \`im://dingtalk/templates\` — 日志模板与字段
- \`im://dingtalk/group/{group}/messages?limit=N\` — 读取群消息（模板资源）

## 常见错误

- 企业微信 \`errcode 853006\`（this tool is not available for your corporation）：该企业未开通对应工具权限，如实告知用户，不要反复重试。
- 钉钉 \`validation_error\`：按错误提示修正参数后重试一次。
- 认证失败：先 \`info\` 查看登录状态，必要时 \`login\`。`;
}
