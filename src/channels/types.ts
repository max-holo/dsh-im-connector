/**
 * 渠道抽象：一个平台适配器只负责「收发 + 状态」两件事，
 * 不触碰 DSH 会话/Agent——会话派发由 Host 侧的 engine 完成。
 */

/** 标准化后的入站消息（渠道层已把平台差异归一）。 */
export interface ImInboundMessage {
  /** 会话标识：群聊 openConversationId / 单聊对方 id。 */
  conversationId: string;
  conversationType: "group" | "direct";
  senderId?: string;
  senderName?: string;
  text: string;
  /** 群聊消息是否 @ 了机器人（平台未提供该标记时为 undefined，由 Gate 兜底判断）。 */
  mentionedBot?: boolean;
  /** 平台原始事件。 */
  raw?: unknown;
}

export interface ImSendTarget {
  /** 群聊 openConversationId；私聊为目标用户的 userId。 */
  conversationId: string;
  kind?: "group" | "direct";
  /** 私聊目标用户 id（钉钉 --user 发送用）。 */
  userId?: string;
}

export interface ImChannel {
  providerId: string;
  /** 向会话发送文本回复。 */
  sendText(target: ImSendTarget, text: string): Promise<unknown>;
  /**
   * 建立入站监听；每条消息回调一次。
   * done 在监听终止（退出或 stop）时 resolve，供引擎做监督重启。
   */
  listen(onMessage: (m: ImInboundMessage) => void): Promise<{ stop: () => void; done: Promise<void> }>;
  /** 连接/登录状态。 */
  status(): Promise<unknown>;
}
