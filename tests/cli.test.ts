import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliError, CliRunner, dingtalk, wecom } from "../src/index.js";

const FAKE = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));

describe("CliRunner", () => {
  it("dingtalk appends --format json", async () => {
    const runner = new CliRunner(dingtalk);
    const data = (await runner.runJson(["contact", "+me"], { bin: FAKE })) as {
      data: { args: string[] };
    };
    expect(data.data.args).toEqual(["contact", "+me", "--format", "json"]);
  });

  it("wecom appends no format flag (JSON is default)", async () => {
    const runner = new CliRunner(wecom);
    const data = (await runner.runJson(
      ["contact", "users", "search", "--keywords", "张三"],
      { bin: FAKE },
    )) as { data: { args: string[] } };
    expect(data.data.args).toEqual(["contact", "users", "search", "--keywords", "张三"]);
  });

  it("maps stderr error envelope to CliError", async () => {
    const runner = new CliRunner(dingtalk);
    await expect(
      runner.runJson(["x"], { bin: FAKE, env: { FAKE_CLI_ERROR: "1" } }),
    ).rejects.toMatchObject({ name: "CliError", code: 3, message: "fake cli error" });
  });

  it("falls back to raw text when stdout is not JSON", async () => {
    const runner = new CliRunner(wecom);
    const data = await runner.runJson(["x"], { bin: FAKE, env: { FAKE_CLI_PLAIN: "1" } });
    expect(data).toBe("plain text, not json");
  });

  it("exposes provider id", () => {
    expect(new CliRunner(dingtalk).providerId).toBe("dingtalk");
    expect(new CliRunner(wecom).providerId).toBe("wecom");
  });

  it("CliError.toJSON carries code/reason/command", () => {
    const e = new CliError({ message: "boom", command: "dws x", code: 3, reason: "test" });
    expect(e.toJSON()).toMatchObject({ name: "CliError", code: 3, reason: "test", command: "dws x" });
  });
});
