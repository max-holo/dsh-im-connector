import type { DwsRunner } from "../dws/runner.js";
import { buildFlags } from "../dws/flags.js";

export interface DocListOptions {
  folder?: string;
  workspace?: string;
  limit?: number;
  cursor?: string;
  pageAll?: boolean;
  maxItems?: number;
}

export interface WikiNodeListOptions {
  workspace: string;
  folder?: string;
  limit?: number;
  cursor?: string;
  pageAll?: boolean;
}

export interface DriveListOptions {
  spaceId?: string;
  folder?: string;
  limit?: number;
  cursor?: string;
  orderBy?: "createTime" | "modifyTime" | "name";
  order?: "asc" | "desc";
  pageAll?: boolean;
}

/** 文档/知识库/钉盘读取（dws doc + wiki + drive）。 */
export class DocsModule {
  constructor(private readonly runner: DwsRunner) {}

  /** 读取在线文档正文（Markdown）。 */
  readDoc(node: string, opts?: { version?: number }): Promise<unknown> {
    return this.runner.runJson(["doc", "read", ...buildFlags({ node, version: opts?.version })]);
  }

  /** 文档元信息。 */
  docInfo(node: string): Promise<unknown> {
    return this.runner.runJson(["doc", "info", ...buildFlags({ node })]);
  }

  /** 列出文档文件夹/知识库下的直接子节点。 */
  listDocChildren(opts: DocListOptions = {}): Promise<unknown> {
    return this.runner.runJson([
      "doc",
      "+list",
      ...buildFlags({
        folder: opts.folder,
        workspace: opts.workspace,
        limit: opts.limit,
        cursor: opts.cursor,
        "page-all": opts.pageAll,
        "max-items": opts.maxItems,
      }),
    ]);
  }

  /** 按关键词搜索云文档。 */
  findDoc(query: string, opts?: { limit?: number }): Promise<unknown> {
    return this.runner.runJson(["doc", "+find-doc", ...buildFlags({ query, limit: opts?.limit })]);
  }

  /** 知识库列表。 */
  listWikiSpaces(opts?: { type?: "orgWikiSpace" | "myWikiSpace"; pageAll?: boolean }): Promise<unknown> {
    return this.runner.runJson([
      "wiki",
      "+space-list",
      ...buildFlags({ type: opts?.type, "page-all": opts?.pageAll }),
    ]);
  }

  /** 知识库节点列表。 */
  listWikiNodes(opts: WikiNodeListOptions): Promise<unknown> {
    return this.runner.runJson([
      "wiki",
      "+node-list",
      ...buildFlags({
        workspace: opts.workspace,
        folder: opts.folder,
        limit: opts.limit,
        cursor: opts.cursor,
        "page-all": opts.pageAll,
      }),
    ]);
  }

  /** 钉盘文件/文件夹列表。 */
  listDrive(opts: DriveListOptions = {}): Promise<unknown> {
    return this.runner.runJson([
      "drive",
      "+list",
      ...buildFlags({
        "space-id": opts.spaceId,
        folder: opts.folder,
        limit: opts.limit,
        cursor: opts.cursor,
        "order-by": opts.orderBy,
        order: opts.order,
        "page-all": opts.pageAll,
      }),
    ]);
  }

  /** 钉盘节点元数据。 */
  driveInfo(node: string, opts?: { spaceId?: string }): Promise<unknown> {
    return this.runner.runJson(["drive", "+info", ...buildFlags({ node, "space-id": opts?.spaceId })]);
  }

  /** 最近访问/编辑的文档列表。 */
  driveRecent(): Promise<unknown> {
    return this.runner.runJson(["drive", "+recent"]);
  }
}
