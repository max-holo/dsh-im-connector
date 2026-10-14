import type { ConnectorOptions, ResolvedConnectorOptions } from "./config.js";
import { resolveOptions } from "./config.js";
import { DwsRunner } from "./dws/runner.js";
import type { DwsRunOptions } from "./dws/runner.js";
import { ContactsModule } from "./modules/contacts.js";
import { CalendarModule } from "./modules/calendar.js";
import { TodoModule } from "./modules/todo.js";
import { ApprovalModule } from "./modules/approval.js";
import { AttendanceModule } from "./modules/attendance.js";
import { ReportModule } from "./modules/report.js";
import { DocsModule } from "./modules/docs.js";
import { MessagesModule } from "./modules/messages.js";

/**
 * 基于 dingtalk-workspace-cli（dws）的钉钉只读连接器。
 *
 * 认证由 dws 本地 OAuth 登录态管理（`dws auth login`），连接器本身不保存凭据；
 * 各域读取能力通过 `dws <service> <+shortcut|command>` 的 JSON 输出透传实现。
 */
export class DingTalkConnector {
  readonly options: ResolvedConnectorOptions;
  readonly runner: DwsRunner;

  readonly contacts: ContactsModule;
  readonly calendar: CalendarModule;
  readonly todo: TodoModule;
  readonly approval: ApprovalModule;
  readonly attendance: AttendanceModule;
  readonly report: ReportModule;
  readonly docs: DocsModule;
  readonly messages: MessagesModule;

  constructor(options: ConnectorOptions = {}) {
    this.options = resolveOptions(options);
    this.runner = new DwsRunner({
      bin: this.options.dwsBin,
      timeoutSec: this.options.timeoutSec,
    });
    this.contacts = new ContactsModule(this.runner);
    this.calendar = new CalendarModule(this.runner);
    this.todo = new TodoModule(this.runner);
    this.approval = new ApprovalModule(this.runner);
    this.attendance = new AttendanceModule(this.runner);
    this.report = new ReportModule(this.runner);
    this.docs = new DocsModule(this.runner);
    this.messages = new MessagesModule(this.runner);
  }

  /** 逃生舱：直接运行任意 dws 命令并返回解析后的 JSON。 */
  run(args: string[], opts?: Omit<DwsRunOptions, "profile"> & { profile?: string }): Promise<unknown> {
    return this.runner.runJson(args, {
      profile: opts?.profile ?? this.options.profile,
      timeoutSec: opts?.timeoutSec,
      signal: opts?.signal,
      env: { ...this.options.env, ...opts?.env },
    });
  }
}
