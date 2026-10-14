import type { DwsRunner } from "../dws/runner.js";
import { buildFlags } from "../dws/flags.js";

export interface ChatListOptions {
  types?: Array<"group" | "p2p">;
  pageSize?: number;
  pageAll?: boolean;
  excludeMuted?: boolean;
}

export interface ChatMessagesOptions {
  group?: string;
  user?: string;
  openDingTalkId?: string;
  start?: string;
  end?: string;
  order?: "asc" | "desc";
  limit?: number;
  pageAll?: boolean;
  maxItems?: number;
}

export interface SearchMsgOptions {
  query?: string;
  group?: string;
  senders?: string[];
  atMe?: boolean;
  days?: number;
  pageAll?: boolean;
  limit?: number;
}

export interface ListenImOptions {
  kind?: "at-me" | "sender" | "group" | "all-direct" | "all-group";
  user?: string;
  userQuery?: string;
  chatId?: string;
  chatQuery?: string;
  query?: string;
  events?: string[];
  maxEvents?: number;
  duration?: string;
}

/**
 * 消息（IM）读取（dws chat）+ 实时事件（dws event）。
 *
 * 相比直接 OpenAPI，dws 提供真正的历史消息读取（chat +chat-messages / +search-msg）
 * 以及 Stream 实时监听（event +listen-im）。
 */
export class MessagesModule {
  constructor(private readonly runner: DwsRunner) {}

  /** 当前用户加入的会话列表。 */
  listConversations(opts: ChatListOptions = {}): Promise<unknown> {
    return this.runner.runJson([
      "chat",
      "+chat-list",
      ...buildFlags({
        types: opts.types,
        "page-size": opts.pageSize,
        "page-all": opts.pageAll,
        "exclude-muted": opts.excludeMuted,
      }),
    ]);
  }

  /** 我加入的群。 */
  myGroups(): Promise<unknown> {
    return this.runner.runJson(["chat", "+my-groups"]);
  }

  /** 未读会话。 */
  unreadChats(): Promise<unknown> {
    return this.runner.runJson(["chat", "+unread-chats"]);
  }

  /** 读取指定群聊/单聊的消息记录。 */
  chatMessages(opts: ChatMessagesOptions): Promise<unknown> {
    return this.runner.runJson([
      "chat",
      "+chat-messages",
      ...buildFlags({
        group: opts.group,
        user: opts.user,
        "open-dingtalk-id": opts.openDingTalkId,
        start: opts.start,
        end: opts.end,
        order: opts.order,
        limit: opts.limit,
        "page-all": opts.pageAll,
        "max-items": opts.maxItems,
      }),
    ]);
  }

  /** 按结构化谓词搜索消息。 */
  searchMessages(opts: SearchMsgOptions): Promise<unknown> {
    return this.runner.runJson([
      "chat",
      "+search-msg",
      ...buildFlags({
        query: opts.query,
        group: opts.group,
        senders: opts.senders,
        "at-me": opts.atMe,
        days: opts.days,
        "page-all": opts.pageAll,
        limit: opts.limit,
      }),
    ]);
  }

  /**
   * 实时监听 IM 事件（@我/指定发送人/指定群/全部单聊/全部群聊），NDJSON 流式。
   * @param onEvent 每收到一条事件（已解析 JSON）回调
   */
  listenIm(opts: ListenImOptions, onEvent: (event: unknown) => void): Promise<{ stop: () => void }> {
    return this.runner.stream(
      [
        "event",
        "+listen-im",
        ...buildFlags({
          kind: opts.kind,
          user: opts.user,
          "user-query": opts.userQuery,
          "chat-id": opts.chatId,
          "chat-query": opts.chatQuery,
          query: opts.query,
          events: opts.events,
          "max-events": opts.maxEvents,
          duration: opts.duration,
        }),
      ],
      (line) => {
        if (line.startsWith("\u0000")) return; // 内部控制行，跳过
        try {
          onEvent(JSON.parse(line));
        } catch {
          onEvent({ raw: line });
        }
      },
    );
  }
}
