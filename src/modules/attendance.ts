import type { DwsRunner } from "../dws/runner.js";
import { buildFlags } from "../dws/flags.js";

export interface CheckResultOptions {
  users: string[];
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  limit?: number;
  offset?: number;
}

export interface SummaryOptions {
  user: string;
  date: string;
  statsType: "week" | "month";
}

/** 考勤读取（dws attendance）。 */
export class AttendanceModule {
  constructor(private readonly runner: DwsRunner) {}

  /** 我今天的考勤打卡记录。 */
  today(): Promise<unknown> {
    return this.runner.runJson(["attendance", "+my-attendance"]);
  }

  /** 我本月的考勤打卡记录。 */
  thisMonth(): Promise<unknown> {
    return this.runner.runJson(["attendance", "+this-month"]);
  }

  /** 批量打卡结果（正常/迟到/早退/缺卡）。 */
  checkResult(opts: CheckResultOptions): Promise<unknown> {
    return this.runner.runJson([
      "attendance",
      "+check-result",
      ...buildFlags({ users: opts.users, start: opts.start, end: opts.end, limit: opts.limit, offset: opts.offset }),
    ]);
  }

  /** 某人的考勤统计摘要（周/月）。 */
  summary(opts: SummaryOptions): Promise<unknown> {
    return this.runner.runJson([
      "attendance",
      "+get-summary",
      ...buildFlags({ user: opts.user, date: opts.date, "stats-type": opts.statsType }),
    ]);
  }
}
