import type { DwsRunner } from "../dws/runner.js";
import { buildFlags } from "../dws/flags.js";

export interface AgendaOptions {
  start?: string;
  end?: string;
  calendarId?: string;
  limit?: number;
  cursor?: string;
}

export interface FreeBusyOptions {
  start: string;
  end: string;
  users?: string[];
  rooms?: string[];
}

/** 日历/日程读取（dws calendar）。 */
export class CalendarModule {
  constructor(private readonly runner: DwsRunner) {}

  today(): Promise<unknown> {
    return this.runner.runJson(["calendar", "+today"]);
  }

  tomorrow(): Promise<unknown> {
    return this.runner.runJson(["calendar", "+tomorrow"]);
  }

  week(): Promise<unknown> {
    return this.runner.runJson(["calendar", "+week"]);
  }

  /** 按时间范围查询日程列表。 */
  agenda(opts: AgendaOptions = {}): Promise<unknown> {
    return this.runner.runJson(["calendar", "+agenda", ...buildFlags({ ...opts })]);
  }

  /** 查询单个日程详情。 */
  getEvent(event: string, opts?: { calendarId?: string }): Promise<unknown> {
    return this.runner.runJson([
      "calendar",
      "+get",
      ...buildFlags({ event, "calendar-id": opts?.calendarId }),
    ]);
  }

  /** 查询用户/会议室闲忙。 */
  freeBusy(opts: FreeBusyOptions): Promise<unknown> {
    return this.runner.runJson([
      "calendar",
      "+freebusy",
      ...buildFlags({ start: opts.start, end: opts.end, users: opts.users, rooms: opts.rooms }),
    ]);
  }

  /** 日历本列表。 */
  listBooks(): Promise<unknown> {
    return this.runner.runJson(["calendar", "+book-list"]);
  }
}
