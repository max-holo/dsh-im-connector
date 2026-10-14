import type { DwsRunner } from "../dws/runner.js";
import { buildFlags } from "../dws/flags.js";

/** 日志（日报/周报）读取（dws report）。 */
export class ReportModule {
  constructor(private readonly runner: DwsRunner) {}

  /** 我收到的日志（收件箱）。 */
  inbox(): Promise<unknown> {
    return this.runner.runJson(["report", "inbox", "list"]);
  }

  /** 我发出的日志（发件箱）。 */
  outbox(): Promise<unknown> {
    return this.runner.runJson(["report", "outbox", "list"]);
  }

  /** 单份日报正文。 */
  get(reportId: string): Promise<unknown> {
    return this.runner.runJson(["report", "entry", "get", ...buildFlags({ "report-id": reportId })]);
  }

  /** 可用日志模板列表。 */
  templates(): Promise<unknown> {
    return this.runner.runJson(["report", "template", "list"]);
  }
}
