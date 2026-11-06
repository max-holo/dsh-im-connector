import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  authorizedOf,
  extractDeviceGrant,
  loginStatus,
  qrDataUrlFor,
  startLogin,
  stopLogin,
} from "../src/login/session.js";
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

describe("device grant", () => {
  it("extracts the prefilled URL and user code from device-flow output", () => {
    const text = [
      "● Step 1: 请求设备授权码...",
      "",
      "  授权码: FGTH-RFCT",
      "  授权码将在 900 秒后过期。",
      "",
      "  授权链接（已填入授权码）：",
      "https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&callerUmt=P1gAsgnlCvv0dHOcriLDtugEZO2fU7c&user_code=FGTH-RFCT",
      "",
      "  手动输入授权码的链接：",
      "https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&callerUmt=P1gAsgnlCvv0dHOcriLDtugEZO2fU7c",
    ].join("\n");
    const grant = extractDeviceGrant(text);
    expect(grant?.url).toBe(
      "https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&callerUmt=P1gAsgnlCvv0dHOcriLDtugEZO2fU7c&user_code=FGTH-RFCT",
    );
    expect(grant?.userCode).toBe("FGTH-RFCT");
  });

  it("returns undefined when no prefilled device URL is present", () => {
    expect(
      extractDeviceGrant("授权码: ABCD-EFGH\nhttps://login.dingtalk.com/oauth2/device/verify.htm?caller=dws"),
    ).toBeUndefined();
  });

  it("generates a QR data URL for a device link", async () => {
    const url = await qrDataUrlFor("https://login.dingtalk.com/oauth2/device/verify.htm?user_code=ABCD-EFGH");
    expect(url).toMatch(/^data:image\/png;base64,/);
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
