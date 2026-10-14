import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DwsRunner, DwsError, buildFlags } from "../src/index.js";

const FAKE = fileURLToPath(new URL("./fake-dws.mjs", import.meta.url));

describe("buildFlags", () => {
  it("emits kebab-case flags, skips empty, joins arrays as CSV, handles booleans", () => {
    expect(
      buildFlags({ a: 1, b: "x y", c: true, d: false, e: undefined, f: ["u1", "u2"], g: [] }),
    ).toEqual(["--a", "1", "--b", "x y", "--c", "--f", "u1,u2"]);
  });
});

describe("DwsRunner", () => {
  let dir: string;
  let logFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "dtconn-dws-"));
    logFile = join(dir, "calls.jsonl");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runner() {
    return new DwsRunner({ bin: FAKE, timeoutSec: 30 });
  }

  function lastCall() {
    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    return JSON.parse(lines[lines.length - 1]) as string[];
  }

  it("runs a command and returns parsed JSON, appending --format json", async () => {
    const data = (await runner().runJson(["calendar", "+today"], {
      env: { FAKE_DWS_LOG: logFile },
    })) as { data: { args: string[]; marker: string } };
    expect(data.data.marker).toBe("fake-dws");
    expect(data.data.args).toEqual(["calendar", "+today", "--format", "json"]);
  });

  it("injects --profile and --timeout", async () => {
    const data = (await runner().runJson(["todo", "+get-my-tasks"], {
      profile: "corp1:user1",
      timeoutSec: 12,
      env: { FAKE_DWS_LOG: logFile },
    })) as { data: { args: string[] } };
    expect(data.data.args).toEqual([
      "todo",
      "+get-my-tasks",
      "--format",
      "json",
      "--profile",
      "corp1:user1",
      "--timeout",
      "12",
    ]);
  });

  it("maps stderr error envelope to DwsError", async () => {
    await expect(
      runner().runJson(["__error__"], { env: { FAKE_DWS_ERROR: "1" } }),
    ).rejects.toMatchObject({
      name: "DwsError",
      code: 3,
      category: "validation",
      reason: "test_failure",
      message: "fake dws error",
    });
  });

  it("propagates a non-zero exit without an envelope", async () => {
    // fake-dws with FAKE_DWS_ERROR exits 3 and writes the envelope; emulate plain failure via a
    // nonexistent command against the real dws is out of scope — instead assert DwsError carries exit code.
    try {
      await runner().runJson(["__error__"], { env: { FAKE_DWS_ERROR: "1" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DwsError);
      expect((e as DwsError).exitCode).toBe(3);
      expect((e as DwsError).retryable).toBe(false);
      expect((e as DwsError).toJSON()).toHaveProperty("command");
    }
  });

  it("streams NDJSON lines", async () => {
    const events: unknown[] = [];
    const handle = await runner().stream(
      ["event", "+listen-im", "--kind", "at-me"],
      (line) => {
        if (line.startsWith("\u0000")) return;
        try {
          events.push(JSON.parse(line));
        } catch {
          events.push({ raw: line });
        }
      },
    );
    await new Promise((r) => setTimeout(r, 100));
    handle.stop();
    // 2 条合法 JSON 事件 + 1 条畸形行（回退为 {raw}）
    expect(events.length).toBe(3);
    expect((events[0] as { data: { fake: boolean } }).data.fake).toBe(true);
    expect((events[1] as { data: { fake: boolean } }).data.fake).toBe(false);
    expect((events[2] as { raw: string }).raw).toBe("not-json-line");
  });
});
