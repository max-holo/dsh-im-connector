import type { ModuleContext } from "../context.js";
import type { DateInput, JsonRecord } from "../types.js";
import { chunk, formatDateTimeLocal, splitRangeIntoWindows, toEpochMs } from "../util.js";

/**
 * 考勤读取。
 *
 * 端点（oapi.dingtalk.com）：
 * - 打卡结果:   POST /attendance/list
 *    {userIds(≤50), workDateFrom, workDateTo("yyyy-MM-dd HH:mm:ss"), offset, limit, order}
 *    —— 时间窗口 ≤ 7 天，最多查询 180 天内数据
 * - 打卡详情:   POST /attendance/listRecord {userIds(≤50), checkDateFrom, checkDateTo, isI18n}
 * - 部门签到:   GET  /checkin/record?department_id&start_time&end_time&offset&size&order（≤45 天）
 * - 用户签到:   POST /topapi/checkin/record/get {userid_list(≤10), start_time, end_time, cursor, size}
 *    —— 单人 ≤ 10 天，多人 ≤ 1 天
 */
export class AttendanceModule {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * 获取打卡结果（自动按 50 人/7 天分片、翻页）。
   * 返回每人每天的上下班打卡汇总（迟到/早退/未打卡等结论）。
   */
  async listPunchResults(
    userIds: string[],
    workDateFrom: DateInput,
    workDateTo: DateInput,
    opts?: { limit?: number; order?: "asc" | "desc" },
  ): Promise<{ records: JsonRecord[]; truncated: boolean }> {
    const limit = Math.min(opts?.limit ?? 50, 50);
    const order = opts?.order ?? "asc";
    const records: JsonRecord[] = [];
    let truncated = false;
    for (const window of splitRangeIntoWindows(workDateFrom, workDateTo, 7)) {
      for (const userChunk of chunk(userIds, 50)) {
        let offset = 0;
        for (let page = 0; page < 100; page += 1) {
          const body = await this.ctx.http.oapi<{
            recordresult?: JsonRecord[];
            hasMore?: boolean;
          }>("POST", "/attendance/list", {
            body: {
              userIds: userChunk,
              workDateFrom: formatDateTimeLocal(window.from),
              workDateTo: formatDateTimeLocal(window.to),
              offset,
              limit,
              order,
            },
          });
          const list = body.recordresult ?? [];
          records.push(...list);
          if (!body.hasMore || list.length === 0) break;
          offset += limit;
          if (records.length >= 5000) {
            truncated = true;
            break;
          }
        }
      }
    }
    return { records, truncated };
  }

  /**
   * 获取打卡详情（自动按 50 人/7 天分片）。
   * 返回每一次实际打卡的原始记录（含定位、设备、是否合法等）。
   */
  async listPunchDetails(
    userIds: string[],
    checkDateFrom: DateInput,
    checkDateTo: DateInput,
    opts?: { isI18n?: boolean },
  ): Promise<{ records: JsonRecord[] }> {
    const records: JsonRecord[] = [];
    for (const window of splitRangeIntoWindows(checkDateFrom, checkDateTo, 7)) {
      for (const userChunk of chunk(userIds, 50)) {
        const body = await this.ctx.http.oapi<{ recordresult?: JsonRecord[] }>(
          "POST",
          "/attendance/listRecord",
          {
            body: {
              userIds: userChunk,
              checkDateFrom: formatDateTimeLocal(window.from),
              checkDateTo: formatDateTimeLocal(window.to),
              isI18n: opts?.isI18n ?? false,
            },
          },
        );
        records.push(...(body.recordresult ?? []));
      }
    }
    return { records };
  }

  /** 获取部门用户签到记录（"签到"功能，非考勤打卡）。 */
  async listCheckinRecords(
    departmentId: number | string,
    startTime: DateInput,
    endTime: DateInput,
    opts?: { offset?: number; size?: number; order?: "asc" | "desc" },
  ): Promise<JsonRecord[]> {
    const body = await this.ctx.http.oapi<{ data?: JsonRecord[] }>("GET", "/checkin/record", {
      query: {
        department_id: departmentId,
        start_time: toEpochMs(startTime),
        end_time: toEpochMs(endTime),
        offset: opts?.offset ?? 0,
        size: opts?.size ?? 100,
        order: opts?.order ?? "asc",
      },
    });
    return body.data ?? [];
  }

  /**
   * 获取指定用户的签到记录（"签到"功能，非考勤打卡）。
   * 单人时间范围 ≤ 10 天；多人（≤10）≤ 1 天。
   */
  async listUserCheckinRecords(
    useridList: string[],
    startTime: DateInput,
    endTime: DateInput,
    opts?: { size?: number },
  ): Promise<JsonRecord[]> {
    if (useridList.length === 0) return [];
    if (useridList.length > 10) {
      throw new Error("listUserCheckinRecords supports at most 10 users per call (DingTalk limit).");
    }
    const size = Math.min(opts?.size ?? 100, 100);
    const records: JsonRecord[] = [];
    let cursor = 0;
    for (let page = 0; page < 100; page += 1) {
      const body = await this.ctx.http.oapi<{
        result?: { data?: JsonRecord[]; next_cursor?: number };
      }>("POST", "/topapi/checkin/record/get", {
        body: {
          userid_list: useridList.join(","),
          start_time: toEpochMs(startTime),
          end_time: toEpochMs(endTime),
          cursor,
          size,
        },
      });
      const list = body.result?.data ?? [];
      records.push(...list);
      const next = body.result?.next_cursor;
      if (next === undefined || next === null || next <= cursor || list.length === 0) break;
      cursor = next;
    }
    return records;
  }
}
