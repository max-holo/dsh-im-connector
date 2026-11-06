#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getProvider, listProviders } from "../providers/registry.js";
import type { ImProviderSpec } from "../providers/types.js";
import { CliRunner } from "../cli/runner.js";
import { isCliError } from "../cli/errors.js";
import { collectProviderInfo, type ProviderInfo } from "../control/providers.js";
import { configBinOverrides } from "../config/store.js";
import { loginStatus, startLogin } from "../login/session.js";
import { buildInstructions } from "./instructions.js";
import { registerResources } from "./resources.js";

const providerIds = listProviders().map((p) => p.id) as [string, ...string[]];

/** 工具入参：provider 枚举由注册表生成。 */
const providerArg = z
  .enum(providerIds)
  .describe(`IM 平台标识：${listProviders().map((p) => `${p.id}=${p.displayName}`).join("，")}`);

/** 统一的错误结构（所有工具输出 schema 共用）。 */
const errorOutput = z
  .object({
    message: z.string(),
    code: z.string().optional().describe("CLI 错误码（如有）"),
    hint: z.string().optional().describe("CLI 给出的修复建议"),
  })
  .optional();

function requireProvider(id: string | undefined): ImProviderSpec | undefined {
  return id === undefined ? undefined : getProvider(id);
}

function unknownPlatform(provider: string | undefined): CallToolResult {
  const available = listProviders().map((p) => p.id).join("，");
  return {
    content: [{ type: "text", text: `未知平台 "${provider ?? ""}"。可用：${available}` }],
    isError: true,
    structuredContent: { ok: false, provider: String(provider ?? ""), error: { message: `unknown provider; available: ${available}` } },
  };
}

/** 工具失败统一转换：保留 CLI 错误信封的 code/hint。 */
function failed(spec: ImProviderSpec, action: string, e: unknown): CallToolResult {
  if (isCliError(e)) {
    const hint = e.hint;
    const code = e.code === undefined ? undefined : String(e.code);
    const text = `${spec.displayName} ${action} failed: ${JSON.stringify(e.toJSON())}`;
    return {
      content: [{ type: "text", text }],
      isError: true,
      structuredContent: { ok: false, provider: spec.id, error: { message: e.message, code, hint } },
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text", text: `${spec.displayName} ${action} failed: ${message}` }],
    isError: true,
    structuredContent: { ok: false, provider: spec.id, error: { message } },
  };
}

function textResult(content: CallToolResult["content"], structuredContent: Record<string, unknown>): CallToolResult {
  return { content, structuredContent };
}

/** 构建统一 IM 透传 MCP server（McpServer 高层 API）。 */
export interface McpServerOptions {
  name?: string;
  version?: string;
  /** 测试/覆盖用：provider id → CLI 入口路径。 */
  binOverrides?: Record<string, string>;
}

export function buildMcpServer(options: McpServerOptions = {}): McpServer {
  const binOf = (id: string): string | undefined => options.binOverrides?.[id];
  const server = new McpServer(
    { name: options.name ?? "im", version: options.version ?? "0.1.0" },
    { instructions: buildInstructions() },
  );

  registerResources(server, { binOverrides: options.binOverrides });

  server.registerTool(
    "run",
    {
      title: "Run IM CLI command",
      description:
        "统一 IM 透传：执行指定平台的 CLI 命令并返回其 JSON 输出。args 是原生命令参数（不是自然语言）。" +
        "写操作需用户明确意图：可先用 --dry-run 预览，确认后钉钉加 --yes。" +
        "发现能力见资源 im://providers、im://dingtalk/services、im://wecom/sessions、im://dingtalk/templates。",
      inputSchema: {
        provider: providerArg,
        args: z.array(z.string()).min(1).describe("对应平台 CLI 的命令及参数（字符串数组）"),
      },
      outputSchema: {
        ok: z.boolean(),
        provider: z.string(),
        command: z.string().optional().describe("实际执行的命令（人类可读）"),
        data: z.unknown().optional().describe("CLI 的 JSON 输出（非 JSON 时为原始文本）"),
        error: errorOutput,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ provider, args }) => {
      const spec = requireProvider(provider);
      if (spec === undefined) return unknownPlatform(provider);
      try {
        const runner = new CliRunner(spec);
        const data = await runner.runJson(args, { bin: binOf(spec.id) });
        return textResult([
          { type: "text", text: JSON.stringify(data, null, 2) },
        ], { ok: true, provider: spec.id, data });
      } catch (e) {
        return failed(spec, "run", e);
      }
    },
  );

  server.registerTool(
    "info",
    {
      title: "Environment self-check",
      description:
        "环境自检：返回各平台 CLI 版本、登录状态、是否随包携带二进制与实际可执行入口。首次使用或命令异常时先调用。",
      inputSchema: {},
      outputSchema: {
        ok: z.boolean(),
        providers: z.array(
          z.object({
            id: z.string(),
            displayName: z.string(),
            bin: z.string(),
            bundled: z.boolean(),
            resolved: z.string().optional(),
            version: z.string().optional(),
            auth: z.unknown().optional(),
            authError: z.string().optional(),
          }),
        ),
        error: errorOutput,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const providers = await Promise.all(
          listProviders().map((spec) => collectProviderInfo(spec, binOf(spec.id))),
        );
        return textResult([
          { type: "text", text: JSON.stringify({ providers }, null, 2) },
        ], { ok: true, providers });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `info failed: ${message}` }],
          isError: true,
          structuredContent: { ok: false, providers: [], error: { message } },
        };
      }
    },
  );

  server.registerTool(
    "login",
    {
      title: "Start platform login",
      description:
        "发起平台登录（无需终端）：企业微信返回可直接渲染的扫码二维码（图片内容 + 绝对路径 markdown，贴进回复即可内联显示）；" +
        "钉钉拉起浏览器授权，无头/远程环境用 mode=device 走设备码。完成后调用 login_status 确认。",
      inputSchema: {
        provider: providerArg,
        mode: z
          .enum(["browser", "device"])
          .optional()
          .describe("钉钉登录方式：browser=本机浏览器授权（默认），device=设备码；企业微信固定扫码"),
      },
      outputSchema: {
        ok: z.boolean(),
        provider: z.string(),
        displayName: z.string().optional(),
        running: z.boolean().optional(),
        exitCode: z.number().optional(),
        qrPath: z.string().optional().describe("二维码 PNG 的本地绝对路径"),
        markdown: z.string().optional().describe("可直接贴进回复的 Markdown 图片语法"),
        outputTail: z.string().optional().describe("登录进程最近输出"),
        hint: z.string().optional(),
        error: errorOutput,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ provider, mode }) => {
      const spec = requireProvider(provider);
      if (spec === undefined) return unknownPlatform(provider);
      try {
        const runner = new CliRunner(spec);
        const login = await startLogin(spec, runner, {
          bin: binOf(spec.id),
          mode: mode === "device" ? "device" : "browser",
        });
        const content: CallToolResult["content"] = [];
        if (login.qrDataUrl?.startsWith("data:image/png;base64,")) {
          content.push({
            type: "image",
            data: login.qrDataUrl.slice("data:image/png;base64,".length),
            mimeType: "image/png",
          });
        }
        const markdown =
          login.qrPath === undefined
            ? undefined
            : `![${login.displayName}登录二维码](${login.qrPath.replace(/\\/g, "/")})`;
        const hint =
          login.qrDataUrl !== undefined
            ? "请用手机扫描二维码完成授权，然后调用 login_status 确认。"
            : spec.qrOutputFlag !== undefined
              ? "正在生成二维码，请稍候…"
              : "请在浏览器完成授权（钉钉默认自动打开浏览器）；完成后调用 login_status 确认。";
        content.push({
          type: "text",
          text: JSON.stringify(
            {
              provider: login.provider,
              displayName: login.displayName,
              running: login.running,
              exitCode: login.exitCode,
              qrPath: login.qrPath,
              markdown,
              outputTail: login.output.slice(-800),
              hint,
            },
            null,
            2,
          ),
        });
        return textResult(content, {
          ok: true,
          provider: login.provider,
          displayName: login.displayName,
          running: login.running,
          ...(login.exitCode === null ? {} : { exitCode: login.exitCode }),
          ...(login.qrPath === undefined ? {} : { qrPath: login.qrPath }),
          ...(markdown === undefined ? {} : { markdown }),
          outputTail: login.output.slice(-800),
          hint,
        });
      } catch (e) {
        return failed(spec, "login", e);
      }
    },
  );

  server.registerTool(
    "login_status",
    {
      title: "Check login status",
      description: "查询登录状态：是否已授权、登录进程是否仍在运行、二维码（若可用）、最近输出与退出码。",
      inputSchema: { provider: providerArg },
      outputSchema: {
        ok: z.boolean(),
        provider: z.string(),
        authorized: z.boolean(),
        running: z.boolean(),
        exitCode: z.number().optional(),
        auth: z.unknown().optional().describe("auth 查询的原始结果"),
        authError: z.string().optional(),
        qrDataUrl: z.string().optional(),
        output: z.string().optional().describe("登录进程最近输出"),
        hint: z.string(),
        error: errorOutput,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ provider }) => {
      const spec = requireProvider(provider);
      if (spec === undefined) return unknownPlatform(provider);
      try {
        const runner = new CliRunner(spec);
        const status = await loginStatus(spec, runner, { bin: binOf(spec.id) });
        // 会话感知的授权判定：登录进程退出码优先（旧凭据仍有效时 auth 查询会立刻
        // 返回 authorized，不能当作「本次扫码成功」的证据）。
        const succeeded = status.exitCode === 0;
        const failed = status.exitCode !== null && status.exitCode !== 0;
        const authorized = failed ? false : succeeded ? true : status.authorized;
        const hint = status.running
          ? "登录会话进行中：请扫码/完成浏览器授权后再次查询。"
          : authorized
            ? "已登录，可以直接使用 run 工具。"
            : status.exitCode === null
              ? "尚未发起登录；请调用 login 获取二维码/打开授权页。"
              : `登录流程已结束（exitCode=${status.exitCode}），未成功；请重新调用 login。`;
        return textResult([
          { type: "text", text: JSON.stringify({ ...status, authorized, hint }, null, 2) },
        ], {
          ok: true,
          provider: status.provider,
          authorized,
          running: status.running,
          ...(status.exitCode === null ? {} : { exitCode: status.exitCode }),
          ...(status.auth === undefined ? {} : { auth: status.auth }),
          ...(status.authError === undefined ? {} : { authError: status.authError }),
          ...(status.qrDataUrl === undefined ? {} : { qrDataUrl: status.qrDataUrl }),
          output: status.output,
          hint,
        });
      } catch (e) {
        return failed(spec, "login_status", e);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = buildMcpServer({ binOverrides: configBinOverrides() });
  await server.connect(new StdioServerTransport());
}

/**
 * 是否由 node 直接执行本文件。
 * 链接安装（link:/符号链接）时 `import.meta.url` 是真实路径而 argv[1] 是链接路径，
 * 直接字符串比较会误判并让服务器静默退出，因此比较 realpath。
 */
function isMainEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    try {
      return pathToFileURL(entry).href === import.meta.url;
    } catch {
      return false;
    }
  }
}

if (isMainEntry()) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
