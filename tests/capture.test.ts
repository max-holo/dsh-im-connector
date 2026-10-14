import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appendCapturedMessage,
  filterCapturedMessages,
  normalizeRobotMessage,
  readCapturedMessages,
  validateToolArgs,
  toolList,
} from "../src/index.js";

describe("capture store", () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "dtconn-capture-"));
    file = join(dir, "capture.jsonl");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends and reads back messages", async () => {
    appendCapturedMessage(file, {
      capturedAt: "2026-10-14T01:00:00.000Z",
      conversationId: "cid1",
      conversationType: "2",
      senderStaffId: "u1",
      content: "hello",
    });
    appendCapturedMessage(file, {
      capturedAt: "2026-10-14T02:00:00.000Z",
      conversationId: "cid2",
      conversationType: "1",
      senderStaffId: "u2",
      content: "world",
    });
    await new Promise((r) => setTimeout(r, 50)); // appendFile is async
    const raw = readFileSync(file, "utf8");
    expect(raw.split("\n").filter(Boolean).length).toBe(2);
    const messages = readCapturedMessages(file);
    expect(messages.length).toBe(2);
  });

  it("reads an empty/missing store without error", () => {
    expect(readCapturedMessages(join(dir, "missing.jsonl"))).toEqual([]);
  });

  it("filters by conversation/sender/keyword/time/limit", () => {
    const messages = readCapturedMessages(file);
    expect(filterCapturedMessages(messages, { conversationType: "1" }).length).toBe(1);
    expect(filterCapturedMessages(messages, { keyword: "HELL" }).length).toBe(1); // case-insensitive
    expect(filterCapturedMessages(messages, { senderStaffId: "u3" }).length).toBe(0);
    expect(
      filterCapturedMessages(messages, { from: "2026-10-14T01:30:00.000Z" }).length,
    ).toBe(1);
    expect(filterCapturedMessages(messages, { limit: 1 }).length).toBe(1);
  });
});

describe("normalizeRobotMessage", () => {
  it("extracts text content and sender info from a Stream frame", () => {
    const frame = {
      headers: { topic: "/v1.0/im/bot/messages/get", messageId: "m1", contentType: "application/json" },
      data: JSON.stringify({
        msgId: "msg-1",
        conversationId: "cid-9",
        conversationType: "2",
        senderStaffId: "u1",
        senderNick: "张三",
        msgtype: "text",
        text: { content: " 帮我查下日程 " },
        createAt: 1760000000000,
      }),
    };
    const message = normalizeRobotMessage(frame);
    expect(message.topic).toBe("/v1.0/im/bot/messages/get");
    expect(message.msgId).toBe("msg-1");
    expect(message.conversationType).toBe("2");
    expect(message.senderNick).toBe("张三");
    expect(message.content).toBe(" 帮我查下日程 ");
    expect((message.raw as { msgtype: string }).msgtype).toBe("text");
  });

  it("survives malformed payloads", () => {
    const message = normalizeRobotMessage({ headers: {}, data: "not json" });
    expect(message.content).toBeNull();
    expect((message.raw as { rawText: string }).rawText).toBe("not json");
  });
});

describe("tool argument validation", () => {
  it("reports missing required params and type mismatches", () => {
    const tool = toolList.find((t) => t.name === "calendar_list_events")!;
    expect(validateToolArgs(tool, {})).toContainEqual(expect.stringContaining("unionId"));
    expect(
      validateToolArgs(tool, {
        unionId: "u",
        timeMin: "2026-10-01",
        timeMax: "2026-10-08",
        maxItems: "200", // wrong type: string instead of number
      }),
    ).toEqual([expect.stringContaining("maxItems")]);
    expect(
      validateToolArgs(tool, {
        unionId: "u",
        timeMin: "2026-10-01",
        timeMax: "2026-10-08",
      }),
    ).toEqual([]);
  });

  it("validates enum values and array item types", () => {
    const todoTool = toolList.find((t) => t.name === "todo_list_tasks")!;
    const errors = validateToolArgs(todoTool, {
      unionId: "u",
      roleTypes: ["executor", "boss"],
      isDone: "yes",
    });
    expect(errors.some((e) => e.includes("roleTypes"))).toBe(true);
    expect(errors.some((e) => e.includes("isDone"))).toBe(true);
  });
});
