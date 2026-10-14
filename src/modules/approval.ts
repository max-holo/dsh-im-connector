import type { ModuleContext } from "../context.js";
import type { DateInput, JsonRecord } from "../types.js";
import { toEpochMs } from "../util.js";

export type ApprovalInstanceStatus = "RUNNING" | "TERMINATED" | "COMPLETED";

/**
 * OA 审批读取。
 *
 * 端点：
 * - 可见审批模板:   POST oapi /topapi/process/listbyuserid {userid, offset, size}
 * - 审批实例ID列表: POST api  /v1.0/workflow/processes/instanceIds/query
 *    {processCode, startTime(ms), endTime?, nextToken, maxResults<=20, userIds?, statuses?}
 *    —— startTime 距今 ≤ 120 天（单参）/ 区间 ≤ 120 天且距今 ≤ 365 天
 * - 审批实例详情:   GET  api  /v1.0/workflow/processInstances?processInstanceId=...
 * - 用户待审批数量: POST oapi /topapi/process/gettodocount {userid}
 */
export class ApprovalModule {
  constructor(private readonly ctx: ModuleContext) {}

  /** 获取指定用户可见的审批模板（表单）列表。 */
  async listVisibleForms(
    userid: string,
    opts?: { offset?: number; size?: number },
  ): Promise<{ forms: JsonRecord[]; total?: number }> {
    const body = await this.ctx.http.oapi<{
      result?: { process_list?: JsonRecord[]; total?: number };
    }>("POST", "/topapi/process/listbyuserid", {
      body: { userid, offset: opts?.offset ?? 0, size: opts?.size ?? 100 },
    });
    return { forms: body.result?.process_list ?? [], total: body.result?.total };
  }

  /**
   * 获取审批实例 ID 列表（自动翻页）。
   * @param processCode 审批模板唯一码（可从 listVisibleForms 的 process_code 获取）
   * @param startTime   实例发起起始时间（距今不能超过 120 天）
   */
  async listInstanceIds(
    processCode: string,
    startTime: DateInput,
    opts?: {
      endTime?: DateInput;
      userIds?: string[];
      statuses?: ApprovalInstanceStatus[];
      maxItems?: number;
      maxResults?: number;
    },
  ): Promise<{ instanceIds: string[]; truncated: boolean }> {
    const maxItems = Math.min(opts?.maxItems ?? 200, 10_000);
    const maxResults = Math.min(opts?.maxResults ?? 20, 20);
    const instanceIds: string[] = [];
    let nextToken = 0;
    for (let page = 0; page < 500; page += 1) {
      const body = await this.ctx.http.api<{
        result?: { list?: string[]; nextToken?: string };
      }>("POST", "/v1.0/workflow/processes/instanceIds/query", {
        body: {
          processCode,
          startTime: toEpochMs(startTime),
          ...(opts?.endTime !== undefined ? { endTime: toEpochMs(opts.endTime) } : {}),
          nextToken,
          maxResults,
          ...(opts?.userIds?.length ? { userIds: opts.userIds } : {}),
          ...(opts?.statuses?.length ? { statuses: opts.statuses } : {}),
        },
      });
      const list = body.result?.list ?? [];
      instanceIds.push(...list);
      const rawNext = body.result?.nextToken;
      const next = rawNext === undefined || rawNext === null || rawNext === "" ? undefined : Number(rawNext);
      if (next === undefined || Number.isNaN(next) || instanceIds.length >= maxItems) break;
      if (next === nextToken) break; // defensive: avoid infinite loop
      nextToken = next;
    }
    const truncated = instanceIds.length > maxItems;
    return {
      instanceIds: truncated ? instanceIds.slice(0, maxItems) : instanceIds,
      truncated,
    };
  }

  /** 获取单个审批实例详情（含表单、任务、操作记录）。 */
  async getInstance(processInstanceId: string): Promise<JsonRecord> {
    const body = await this.ctx.http.api<{ result?: JsonRecord }>(
      "GET",
      "/v1.0/workflow/processInstances",
      { query: { processInstanceId } },
    );
    return body.result ?? (body as unknown as JsonRecord);
  }

  /** 获取用户待审批数量。 */
  async getTodoCount(userid: string): Promise<JsonRecord> {
    const body = await this.ctx.http.oapi<{ result?: JsonRecord }>("POST", "/topapi/process/gettodocount", {
      body: { userid },
    });
    return body.result ?? {};
  }
}
