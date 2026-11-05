import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CliRunner } from "../cli/runner.js";
import { getProvider, listProviders } from "../providers/registry.js";
import type { ImProviderSpec } from "../providers/types.js";

export interface ResourceOptions {
  /** provider id → CLI 入口路径（测试/覆盖/用户配置用）。 */
  binOverrides?: Record<string, string>;
}

/** 一次资源读取的结果。 */
export interface ResourceEntry {
  uri: string;
  mimeType: string;
  text: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; text: string }>();

/** 读一次资源并缓存（避免每次资源读取都跑一次 CLI）。 */
async function cached(key: string, produce: () => Promise<string>): Promise<string> {
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
  const text = await produce();
  cache.set(key, { at: Date.now(), text });
  return text;
}

/** 资源读取失败时返回可读诊断，而不是让客户端收到协议级内部错误。 */
async function diagnostic(produce: () => Promise<string>): Promise<string> {
  try {
    return await produce();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: { message } }, null, 2);
  }
}

function requireProvider(id: string): ImProviderSpec {
  const spec = getProvider(id);
  if (spec === undefined) throw new Error(`provider ${id} is not registered`);
  return spec;
}

/** 平台目录：静态内容，不调用 CLI。 */
export function resourceProvidersText(): string {
  return JSON.stringify(
    {
      providers: listProviders().map((p) => ({
        id: p.id,
        displayName: p.displayName,
        bin: p.bin,
        bundled: p.bundledCliDir !== undefined,
        examples: p.examples,
      })),
    },
    null,
    2,
  );
}

/** 从 dws --help 中解析服务域（● / • 开头的两列行）。 */
export function parseServiceDomains(help: string): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = [];
  const seen = new Set<string>();
  for (const line of help.split(/\r?\n/)) {
    const match = /^\s*[●•]\s+([A-Za-z][A-Za-z0-9_-]*)\s{2,}(.+?)\s*$/.exec(line);
    if (match === null) continue;
    const [, name, description] = match;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description });
  }
  return out;
}

/** 企业微信最近会话（机器人视角）。 */
export interface WecomSession {
  chatId: string;
  name: string;
  type: string;
  lastMessageAt: string;
}

function normalizeSessions(data: unknown): WecomSession[] {
  const sessions = (data as { sessions?: unknown })?.sessions;
  if (!Array.isArray(sessions)) return [];
  const out: WecomSession[] = [];
  for (const item of sessions) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    out.push({
      chatId: typeof record.chat_id === "string" ? record.chat_id : "",
      name: typeof record.chat_name === "string" ? record.chat_name : "",
      type: typeof record.chat_type === "string" ? record.chat_type : "",
      lastMessageAt: typeof record.last_msg_time === "string" ? record.last_msg_time : "",
    });
  }
  return out;
}

/** 钉钉日志模板（名称 + 模板 ID）。 */
function normalizeTemplates(data: unknown): { name: string; templateId: string }[] {
  const items = (data as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: { name: string; templateId: string }[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = record.report_template_name;
    const templateId = record.report_template_id;
    if (typeof name !== "string" || typeof templateId !== "string") continue;
    out.push({ name, templateId });
  }
  return out;
}

export function resourceDingtalkServicesText(bin?: string): Promise<string> {
  return diagnostic(() =>
    cached("dingtalk-services", async () => {
      const runner = new CliRunner(requireProvider("dingtalk"));
      const exec = await runner.runRaw(["--help"], { bin });
      return JSON.stringify({ services: parseServiceDomains(`${exec.stdout}\n${exec.stderr}`) }, null, 2);
    }),
  );
}

export function resourceWecomSessionsText(bin?: string): Promise<string> {
  return diagnostic(() =>
    cached("wecom-sessions", async () => {
      const runner = new CliRunner(requireProvider("wecom"));
      const data = await runner.runJson(["message", "aibot", "sessions", "list"], { bin });
      return JSON.stringify({ sessions: normalizeSessions(data) }, null, 2);
    }),
  );
}

export function resourceDingtalkTemplatesText(bin?: string): Promise<string> {
  return diagnostic(() =>
    cached("dingtalk-templates", async () => {
      const runner = new CliRunner(requireProvider("dingtalk"));
      const data = await runner.runJson(["report", "template", "list"], { bin });
      return JSON.stringify({ templates: normalizeTemplates(data) }, null, 2);
    }),
  );
}

export function resourceGroupMessagesText(group: string, limit: number, bin?: string): Promise<string> {
  return diagnostic(async () => {
    const trimmed = group.trim();
    if (trimmed === "") throw new Error("resource URI is missing the {group} variable");
    const runner = new CliRunner(requireProvider("dingtalk"));
    const data = await runner.runJson(["chat", "+chat-messages", "--group", trimmed, "--limit", String(limit)], { bin });
    return JSON.stringify(data, null, 2);
  });
}

const GROUP_MESSAGES = /^im:\/\/dingtalk\/group\/(.+?)\/messages(?:\?(.*))?$/u;

/** 按 URI 读取任意已发布资源（MCP 资源工具与设置页共用）。 */
export async function readResourceText(uri: string, options: ResourceOptions = {}): Promise<ResourceEntry | undefined> {
  const json: Omit<ResourceEntry, "text"> = { uri, mimeType: "application/json" };
  if (uri === "im://providers") {
    return { ...json, text: resourceProvidersText() };
  }
  if (uri === "im://dingtalk/services") {
    return { ...json, text: await resourceDingtalkServicesText(options.binOverrides?.dingtalk) };
  }
  if (uri === "im://wecom/sessions") {
    return { ...json, text: await resourceWecomSessionsText(options.binOverrides?.wecom) };
  }
  if (uri === "im://dingtalk/templates") {
    return { ...json, text: await resourceDingtalkTemplatesText(options.binOverrides?.dingtalk) };
  }
  const match = GROUP_MESSAGES.exec(uri);
  if (match !== null) {
    const group = decodeURIComponent(match[1] ?? "");
    const query = match[2] ?? "";
    const limit = (() => {
      const raw = new URLSearchParams(query).get("limit") ?? "";
      return /^\d+$/.test(raw) ? Math.min(Math.max(Number(raw), 1), 50) : 20;
    })();
    return { ...json, text: await resourceGroupMessagesText(group, limit, options.binOverrides?.dingtalk) };
  }
  return undefined;
}

/** 注册全部只读资源（静态 + 模板）。 */
export function registerResources(server: McpServer, options: ResourceOptions = {}): void {
  const binOf = (id: string): string | undefined => options.binOverrides?.[id];

  server.registerResource(
    "providers",
    "im://providers",
    {
      title: "IM providers",
      description: "已接入的 IM 平台、对应 CLI、是否随包携带二进制，以及示例命令",
      mimeType: "application/json",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: resourceProvidersText() }] }),
  );

  server.registerResource(
    "dingtalk-services",
    "im://dingtalk/services",
    {
      title: "DingTalk CLI services",
      description: "dws 顶层服务域与说明（从 `dws --help` 解析，缓存 5 分钟）",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: await resourceDingtalkServicesText(binOf("dingtalk")) }],
    }),
  );

  server.registerResource(
    "wecom-sessions",
    "im://wecom/sessions",
    {
      title: "WeCom recent sessions",
      description: "机器人最近的会话列表（按最后一条消息时间倒序）",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: await resourceWecomSessionsText(binOf("wecom")) }],
    }),
  );

  server.registerResource(
    "dingtalk-templates",
    "im://dingtalk/templates",
    {
      title: "DingTalk log templates",
      description: "钉钉日志（日报/周报等）模板名称与模板 ID",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: await resourceDingtalkTemplatesText(binOf("dingtalk")) }],
    }),
  );

  server.registerResource(
    "dingtalk-group-messages",
    new ResourceTemplate("im://dingtalk/group/{group}/messages{?limit}", { list: undefined }),
    {
      title: "DingTalk group messages",
      description: "读取指定群聊的最近消息；group 支持群名或 openConversationId，limit 默认 20",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const group = String(variables.group ?? "");
      const rawLimit = String(variables.limit ?? "").trim();
      const limit = /^\d+$/.test(rawLimit) ? Math.min(Math.max(Number(rawLimit), 1), 50) : 20;
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: await resourceGroupMessagesText(group, limit, binOf("dingtalk")) }],
      };
    },
  );
}
