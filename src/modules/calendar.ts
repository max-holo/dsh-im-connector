import type { ModuleContext } from "../context.js";
import type { DateInput, JsonRecord } from "../types.js";
import { toIsoDateTime } from "../util.js";

export interface CalendarPage<T> {
  items: T[];
  nextToken?: string;
  hasMore: boolean;
}

/**
 * 日历/日程读取。
 *
 * 端点（api.dingtalk.com，企业内部应用 accessToken + 用户 unionId）：
 * - 日历列表:   GET /v1.0/calendar/users/{unionId}/calendars
 * - 日程视图:   GET /v1.0/calendar/users/{unionId}/calendars/{calendarId}/eventsview
 * - 日程详情:   GET /v1.0/calendar/users/{unionId}/calendars/{calendarId}/events/{eventId}
 * - 参与者列表: GET /v1.0/calendar/users/{unionId}/calendars/{calendarId}/events/{eventId}/attendees
 *
 * calendarId 通常传 "primary"（用户主日历）。
 */
export class CalendarModule {
  constructor(private readonly ctx: ModuleContext) {}

  /** 获取用户可见的日历列表。 */
  async listCalendars(
    unionId: string,
    opts?: { maxResults?: number; nextToken?: string },
  ): Promise<CalendarPage<JsonRecord>> {
    const body = await this.ctx.http.api<{ calendars?: JsonRecord[]; nextPageToken?: string }>(
      "GET",
      `/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars`,
      {
        query: {
          maxResults: opts?.maxResults ?? 100,
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
        },
      },
    );
    const items = body.calendars ?? [];
    return {
      items,
      nextToken: body.nextPageToken,
      hasMore: Boolean(body.nextPageToken),
    };
  }

  /** 按时间范围查询日程（日程视图 eventsview）。 */
  async listEvents(
    unionId: string,
    timeMin: DateInput,
    timeMax: DateInput,
    opts?: { calendarId?: string; maxResults?: number; nextToken?: string; maxAttendees?: number },
  ): Promise<CalendarPage<JsonRecord>> {
    const calendarId = encodeURIComponent(opts?.calendarId ?? "primary");
    const body = await this.ctx.http.api<{ events?: JsonRecord[]; nextToken?: string }>(
      "GET",
      `/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars/${calendarId}/eventsview`,
      {
        query: {
          timeMin: toIsoDateTime(timeMin),
          timeMax: toIsoDateTime(timeMax),
          maxAttendees: opts?.maxAttendees ?? 20,
          maxResults: opts?.maxResults ?? 50,
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
        },
      },
    );
    const items = body.events ?? [];
    return {
      items,
      nextToken: body.nextToken,
      hasMore: Boolean(body.nextToken),
    };
  }

  /** 按时间范围收集日程（自动翻页，受 maxItems 限制）。 */
  async collectEvents(
    unionId: string,
    timeMin: DateInput,
    timeMax: DateInput,
    opts?: { calendarId?: string; maxItems?: number; maxAttendees?: number },
  ): Promise<{ events: JsonRecord[]; truncated: boolean }> {
    const maxItems = Math.min(opts?.maxItems ?? 200, 1000);
    const events: JsonRecord[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const res = await this.listEvents(unionId, timeMin, timeMax, {
        calendarId: opts?.calendarId,
        maxAttendees: opts?.maxAttendees,
        nextToken,
      });
      events.push(...res.items);
      nextToken = res.nextToken;
      if (!nextToken || events.length >= maxItems) break;
    }
    const truncated = events.length > maxItems;
    return { events: truncated ? events.slice(0, maxItems) : events, truncated };
  }

  /** 查询单个日程详情。 */
  async getEvent(
    unionId: string,
    eventId: string,
    opts?: { calendarId?: string; maxAttendees?: number },
  ): Promise<JsonRecord> {
    const calendarId = encodeURIComponent(opts?.calendarId ?? "primary");
    return this.ctx.http.api<JsonRecord>(
      "GET",
      `/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
      { query: { maxAttendees: opts?.maxAttendees ?? 20 } },
    );
  }

  /** 获取日程参与者列表。 */
  async listEventAttendees(
    unionId: string,
    eventId: string,
    opts?: { calendarId?: string; maxResults?: number; nextToken?: string },
  ): Promise<CalendarPage<JsonRecord>> {
    const calendarId = encodeURIComponent(opts?.calendarId ?? "primary");
    const body = await this.ctx.http.api<{ attendees?: JsonRecord[]; nextToken?: string }>(
      "GET",
      `/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}/attendees`,
      {
        query: {
          maxResults: opts?.maxResults ?? 100,
          ...(opts?.nextToken ? { nextToken: opts.nextToken } : {}),
        },
      },
    );
    const items = body.attendees ?? [];
    return { items, nextToken: body.nextToken, hasMore: Boolean(body.nextToken) };
  }
}
