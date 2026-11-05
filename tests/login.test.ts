import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { authorizedOf, loginStatus, startLogin, stopLogin } from "../src/login/session.js";
import { CliRunner } from "../src/cli/runner.js";
import { dingtalk } from "../src/providers/dingtalk.js";
import { wecom } from "../src/providers/wecom.js";

const FAKE = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));

afterAll(() => {
  stopLogin("dingtalk");
  stopLogin("wecom");
});

describe("authorizedOf", () => {
  it("normalizes CLI auth payloads", () => {
    expect(authorizedOf({ authenticated: true })).toBe(true);
    expect(authorizedOf({ authenticated: false })).toBe(false);
    expect(authorizedOf("authorized")).toBe(true);
    expect(authorizedOf("unauthorized")).toBe(false);
    expect(authorizedOf({ results: { authorized: "authorized" } })).toBe(true);
    expect(authorizedOf(null)).toBe(false);
    expect(authorizedOf(undefined)).toBe(false);
  });
});

describe("login session", () => {
  it("starts a background login and reports status without blocking", async () => {
    const runner = new CliRunner(dingtalk);
    const snap = await startLogin(dingtalk, runner, { bin: FAKE });
    expect(snap.provider).toBe("dingtalk");
    expect(typeof snap.running).toBe("boolean");

    const status = await loginStatus(dingtalk, runner, { bin: FAKE });
    expect(status.provider).toBe("dingtalk");
    expect(typeof status.authorized).toBe("boolean");
    expect(status.output).toBeTypeOf("string");
    // 会话存在时不拉起 CLI 查询 auth（等待扫码期间的轮询必须零开销）
    expect(status.auth).toBeUndefined();
  });

  it("requests a QR image path for wecom logins", async () => {
    const runner = new CliRunner(wecom);
    const snap = await startLogin(wecom, runner, { bin: FAKE });
    expect(snap.provider).toBe("wecom");
    // 二维码由 CLI 写盘；fake CLI 不会产出文件，因此这里只校验路径约定
    expect(snap.qrPath === undefined || snap.qrPath.endsWith(".png")).toBe(true);
    stopLogin("wecom");
  });
});
