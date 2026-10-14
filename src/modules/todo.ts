import type { DwsRunner } from "../dws/runner.js";
import { buildFlags } from "../dws/flags.js";

/** 待办读取（dws todo）。 */
export class TodoModule {
  constructor(private readonly runner: DwsRunner) {}

  /** 当前组织下我的待办列表。 */
  listMyTasks(): Promise<unknown> {
    return this.runner.runJson(["todo", "+get-my-tasks"]);
  }

  /** 与我相关的全部待办（创建/执行/参与三角色并集）。 */
  listRelatedTasks(): Promise<unknown> {
    return this.runner.runJson(["todo", "+get-related-tasks"]);
  }

  /** 我创建的待办。 */
  listCreated(): Promise<unknown> {
    return this.runner.runJson(["todo", "+created-todos"]);
  }

  /** 今天到期的待办。 */
  dueToday(): Promise<unknown> {
    return this.runner.runJson(["todo", "+due-today"]);
  }

  /** 已过期未完成待办。 */
  overdue(): Promise<unknown> {
    return this.runner.runJson(["todo", "+overdue"]);
  }

  /** 待办详情。 */
  get(taskId: string): Promise<unknown> {
    return this.runner.runJson(["todo", "+get", ...buildFlags({ "task-id": taskId })]);
  }

  /** 按标题关键词搜索与我相关的待办。 */
  search(query: string, opts?: { status?: "true" | "false" }): Promise<unknown> {
    return this.runner.runJson([
      "todo",
      "+search",
      ...buildFlags({ query, status: opts?.status }),
    ]);
  }
}
