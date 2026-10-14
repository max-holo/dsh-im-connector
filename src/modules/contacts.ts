import type { DwsRunner } from "../dws/runner.js";
import { buildFlags } from "../dws/flags.js";

/**
 * 通讯录读取（dws contact）。
 * 各域需要 userId 时可用本模块解析姓名/手机号/部门。
 */
export class ContactsModule {
  constructor(private readonly runner: DwsRunner) {}

  /** 我的通讯录资料。 */
  me(): Promise<unknown> {
    return this.runner.runJson(["contact", "+me"]);
  }

  /** 按姓名/拼音搜索用户。 */
  searchUser(query: string): Promise<unknown> {
    return this.runner.runJson(["contact", "+search-user", ...buildFlags({ query })]);
  }

  /** 按部门名列出部门直接成员（仅本部门）。 */
  listDepartmentMembers(dept: string): Promise<unknown> {
    return this.runner.runJson(["contact", "+dept-members", ...buildFlags({ dept })]);
  }

  /** 列出子部门（父部门 ID，根为 1）。 */
  listSubDepartments(deptParentId: number): Promise<unknown> {
    return this.runner.runJson(["contact", "+list-sub-depts", ...buildFlags({ dept: deptParentId })]);
  }
}
