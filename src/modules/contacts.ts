import type { ModuleContext } from "../context.js";
import type { JsonRecord } from "../types.js";

export interface UserDetail extends JsonRecord {
  userid?: string;
  unionid?: string;
  name?: string;
  mobile?: string;
  title?: string;
  email?: string;
  dept_id_list?: number[];
}

/**
 * 通讯录（辅助模块）：userId/unionId/手机号互查、部门成员与子部门枚举。
 * 日志、考勤、审批等模块都需要 userId / unionId，这里是 ID 体系的入口。
 */
export class ContactsModule {
  constructor(private readonly ctx: ModuleContext) {}

  /** 查询用户详情（含 unionId、姓名、部门等）。 */
  async getUser(userid: string, opts?: { language?: "zh_CN" | "en_US" }): Promise<UserDetail> {
    const body = await this.ctx.http.oapi<{ result?: UserDetail }>("POST", "/topapi/v2/user/get", {
      body: { userid, language: opts?.language ?? "zh_CN" },
    });
    return body.result ?? (body as unknown as UserDetail);
  }

  /** 根据手机号查询用户。 */
  async getUserIdByMobile(mobile: string): Promise<JsonRecord> {
    const body = await this.ctx.http.oapi<{ result?: JsonRecord }>("POST", "/topapi/v2/user/getbymobile", {
      body: { mobile },
    });
    return body.result ?? {};
  }

  /** 根据 unionId 获取用户 userId。 */
  async getUserIdByUnionId(unionid: string): Promise<JsonRecord> {
    const body = await this.ctx.http.oapi<{ result?: JsonRecord }>("POST", "/topapi/user/getbyunionid", {
      body: { unionid },
    });
    return body.result ?? {};
  }

  /** 按姓名/拼音搜索企业通讯录用户。 */
  async searchUser(
    queryWord: string,
    opts?: { offset?: number; size?: number; fullMatchField?: number },
  ): Promise<JsonRecord & { users?: JsonRecord[] }> {
    return this.ctx.http.api<JsonRecord & { users?: JsonRecord[] }>("POST", "/v1.0/contact/users/search", {
      body: {
        queryWord,
        offset: opts?.offset ?? 0,
        size: opts?.size ?? 20,
        ...(opts?.fullMatchField !== undefined ? { fullMatchField: opts.fullMatchField } : {}),
      },
    });
  }

  /** 获取部门下的成员 userId 列表（自动翻页）。 */
  async listDepartmentUserIds(
    deptId: number,
    opts?: { maxItems?: number; size?: number },
  ): Promise<{ userIds: string[]; truncated: boolean }> {
    const maxItems = Math.min(opts?.maxItems ?? 500, 10_000);
    const size = opts?.size ?? 100;
    const userIds: string[] = [];
    let cursor = 0;
    for (let page = 0; page < 100; page += 1) {
      const body = await this.ctx.http.oapi<{
        result?: { userid_list?: string[]; next_cursor?: number };
      }>("POST", "/topapi/user/listid", {
        body: { dept_id: deptId, cursor, size },
      });
      const list = body.result?.userid_list ?? [];
      userIds.push(...list);
      const next = body.result?.next_cursor;
      if (next === undefined || next === null || next <= cursor || userIds.length >= maxItems) break;
      cursor = next;
    }
    const truncated = userIds.length > maxItems;
    return { userIds: truncated ? userIds.slice(0, maxItems) : userIds, truncated };
  }

  /** 获取指定部门的子部门列表。 */
  async listSubDepartments(deptParentId = 1, opts?: { language?: string }): Promise<JsonRecord[]> {
    const body = await this.ctx.http.oapi<{ result?: JsonRecord[] }>("POST", "/topapi/v2/department/listsub", {
      body: { dept_id: deptParentId, language: opts?.language ?? "zh_CN" },
    });
    return body.result ?? [];
  }

  /** 便捷方法：userId → unionId。 */
  async getUnionId(userid: string): Promise<string> {
    const user = await this.getUser(userid);
    if (!user.unionid) throw new Error(`User ${userid} has no unionId in DingTalk response.`);
    return user.unionid;
  }
}
