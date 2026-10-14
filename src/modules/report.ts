import type { ModuleContext } from "../context.js";
import type { DateInput, JsonRecord } from "../types.js";
import { toEpochMs } from "../util.js";

/**
 * 日志（日报/周报/月报）读取。
 *
 * 端点（oapi.dingtalk.com，topapi）：
 * - 日志列表:     POST /topapi/report/list
 *    {start_time(ms), end_time(ms), template_name?, userid?, cursor, size(1..20),
 *     modified_start_time?, modified_end_time?} —— 区间 ≤ 180 天
 * - 模板列表:     POST /topapi/report/template/listbyuserid {userid?, offset, size}
 * - 模板详情:     POST /topapi/report/template/getbyname {template_name, userid}
 */
export class ReportModule {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * 查询日志记录（自动翻页）。
   * @param startTime 日志创建起始时间（Unix 毫秒或 ISO 时间）
   * @param endTime   日志创建结束时间（与 startTime 间隔 ≤ 180 天）
   */
  async listReports(
    startTime: DateInput,
    endTime: DateInput,
    opts?: {
      userid?: string;
      templateName?: string;
      modifiedStartTime?: DateInput;
      modifiedEndTime?: DateInput;
      maxItems?: number;
      size?: number;
    },
  ): Promise<{ reports: JsonRecord[]; truncated: boolean }> {
    const maxItems = Math.min(opts?.maxItems ?? 200, 1000);
    const size = Math.min(Math.max(opts?.size ?? 20, 1), 20);
    const reports: JsonRecord[] = [];
    let cursor = 0;
    for (let page = 0; page < 200; page += 1) {
      const body = await this.ctx.http.oapi<{
        result?: { data_list?: JsonRecord[]; next_cursor?: number };
      }>("POST", "/topapi/report/list", {
        body: {
          start_time: toEpochMs(startTime),
          end_time: toEpochMs(endTime),
          cursor,
          size,
          ...(opts?.userid ? { userid: opts.userid } : {}),
          ...(opts?.templateName ? { template_name: opts.templateName } : {}),
          ...(opts?.modifiedStartTime !== undefined
            ? { modified_start_time: toEpochMs(opts.modifiedStartTime) }
            : {}),
          ...(opts?.modifiedEndTime !== undefined
            ? { modified_end_time: toEpochMs(opts.modifiedEndTime) }
            : {}),
        },
      });
      const list = body.result?.data_list ?? [];
      reports.push(...list);
      const next = body.result?.next_cursor;
      if (
        next === undefined ||
        next === null ||
        next <= 0 ||
        list.length === 0 ||
        reports.length >= maxItems
      ) {
        break;
      }
      if (next === cursor) break; // defensive: avoid infinite loop
      cursor = next;
    }
    const truncated = reports.length > maxItems;
    return { reports: truncated ? reports.slice(0, maxItems) : reports, truncated };
  }

  /** 获取（用户可见的）日志模板列表。 */
  async listTemplates(userid?: string, opts?: { offset?: number; size?: number }): Promise<JsonRecord[]> {
    const body = await this.ctx.http.oapi<{ result?: { template_list?: JsonRecord[] } }>(
      "POST",
      "/topapi/report/template/listbyuserid",
      {
        body: {
          ...(userid ? { userid } : {}),
          offset: opts?.offset ?? 0,
          size: opts?.size ?? 100,
        },
      },
    );
    return body.result?.template_list ?? [];
  }

  /** 按名称获取日志模板详情（含字段定义）。 */
  async getTemplateByName(templateName: string, userid: string): Promise<JsonRecord> {
    const body = await this.ctx.http.oapi<{ result?: JsonRecord }>(
      "POST",
      "/topapi/report/template/getbyname",
      { body: { template_name: templateName, userid } },
    );
    return body.result ?? {};
  }
}
