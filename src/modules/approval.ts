import type { DwsRunner } from "../dws/runner.js";
import { buildFlags } from "../dws/flags.js";

/** OA 审批读取（dws oa approval）。 */
export class ApprovalModule {
  constructor(private readonly runner: DwsRunner) {}

  /** 待我处理的审批。 */
  listPending(): Promise<unknown> {
    return this.runner.runJson(["oa", "approval", "list-pending"]);
  }

  /** 我处理过的审批。 */
  listExecuted(): Promise<unknown> {
    return this.runner.runJson(["oa", "approval", "list-executed"]);
  }

  /** 抄送我的审批单。 */
  listCc(): Promise<unknown> {
    return this.runner.runJson(["oa", "approval", "list-cc"]);
  }

  /** 我发起的审批单。 */
  listSubmitted(): Promise<unknown> {
    return this.runner.runJson(["oa", "approval", "list-submitted"]);
  }

  /** 我可见的审批表单（模板）列表。 */
  listForms(): Promise<unknown> {
    return this.runner.runJson(["oa", "approval", "list-forms"]);
  }

  /** 按关键字搜索可见审批表单。 */
  searchForms(keyword: string): Promise<unknown> {
    return this.runner.runJson(["oa", "approval", "search-forms", ...buildFlags({ keyword })]);
  }

  /** 审批实例详情（表单内容与状态）。 */
  getInstance(instanceId: string): Promise<unknown> {
    return this.runner.runJson(["oa", "approval", "detail", ...buildFlags({ "instance-id": instanceId })]);
  }

  /** 审批操作记录。 */
  getRecords(instanceId: string): Promise<unknown> {
    return this.runner.runJson(["oa", "approval", "records", ...buildFlags({ "instance-id": instanceId })]);
  }
}
