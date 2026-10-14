import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServer } from "./mock/server.js";
import { DingTalkConnector } from "../src/index.js";

describe("core client (token / retry / error mapping)", () => {
  let mock: MockServer;
  let conn: DingTalkConnector;

  beforeAll(async () => {
    mock = await startMockServer();
    conn = new DingTalkConnector({
      appKey: "test-key",
      appSecret: "test-secret",
      apiBase: mock.url,
      oapiBase: mock.url,
      retryBaseDelayMs: 5,
      maxRetries: 3,
    });
  });

  afterAll(async () => {
    await mock.close();
  });

  it("caches the enterprise access token across calls", async () => {
    await conn.calendar.listCalendars("u1");
    await conn.calendar.listCalendars("u2");
    const tokenCalls = mock.requests.filter((r) => r.path === "/v1.0/oauth2/accessToken");
    expect(tokenCalls.length).toBe(1);
    expect(tokenCalls[0].body).toMatchObject({ appKey: "test-key", appSecret: "test-secret" });
  });

  it("sends the enterprise token as header on REST APIs", async () => {
    await conn.calendar.listCalendars("u1");
    const call = mock.requests.at(-1);
    expect(call?.headers["x-acs-dingtalk-access-token"]).toBe("mock-token");
  });

  it("sends the enterprise token as query param on OAPIs", async () => {
    await conn.contacts.getUser("u1");
    const call = mock.requests.at(-1);
    expect(call?.query.get("access_token")).toBe("mock-token");
  });

  it("maps REST API errors to DingTalkError", async () => {
    await expect(conn.http.api("GET", "/test-error")).rejects.toMatchObject({
      name: "DingTalkError",
      code: "invalid.param",
      httpStatus: 400,
      message: "参数错误",
    });
  });

  it("maps OAPI errcode errors to DingTalkError", async () => {
    await expect(conn.http.oapi("POST", "/topapi/test-oapi-error", { body: {} })).rejects.toMatchObject(
      {
        name: "DingTalkError",
        code: 60020,
        message: "访问被拒绝",
      },
    );
  });

  it("retries transient 5xx failures with backoff", async () => {
    const before = mock.retryHits;
    const result = await conn.http.api<{ ok: boolean }>("GET", "/test-retry");
    expect(result.ok).toBe(true);
    expect(mock.retryHits).toBe(before + 2); // one failure, one success
  });

  it("does not retry non-retryable errors", async () => {
    const callsBefore = mock.requests.filter((r) => r.path === "/test-error").length;
    await expect(conn.http.api("GET", "/test-error")).rejects.toThrow();
    const callsAfter = mock.requests.filter((r) => r.path === "/test-error").length;
    expect(callsAfter).toBe(callsBefore + 1);
  });

  it("omits empty/undefined query params", async () => {
    await conn.docs.listFiles("sp1", "union-1");
    const call = mock.requests.at(-1);
    expect(call?.query.get("parentId")).toBeNull(); // not sent
    expect(call?.query.get("unionId")).toBe("union-1");
    expect(call?.query.get("maxResults")).toBe("100");
  });
});
