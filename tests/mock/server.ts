import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export interface MockServer {
  url: string;
  requests: RecordedRequest[];
  retryHits: number;
  close(): Promise<void>;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: (ctx: {
    req: RecordedRequest;
    params: RegExpMatchArray;
    reply: (status: number, body: unknown) => void;
  }) => void;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function defineRoutes(retryCounter: { hits: number }): Route[] {
  return [
    // ---------------- 日历 ----------------
    {
      method: "GET",
      pattern: /^\/v1\.0\/calendar\/users\/([^/]+)\/calendars$/,
      handler: ({ reply }) =>
        reply(200, { calendars: [{ calendarId: "primary", summary: "主日历" }] }),
    },
    {
      method: "GET",
      pattern: /^\/v1\.0\/calendar\/users\/([^/]+)\/calendars\/([^/]+)\/eventsview$/,
      handler: ({ req, reply }) => {
        if (req.query.get("nextToken") === "page2") {
          reply(200, { events: [{ id: "e2", summary: "第二页日程" }] });
        } else {
          reply(200, { events: [{ id: "e1", summary: "第一页日程" }], nextToken: "page2" });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\.0\/calendar\/users\/([^/]+)\/calendars\/([^/]+)\/events\/([^/]+)$/,
      handler: ({ params, reply }) =>
        reply(200, { id: decodeURIComponent(params[3]), summary: "周会" }),
    },
    {
      method: "GET",
      pattern: /^\/v1\.0\/calendar\/users\/([^/]+)\/calendars\/([^/]+)\/events\/([^/]+)\/attendees$/,
      handler: ({ reply }) => reply(200, { attendees: [{ id: "a1", isOptional: false }] }),
    },

    // ---------------- 待办 ----------------
    {
      method: "POST",
      pattern: /^\/v1\.0\/todo\/users\/([^/]+)\/org\/tasks\/query$/,
      handler: ({ req, reply }) => {
        if (req.body?.nextToken === "p2") {
          reply(200, { tasks: [{ taskId: "t2", subject: "第二页待办" }], hasMore: false });
        } else {
          reply(200, {
            tasks: [{ taskId: "t1", subject: "写周报", done: false }],
            nextToken: "p2",
            hasMore: true,
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\.0\/todo\/users\/([^/]+)\/tasks\/([^/]+)$/,
      handler: ({ params, reply }) =>
        reply(200, { taskId: params[2], subject: "写周报", done: false }),
    },

    // ---------------- 审批 ----------------
    {
      method: "POST",
      pattern: /^\/v1\.0\/workflow\/processes\/instanceIds\/query$/,
      handler: ({ req, reply }) => {
        if (Number(req.body?.nextToken) === 2) {
          reply(200, { result: { list: ["id-3"] }, success: true });
        } else {
          reply(200, { result: { list: ["id-1", "id-2"], nextToken: "2" }, success: true });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\.0\/workflow\/processInstances$/,
      handler: ({ req, reply }) =>
        reply(200, {
          result: {
            title: "张三的请假申请",
            processInstanceId: req.query.get("processInstanceId"),
            status: "RUNNING",
            formComponentValues: [{ name: "请假事由", value: "家中有事" }],
          },
          success: true,
        }),
    },

    // ---------------- 钉盘 / 知识库 / 文档 ----------------
    {
      method: "GET",
      pattern: /^\/v1\.0\/drive\/spaces$/,
      handler: ({ reply }) =>
        reply(200, { spaces: [{ spaceId: "sp1", name: "我的文档" }] }),
    },
    {
      method: "GET",
      pattern: /^\/v1\.0\/drive\/spaces\/([^/]+)\/files$/,
      handler: ({ reply }) =>
        reply(200, { files: [{ dentryUuid: "f1", name: "README", type: "FILE" }] }),
    },
    {
      method: "GET",
      pattern: /^\/v2\.0\/wiki\/workspaces$/,
      handler: ({ reply }) =>
        reply(200, {
          workspaces: [{ workspaceId: "w1", name: "团队知识库", rootNodeId: "root1" }],
        }),
    },
    {
      method: "GET",
      pattern: /^\/v2\.0\/wiki\/nodes$/,
      handler: ({ reply }) =>
        reply(200, { nodes: [{ nodeId: "n1", name: "需求文档", category: "ALIDOC" }] }),
    },
    {
      method: "GET",
      pattern: /^\/v1\.0\/doc\/suites\/documents\/([^/]+)\/blocks$/,
      handler: ({ reply }) =>
        reply(200, {
          success: true,
          result: { data: [{ blockType: "paragraph", paragraph: { text: "文档第一段" } }] },
        }),
    },

    // ---------------- 消息 / 通讯录 ----------------
    {
      method: "GET",
      pattern: /^\/v1\.0\/im\/conversations\/([^/]+)$/,
      handler: ({ params, reply }) =>
        reply(200, { openConversationId: params[1], title: "测试群", memberCount: 3 }),
    },
    {
      method: "GET",
      pattern: /^\/v1\.0\/im\/sceneGroups\/([^/]+)\/members$/,
      handler: ({ reply }) => reply(200, { members: [{ nick: "张三" }] }),
    },
    {
      method: "POST",
      pattern: /^\/v1\.0\/contact\/users\/search$/,
      handler: ({ req, reply }) =>
        reply(200, { users: [{ userid: "u1", name: `匹配:${req.body?.queryWord}` }] }),
    },

    // ---------------- 通讯录 OAPI ----------------
    {
      method: "POST",
      pattern: /^\/topapi\/v2\/user\/get$/,
      handler: ({ req, reply }) =>
        reply(200, {
          errcode: 0,
          errmsg: "ok",
          result: { userid: req.body?.userid, unionid: `union-${req.body?.userid}`, name: "张三" },
        }),
    },
    {
      method: "POST",
      pattern: /^\/topapi\/v2\/user\/getbymobile$/,
      handler: ({ reply }) => reply(200, { errcode: 0, errmsg: "ok", result: { userid: "u1" } }),
    },
    {
      method: "POST",
      pattern: /^\/topapi\/user\/getbyunionid$/,
      handler: ({ reply }) => reply(200, { errcode: 0, errmsg: "ok", result: { userid: "u1" } }),
    },
    {
      method: "POST",
      pattern: /^\/topapi\/user\/listid$/,
      handler: ({ reply }) =>
        reply(200, { errcode: 0, errmsg: "ok", result: { userid_list: ["u1", "u2"] } }),
    },
    {
      method: "POST",
      pattern: /^\/topapi\/v2\/department\/listsub$/,
      handler: ({ reply }) =>
        reply(200, { errcode: 0, errmsg: "ok", result: [{ dept_id: 2, name: "研发部" }] }),
    },

    // ---------------- 审批 OAPI ----------------
    {
      method: "POST",
      pattern: /^\/topapi\/process\/listbyuserid$/,
      handler: ({ reply }) =>
        reply(200, {
          errcode: 0,
          errmsg: "ok",
          result: { process_list: [{ name: "请假", process_code: "PROC-1" }], total: 1 },
        }),
    },
    {
      method: "POST",
      pattern: /^\/topapi\/process\/gettodocount$/,
      handler: ({ reply }) => reply(200, { errcode: 0, errmsg: "ok", result: [{ count: 3 }] }),
    },

    // ---------------- 考勤 OAPI ----------------
    {
      method: "POST",
      pattern: /^\/attendance\/list$/,
      handler: ({ req, reply }) => {
        if (!ISO_DATETIME.test(String(req.body?.workDateFrom ?? ""))) {
          reply(200, { errcode: -1, errmsg: "workDateFrom must be yyyy-MM-dd HH:mm:ss" });
          return;
        }
        reply(200, {
          errcode: 0,
          errmsg: "ok",
          recordresult: [
            { userId: (req.body?.userIds as string[])[0], timeResult: "Normal", checkType: "OnDuty" },
          ],
          hasMore: false,
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/attendance\/listRecord$/,
      handler: ({ req, reply }) => {
        if (!ISO_DATETIME.test(String(req.body?.checkDateFrom ?? ""))) {
          reply(200, { errcode: -1, errmsg: "checkDateFrom must be yyyy-MM-dd HH:mm:ss" });
          return;
        }
        reply(200, {
          errcode: 0,
          errmsg: "ok",
          recordresult: [{ userId: (req.body?.userIds as string[])[0], userCheckTime: 1599441505000 }],
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/checkin\/record$/,
      handler: ({ reply }) => reply(200, { errcode: 0, errmsg: "ok", data: [{ userid: "u1" }] }),
    },
    {
      method: "POST",
      pattern: /^\/topapi\/checkin\/record\/get$/,
      handler: ({ reply }) =>
        reply(200, { errcode: 0, errmsg: "ok", result: { data: [{ userid: "u1" }] } }),
    },

    // ---------------- 日志 OAPI ----------------
    {
      method: "POST",
      pattern: /^\/topapi\/report\/list$/,
      handler: ({ req, reply }) => {
        if (Number(req.body?.cursor) > 0) {
          reply(200, {
            errcode: 0,
            errmsg: "ok",
            result: { data_list: [{ report_code: "r2" }], next_cursor: 0 },
          });
        } else {
          reply(200, {
            errcode: 0,
            errmsg: "ok",
            result: { data_list: [{ report_code: "r1" }], next_cursor: 20 },
          });
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/topapi\/report\/template\/listbyuserid$/,
      handler: ({ reply }) =>
        reply(200, {
          errcode: 0,
          errmsg: "ok",
          result: { template_list: [{ name: "日报", report_code: "t1" }] },
        }),
    },
    {
      method: "POST",
      pattern: /^\/topapi\/report\/template\/getbyname$/,
      handler: ({ req, reply }) =>
        reply(200, {
          errcode: 0,
          errmsg: "ok",
          result: { id: "t1", name: req.body?.template_name, fields: [{ field_name: "今日完成" }] },
        }),
    },

    // ---------------- 消息 OAPI ----------------
    {
      method: "GET",
      pattern: /^\/chat\/list$/,
      handler: ({ reply }) =>
        reply(200, { errcode: 0, errmsg: "ok", chat_list: [{ chatid: "c1", name: "群1" }] }),
    },

    // ---------------- 测试专用 ----------------
    {
      method: "GET",
      pattern: /^\/test-error$/,
      handler: ({ reply }) => reply(400, { code: "invalid.param", message: "参数错误" }),
    },
    {
      method: "GET",
      pattern: /^\/test-retry$/,
      handler: ({ reply }) => {
        retryCounter.hits += 1;
        if (retryCounter.hits < 2) {
          reply(500, { code: "systemError", message: "系统异常" });
        } else {
          reply(200, { ok: true });
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/topapi\/test-oapi-error$/,
      handler: ({ reply }) => reply(200, { errcode: 60020, errmsg: "访问被拒绝" }),
    },
  ];
}

export async function startMockServer(): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  const retryCounter = { hits: 0 };
  const routes = defineRoutes(retryCounter);

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock.local");
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = rawBody ? JSON.parse(rawBody) : undefined;
      } catch {
        body = rawBody;
      }
      const recorded: RecordedRequest = {
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      };
      requests.push(recorded);

      const reply = (status: number, payload: unknown): void => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      // Token endpoint (no auth required).
      if (url.pathname === "/v1.0/oauth2/accessToken") {
        reply(200, { accessToken: "mock-token", expireIn: 7200 });
        return;
      }

      const isOapi =
        url.pathname.startsWith("/topapi") ||
        url.pathname.startsWith("/attendance") ||
        url.pathname.startsWith("/checkin") ||
        url.pathname.startsWith("/chat");

      // Auth validation.
      if (isOapi) {
        if (url.searchParams.get("access_token") !== "mock-token") {
          reply(200, { errcode: 60011, errmsg: "invalid access_token" });
          return;
        }
      } else if (req.headers["x-acs-dingtalk-access-token"] !== "mock-token") {
        reply(401, { code: "invalidAuthentication", message: "bad token" });
        return;
      }

      for (const route of routes) {
        if (route.method !== recorded.method) continue;
        const match = url.pathname.match(route.pattern);
        if (!match) continue;
        route.handler({ req: recorded, params: match, reply });
        return;
      }
      reply(404, { code: "notFound", message: `no mock route for ${recorded.method} ${url.pathname}` });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    get retryHits() {
      return retryCounter.hits;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
