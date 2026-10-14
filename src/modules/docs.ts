import type { ModuleContext } from "../context.js";
import type { JsonRecord } from "../types.js";

/**
 * 文档读取：钉盘/文档空间 + 知识库 + 在线文档内容（块）。
 *
 * 端点（api.dingtalk.com，企业内部应用 accessToken + 操作人 unionId）：
 * - 空间列表:     GET /v1.0/drive/spaces?unionId&maxResults&nextToken
 * - 文件列表:     GET /v1.0/drive/spaces/{spaceId}/files?unionId&parentId&maxResults&nextToken
 * - 知识库列表:   GET /v2.0/wiki/workspaces?operatorId&maxResults&nextToken&orderBy
 * - 知识库节点:   GET /v2.0/wiki/nodes?parentNodeId&operatorId&maxResults&nextToken
 * - 文档块查询:   GET /v1.0/doc/suites/documents/{docKey}/blocks?operatorId&startIndex&endIndex&blockType
 *   （docKey 可为文档 docKey 或 dentryUuid；知识库节点的 nodeId 即 dentryUuid）
 */
export class DocsModule {
  constructor(private readonly ctx: ModuleContext) {}

  /** 获取（钉盘/文档）空间列表。 */
  async listSpaces(
    unionId: string,
    opts?: { maxResults?: number; nextToken?: string },
  ): Promise<{ spaces: JsonRecord[]; nextPageToken?: string; hasMore: boolean }> {
    const body = await this.ctx.http.api<{ spaces?: JsonRecord[]; nextPageToken?: string }>(
      "GET",
      "/v1.0/drive/spaces",
      {
        query: {
          unionId,
          maxResults: opts?.maxResults ?? 100,
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
        },
      },
    );
    return {
      spaces: body.spaces ?? [],
      nextPageToken: body.nextPageToken,
      hasMore: Boolean(body.nextPageToken),
    };
  }

  /** 获取空间下的文件/文件夹列表。 */
  async listFiles(
    spaceId: string,
    unionId: string,
    opts?: { parentId?: string; maxResults?: number; nextToken?: string },
  ): Promise<{ files: JsonRecord[]; nextPageToken?: string; hasMore: boolean }> {
    const body = await this.ctx.http.api<{ files?: JsonRecord[]; nextPageToken?: string }>(
      "GET",
      `/v1.0/drive/spaces/${encodeURIComponent(spaceId)}/files`,
      {
        query: {
          unionId,
          ...(opts?.parentId ? { parentId: opts.parentId } : {}),
          maxResults: opts?.maxResults ?? 100,
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
        },
      },
    );
    return {
      files: body.files ?? [],
      nextPageToken: body.nextPageToken,
      hasMore: Boolean(body.nextPageToken),
    };
  }

  /** 获取知识库（wiki）列表。 */
  async listWikiWorkspaces(
    unionId: string,
    opts?: { maxResults?: number; nextToken?: string; orderBy?: string },
  ): Promise<{ workspaces: JsonRecord[]; nextToken?: string; hasMore: boolean }> {
    const body = await this.ctx.http.api<{ workspaces?: JsonRecord[]; nextToken?: string }>(
      "GET",
      "/v2.0/wiki/workspaces",
      {
        query: {
          operatorId: unionId,
          maxResults: opts?.maxResults ?? 30,
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
          ...(opts?.orderBy ? { orderBy: opts.orderBy } : {}),
        },
      },
    );
    return {
      workspaces: body.workspaces ?? [],
      nextToken: body.nextToken,
      hasMore: Boolean(body.nextToken),
    };
  }

  /** 获取知识库节点列表（parentNodeId 可为知识库的 rootNodeId）。 */
  async listWikiNodes(
    parentNodeId: string,
    unionId: string,
    opts?: { maxResults?: number; nextToken?: string },
  ): Promise<{ nodes: JsonRecord[]; nextToken?: string; hasMore: boolean }> {
    const body = await this.ctx.http.api<{ nodes?: JsonRecord[]; nextToken?: string }>(
      "GET",
      "/v2.0/wiki/nodes",
      {
        query: {
          parentNodeId,
          operatorId: unionId,
          maxResults: opts?.maxResults ?? 50,
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
        },
      },
    );
    return {
      nodes: body.nodes ?? [],
      nextToken: body.nextToken,
      hasMore: Boolean(body.nextToken),
    };
  }

  /**
   * 查询在线文档的一级块元素（文档内容读取）。
   * @param docKey 文档 docKey 或 dentryUuid（知识库节点 nodeId 即 dentryUuid）
   */
  async getDocBlocks(
    docKey: string,
    unionId: string,
    opts?: { startIndex?: number; endIndex?: number; blockType?: string },
  ): Promise<JsonRecord[]> {
    const body = await this.ctx.http.api<{
      success?: boolean;
      result?: { data?: JsonRecord[] };
      data?: JsonRecord[];
    }>("GET", `/v1.0/doc/suites/documents/${encodeURIComponent(docKey)}/blocks`, {
      query: {
        operatorId: unionId,
        ...(opts?.startIndex !== undefined ? { startIndex: opts.startIndex } : {}),
        ...(opts?.endIndex !== undefined ? { endIndex: opts.endIndex } : {}),
        ...(opts?.blockType ? { blockType: opts.blockType } : {}),
      },
    });
    return body.result?.data ?? body.data ?? [];
  }
}
