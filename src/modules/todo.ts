import type { ModuleContext } from "../context.js";
import type { JsonRecord } from "../types.js";

/**
 * 待办（TODO）读取。
 *
 * 端点（api.dingtalk.com，企业内部应用 accessToken + 用户 unionId）：
 * - 企业待办列表: POST /v1.0/todo/users/{unionId}/org/tasks/query
 *   body: { nextToken?, isDone?, roleTypes? }（roleTypes: executor/creator/participant 的二维数组）
 * - 待办详情:     GET  /v1.0/todo/users/{unionId}/tasks/{taskId}
 */
export class TodoModule {
  constructor(private readonly ctx: ModuleContext) {}

  /** 查询企业下用户待办（单页）。 */
  async listTasks(
    unionId: string,
    opts?: { isDone?: boolean; roleTypes?: string[][]; nextToken?: string },
  ): Promise<{ tasks: JsonRecord[]; nextToken?: string; hasMore: boolean }> {
    const res = await this.ctx.http.api<{
      tasks?: JsonRecord[];
      nextToken?: string;
      hasMore?: boolean;
    }>(
      "POST",
      `/v1.0/todo/users/${encodeURIComponent(unionId)}/org/tasks/query`,
      {
        body: {
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
          ...(opts?.isDone !== undefined ? { isDone: opts.isDone } : {}),
          ...(opts?.roleTypes ? { roleTypes: opts.roleTypes } : {}),
        },
      },
    );
    return {
      tasks: res.tasks ?? [],
      nextToken: res.nextToken,
      hasMore: res.hasMore ?? Boolean(res.nextToken),
    };
  }

  /** 收集用户待办（自动翻页，受 maxItems 限制）。 */
  async collectTasks(
    unionId: string,
    opts?: { isDone?: boolean; roleTypes?: string[][]; maxItems?: number },
  ): Promise<{ tasks: JsonRecord[]; truncated: boolean }> {
    const maxItems = Math.min(opts?.maxItems ?? 200, 1000);
    const tasks: JsonRecord[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const res = await this.listTasks(unionId, {
        isDone: opts?.isDone,
        roleTypes: opts?.roleTypes,
        nextToken,
      });
      tasks.push(...res.tasks);
      nextToken = res.nextToken;
      if (!nextToken || tasks.length >= maxItems) break;
    }
    const truncated = tasks.length > maxItems;
    return { tasks: truncated ? tasks.slice(0, maxItems) : tasks, truncated };
  }

  /** 查询单个待办任务详情。 */
  async getTask(unionId: string, taskId: string): Promise<JsonRecord> {
    return this.ctx.http.api<JsonRecord>(
      "GET",
      `/v1.0/todo/users/${encodeURIComponent(unionId)}/tasks/${encodeURIComponent(taskId)}`,
    );
  }
}
