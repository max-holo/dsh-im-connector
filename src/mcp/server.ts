#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { getProvider, listProviders } from "../providers/registry.js";
import { CliRunner } from "../cli/runner.js";
import { isCliError } from "../cli/errors.js";
import { loginStatus, startLogin } from "../login/session.js";

function buildRunTool(): Tool {
  const providers = listProviders();
  const lines = providers
    .map((p) => {
      const ex = p.examples.map((e) => `    ${e}`).join("\n");
      return `- ${p.id}（${p.displayName}，\`${p.bin}\`）:\n${ex}`;
    })
    .join("\n");
  return {
    name: "run",
    description:
      `统一 IM 透传：执行指定平台的 CLI 命令并返回其 JSON 输出。已接入平台：\n${lines}\n\n` +
      `provider 选平台，args 是该平台 CLI 的命令字符串数组。写操作（发消息/提交/审批等）需用户明确意图，必要时加 --yes（钉钉）或先用 --dry-run 预览。`,
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: providers.map((p) => p.id),
          description: `IM 平台标识：${providers.map((p) => `${p.id}=${p.displayName}`).join("，")}`,
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "对应平台 CLI 的命令及参数（字符串数组）。",
        },
      },
      required: ["provider", "args"],
    },
  };
}

function buildInfoTool(): Tool {
  return {
    name: "info",
    description:
      "查看已接入平台的 CLI 版本、登录状态与实际可执行入口（环境自检 / 排障用）。返回每个 provider 的 id、displayName、版本、登录状态与解析到的 CLI 路径。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  };
}

interface ProviderInfo {
  id: string;
  displayName: string;
  bin: string;
  resolved?: string;
  version?: string;
  auth?: unknown;
  authError?: string;
}

async function collectProviderInfo(
  spec: ReturnType<typeof listProviders>[number],
  binOverride?: string,
): Promise<ProviderInfo> {
  const runner = new CliRunner(spec);
  const info: ProviderInfo = { id: spec.id, displayName: spec.displayName, bin: spec.bin };

  try {
    info.resolved = await runner.resolveScript(binOverride);
  } catch {
    /* ignore */
  }

  // 版本：优先 CLI --version，回退读包内 package.json
  try {
    const exec = await runner.runRaw(spec.versionArgs ?? ["--version"], { bin: binOverride });
    const firstLine = exec.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (firstLine) info.version = firstLine;
  } catch {
    /* ignore */
  }
  if (!info.version) {
    try {
      const require = createRequire(import.meta.url);
      const pkgJson = require.resolve(`${spec.npmPackage}/package.json`);
      const manifest = JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: string };
      if (manifest.version) info.version = manifest.version;
    } catch {
      /* ignore */
    }
  }

  // 登录状态：走 provider 的 authArgs（JSON 输出）
  if (spec.authArgs) {
    try {
      info.auth = await runner.runJson(spec.authArgs, { bin: binOverride });
    } catch (e) {
      info.authError = isCliError(e) ? e.message : e instanceof Error ? e.message : String(e);
    }
  }
  return info;
}

function buildLoginTool(): Tool {
  const providers = listProviders();
  return {
    name: "login",
    description:
      "发起平台登录（无需终端）：企业微信会返回可直接渲染的扫码二维码图片；钉钉会拉起浏览器授权（或 mode=device 走设备码流程）。" +
      "返回结果里的 markdown 字段是绝对路径图片语法，直接贴进回复即可在聊天里内联显示二维码。" +
      `完成后调用 login_status 确认。平台：${providers.map((p) => `${p.id}=${p.displayName}`).join("，")}。`,
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: providers.map((p) => p.id),
          description: "要登录的平台。",
        },
        mode: {
          type: "string",
          enum: ["browser", "device"],
          description: "钉钉登录方式：browser=本机浏览器授权（默认），device=设备码（无头/远程环境）。企业微信固定扫码。",
        },
      },
      required: ["provider"],
    },
  };
}

function buildLoginStatusTool(): Tool {
  return {
    name: "login_status",
    description: "查询登录状态：是否已授权、登录进程是否仍在运行、二维码（若可用）与最近输出。",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: listProviders().map((p) => p.id),
          description: "要查询的平台。",
        },
      },
      required: ["provider"],
    },
  };
}

/**
 * 构建统一 IM 透传 MCP server：暴露
 * - `run { provider, args }`：业务透传；
 * - `info`：版本/登录自检；
 * - `login { provider }`：发起扫码/浏览器登录（返回二维码图片）；
 * - `login_status { provider }`：查询登录状态。
 * 按 provider 注册表路由到底层 CLI；新增平台只需在 registry 追加 spec。
 */
export interface McpServerOptions {
  name?: string;
  version?: string;
  /** 测试/覆盖用：provider id → CLI 入口路径。 */
  binOverrides?: Record<string, string>;
}

export function buildMcpServer(options: McpServerOptions = {}): Server {
  const server = new Server(
    { name: options.name ?? "im", version: options.version ?? "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const runTool = buildRunTool();
  const infoTool = buildInfoTool();
  const loginTool = buildLoginTool();
  const loginStatusTool = buildLoginStatusTool();

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: [runTool, infoTool, loginTool, loginStatusTool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name === "login" || request.params.name === "login_status") {
      const { provider, mode } = (request.params.arguments ?? {}) as { provider?: string; mode?: string };
      const spec = getProvider(provider as string);
      if (!spec) {
        return {
          content: [
            {
              type: "text",
              text: `未知平台 "${provider}"。可用：${listProviders().map((p) => p.id).join("，")}`,
            },
          ],
          isError: true,
        };
      }
      const runner = new CliRunner(spec);
      const bin = options.binOverrides?.[spec.id];
      try {
        if (request.params.name === "login_status") {
          const status = await loginStatus(spec, runner, { bin });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...status,
                    hint: status.authorized
                      ? "已登录，可以直接使用 run 工具。"
                      : status.running
                        ? "登录会话进行中：请扫码/完成浏览器授权后再次查询。"
                        : status.exitCode === 0
                          ? "授权流程已完成（exitCode=0），但 auth 查询仍未通过；请检查 CLI 登录态或重新 login。"
                          : status.exitCode === null
                            ? "尚未发起登录；请调用 login 获取二维码/打开授权页。"
                            : `登录流程已结束（exitCode=${status.exitCode}），未成功；请重新调用 login。`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        const login = await startLogin(spec, runner, {
          bin,
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
        content.push({
          type: "text",
          text: JSON.stringify(
            {
              provider: login.provider,
              displayName: login.displayName,
              running: login.running,
              exitCode: login.exitCode,
              qrPath: login.qrPath,
              // 可直接粘贴到回复里的 Markdown 图片（DSH 聊天会把本地绝对路径渲染为内联图片）
              markdown: login.qrPath ? `![${login.displayName}登录二维码](${login.qrPath.replace(/\\/g, "/")})` : undefined,
              outputTail: login.output.slice(-800),
              hint: login.qrDataUrl
                ? "请用手机扫描二维码完成授权，然后调用 login_status 确认。"
                : "请在浏览器完成授权（钉钉默认自动打开浏览器）；完成后调用 login_status 确认。",
            },
            null,
            2,
          ),
        });
        return { content };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `${spec.displayName} ${request.params.name} failed: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (request.params.name === "info") {
      try {
        const providers = [];
        for (const spec of listProviders()) {
          providers.push(await collectProviderInfo(spec, options.binOverrides?.[spec.id]));
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ providers }, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `info failed: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
    if (request.params.name !== "run") {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}. Available: "run", "info".` }],
        isError: true,
      };
    }
    const { provider, args } = request.params.arguments ?? {};
    const spec = getProvider(provider as string);
    if (!spec) {
      return {
        content: [
          {
            type: "text",
            text: `未知平台 "${provider}"。可用：${listProviders().map((p) => p.id).join("，")}`,
          },
        ],
        isError: true,
      };
    }
    if (!Array.isArray(args) || args.length === 0 || !args.every((a) => typeof a === "string")) {
      return {
        content: [
          {
            type: "text",
            text: '参数 args 必须是非空字符串数组，例如 {"provider":"dingtalk","args":["contact","+me"]}',
          },
        ],
        isError: true,
      };
    }
    try {
      const runner = new CliRunner(spec);
      const result = await runner.runJson(args as string[], {
        bin: options.binOverrides?.[spec.id],
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = isCliError(e)
        ? JSON.stringify(e.toJSON())
        : e instanceof Error
          ? e.message
          : String(e);
      return {
        content: [{ type: "text", text: `${spec.displayName} run failed: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

async function main(): Promise<void> {
  const server = buildMcpServer();
  await server.connect(new StdioServerTransport());
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
