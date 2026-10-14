import type { ConnectorOptions, ResolvedConnectorOptions } from "./config.js";
import { resolveOptions } from "./config.js";
import { TokenManager } from "./token.js";
import { Http } from "./http.js";
import type { ModuleContext } from "./context.js";
import { ContactsModule } from "./modules/contacts.js";
import { CalendarModule } from "./modules/calendar.js";
import { TodoModule } from "./modules/todo.js";
import { ApprovalModule } from "./modules/approval.js";
import { AttendanceModule } from "./modules/attendance.js";
import { ReportModule } from "./modules/report.js";
import { DocsModule } from "./modules/docs.js";
import { MessagesModule } from "./modules/messages.js";

/**
 * 钉钉只读连接器。
 *
 * 覆盖：消息（会话 + Stream 捕获）、日历日程、待办、审批、考勤、日志（日报/周报）、
 * 文档（钉盘/知识库/文档内容）、通讯录。
 *
 * 使用企业内部应用的 AppKey/AppSecret 获取 accessToken，
 * 各模块以 userId / unionId 指定数据归属。
 */
export class DingTalkConnector {
  readonly options: ResolvedConnectorOptions;
  readonly token: TokenManager;
  readonly http: Http;

  readonly contacts: ContactsModule;
  readonly calendar: CalendarModule;
  readonly todo: TodoModule;
  readonly approval: ApprovalModule;
  readonly attendance: AttendanceModule;
  readonly report: ReportModule;
  readonly docs: DocsModule;
  readonly messages: MessagesModule;

  constructor(options: ConnectorOptions) {
    this.options = resolveOptions(options);
    this.token = new TokenManager(this.options);
    this.http = new Http(this.options, this.token);
    const ctx: ModuleContext = { http: this.http, options: this.options };
    this.contacts = new ContactsModule(ctx);
    this.calendar = new CalendarModule(ctx);
    this.todo = new TodoModule(ctx);
    this.approval = new ApprovalModule(ctx);
    this.attendance = new AttendanceModule(ctx);
    this.report = new ReportModule(ctx);
    this.docs = new DocsModule(ctx);
    this.messages = new MessagesModule(ctx);
  }
}
