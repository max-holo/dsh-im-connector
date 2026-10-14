import type { ModuleContext } from "../context.js";
import type { JsonRecord } from "../types.js";
import {
  filterCapturedMessages,
  readCapturedMessages,
  type CapturedMessageFilter,
} from "../capture.js";

/**
 * 消息（IM）读取。
 *
 * 钉钉开放平台不提供任意历史消息读取 API（合规限制），可读的是：
 * - 企业会话列表: GET  oapi /chat/list?offset&size
 * - 群会话信息:   GET  api  /v1.0/im/conversations/{openConversationId}
 * - 场景群成员:   GET  api  /v1.0/im/sceneGroups/{openConversationId}/members
 * - 实时消息:     Stream 模式捕获（见 capture.ts），落盘后经 listCapturedMessages 读取
 */
export class MessagesModule {
  constructor(private readonly ctx: ModuleContext) {}

  /** 获取企业会话（应用可见的群）列表。 */
  async listConversations(
    opts?: { offset?: number; size?: number },
  ): Promise<{ conversations: JsonRecord[]; nextCursor?: number }> {
    const body = await this.ctx.http.oapi<{ chat_list?: JsonRecord[]; next_cursor?: number }>(
      "GET",
      "/chat/list",
      { query: { offset: opts?.offset ?? 0, size: opts?.size ?? 100 } },
    );
    return {
      conversations: body.chat_list ?? [],
      nextCursor: body.next_cursor,
    };
  }

  /** 查询群会话信息。 */
  async getConversation(openConversationId: string): Promise<JsonRecord> {
    return this.ctx.http.api<JsonRecord>(
      "GET",
      `/v1.0/im/conversations/${encodeURIComponent(openConversationId)}`,
    );
  }

  /** 查询场景群成员列表。 */
  async listSceneGroupMembers(
    openConversationId: string,
    opts?: { maxResults?: number; nextToken?: string },
  ): Promise<{ members: JsonRecord[]; nextToken?: string; hasMore: boolean }> {
    const body = await this.ctx.http.api<{
      members?: JsonRecord[];
      nextToken?: string;
      hasMore?: boolean;
    }>(
      "GET",
      `/v1.0/im/sceneGroups/${encodeURIComponent(openConversationId)}/members`,
      {
        query: {
          maxResults: opts?.maxResults ?? 100,
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
        },
      },
    );
    return {
      members: body.members ?? [],
      nextToken: body.nextToken,
      hasMore: body.hasMore ?? Boolean(body.nextToken),
    };
  }

  /** 读取 Stream 捕获的消息（本地落盘数据，支持过滤）。 */
  listCapturedMessages(filter: CapturedMessageFilter = {}) {
    const messages = readCapturedMessages(this.ctx.options.captureFile);
    return filterCapturedMessages(messages, filter);
  }
}
