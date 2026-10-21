// src/plugin/engine.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";

// src/providers/dingtalk.ts
var dingtalk = {
  id: "dingtalk",
  displayName: "\u9489\u9489",
  bin: "dws",
  npmPackage: "dingtalk-workspace-cli",
  binScript: "dingtalk-workspace-cli/bin/dws.js",
  formatArgs: ["--format", "json"],
  envBin: "DINGTALK_DWS_BIN",
  examples: [
    '["contact","+me"]',
    '["contact","+search-user","--query","\u5F20\u4E09"]',
    '["calendar","+today"]',
    '["todo","+get-my-tasks"]',
    '["oa","approval","list-pending"] / ["oa","approval","detail","--instance-id","<id>"]',
    '["attendance","+check-result","--users","u1,u2","--start","2026-10-01","--end","2026-10-10"]',
    '["report","inbox","list"] / ["report","entry","get","--report-id","<id>"]',
    '["doc","read","--node","<docId|url>"] / ["wiki","+space-list"]',
    '["chat","+chat-messages","--group","<\u7FA4\u540D|id>","--limit","20"] / ["chat","+search-msg","--query","<kw>"]',
    '\u5199\uFF1A["chat","+messages-send","--group","<cid>","--markdown","\u5185\u5BB9","--title","\u6807\u9898","--yes"]'
  ]
};

// src/cli/runner.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// src/cli/errors.ts
var CliError = class extends Error {
  code;
  category;
  reason;
  retryable;
  hint;
  actions;
  command;
  stderr;
  exitCode;
  constructor(init) {
    super(init.message);
    this.name = "CliError";
    this.code = init.code;
    this.category = init.category;
    this.reason = init.reason;
    this.retryable = init.retryable;
    this.hint = init.hint;
    this.actions = init.actions;
    this.command = init.command;
    this.stderr = init.stderr ?? "";
    this.exitCode = init.exitCode ?? null;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      command: this.command,
      code: this.code,
      category: this.category,
      reason: this.reason,
      retryable: this.retryable,
      hint: this.hint,
      actions: this.actions,
      exitCode: this.exitCode
    };
  }
};
function parseErrorEnvelope(stderr) {
  const text = stderr.trim();
  if (!text) return void 0;
  const direct = tryParse(text);
  if (direct?.error) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed?.error) return parsed;
  }
  for (const line of text.split(/\r?\n/)) {
    const parsed = tryParse(line.trim());
    if (parsed?.error) return parsed;
  }
  return void 0;
}
function tryParse(text) {
  if (!text) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}

// src/cli/runner.ts
var CliRunner = class {
  constructor(spec, opts) {
    this.spec = spec;
    this.opts = opts;
  }
  spec;
  opts;
  get providerId() {
    return this.spec.id;
  }
  /** 运行并返回解析后的 stdout JSON；失败抛 CliError。 */
  async runJson(args, opts) {
    const exec = await this.run(args, opts);
    return exec.data;
  }
  async run(args, opts) {
    const spec = await this.launch(opts?.bin);
    const finalArgs = [...spec.prefix, ...args, ...this.spec.formatArgs];
    const command = `${this.spec.bin} ${args.join(" ")}`;
    return new Promise((resolve, reject) => {
      const child = spawn(spec.command, finalArgs, {
        shell: spec.shell,
        cwd: opts?.cwd,
        env: { ...process.env, ...opts?.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString("utf8");
      });
      const onAbort = () => {
        try {
          child.kill("SIGTERM");
        } catch {
        }
      };
      if (opts?.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      child.on("error", (e) => {
        reject(
          new CliError({
            message: `Failed to launch ${this.spec.bin} (${spec.command}): ${e.message}`,
            command,
            retryable: true
          })
        );
      });
      child.on("exit", (code) => {
        opts?.signal?.removeEventListener("abort", onAbort);
        const parsed = parseStdoutJson(stdout);
        if (code !== 0) {
          const envelope = parseErrorEnvelope(stderr);
          reject(
            new CliError({
              message: envelope?.error?.message ?? stderr.trim() ?? `${this.spec.bin} exited with code ${code}`,
              command,
              stderr,
              exitCode: code,
              code: envelope?.error?.code,
              category: envelope?.error?.category,
              reason: envelope?.error?.reason,
              retryable: envelope?.error?.retryable,
              hint: envelope?.error?.hint,
              actions: envelope?.error?.actions
            })
          );
          return;
        }
        resolve({ command, args: finalArgs, stdout, stderr, exitCode: code, data: parsed });
      });
    });
  }
  /**
   * 以 NDJSON 流式执行（长连接监听用）。逐行把 stdout 内容交给 onLine；
   * 返回 { stop() } 优雅停止（SIGTERM + 关闭 stdin）。
   * 不追加任何 format 参数，调用方自行传入（如 dws 的 --format ndjson）。
   */
  async stream(args, onLine, opts) {
    const spec = await this.launch(opts?.bin);
    const child = spawn(spec.command, [...spec.prefix, ...args], {
      shell: spec.shell,
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let buffer = "";
    let stderrBuf = "";
    child.stdout.on("data", (d) => {
      buffer += d.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line.trim()) onLine(line);
      }
    });
    child.stderr.on("data", (d) => {
      stderrBuf += d.toString("utf8");
    });
    child.on("exit", (code) => {
      if (code !== 0 && code !== null && stderrBuf.trim()) {
        onLine(`\0stderr:${stderrBuf.trim()}`);
      }
    });
    if (opts?.signal) {
      opts.signal.addEventListener(
        "abort",
        () => {
          try {
            child.kill("SIGTERM");
          } catch {
          }
        },
        { once: true }
      );
    }
    return {
      stop: () => {
        try {
          child.stdin.end();
          child.kill("SIGTERM");
        } catch {
        }
      }
    };
  }
  async launch(binOverride) {
    const env = process.env[this.spec.envBin ?? ""]?.trim();
    const bin = binOverride?.trim() || this.opts?.bin?.trim() || env || this.spec.bin;
    if (bin !== this.spec.bin && /\.(c?js|mjs)$/i.test(bin) && existsSync(bin)) {
      return { command: process.execPath, prefix: [bin], shell: false };
    }
    if (bin !== this.spec.bin && existsSync(bin)) {
      return { command: bin, prefix: [], shell: false };
    }
    if (bin === this.spec.bin) {
      const globalRoot = await npmGlobalRoot();
      if (globalRoot) {
        const script = join(globalRoot, ...this.spec.binScript.split("/"));
        if (existsSync(script)) {
          return { command: process.execPath, prefix: [script], shell: false };
        }
      }
    }
    return { command: bin, prefix: [], shell: process.platform === "win32" };
  }
};
function parseStdoutJson(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
async function npmGlobalRoot() {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run("npm", ["root", "-g"], { timeout: 1e4, windowsHide: true });
    const root = String(stdout).trim();
    return root || null;
  } catch {
    return null;
  }
}

// src/channels/dingtalk.ts
function str(v) {
  return typeof v === "string" && v ? v : void 0;
}
function extractText(data) {
  const text = data.text;
  if (text && typeof text.content === "string" && text.content) return text.content;
  return str(data.content) ?? str(data.text);
}
function normalizeDingTalkEvent(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const envelope = parsed;
  const data = envelope.data ?? envelope;
  const conversationId = str(data.conversationId) ?? str(data.groupId) ?? str(data.openConversationId);
  const text = extractText(data);
  if (!conversationId || !text) return null;
  return {
    conversationId,
    conversationType: data.conversationType === "1" ? "direct" : "group",
    senderId: str(data.senderStaffId) ?? str(data.senderId),
    senderName: str(data.senderNick) ?? str(data.senderName),
    text,
    mentionedBot: typeof data.mentionedBot === "boolean" ? data.mentionedBot : typeof data.isAtBot === "boolean" ? data.isAtBot : void 0,
    raw: data
  };
}
var DingTalkChannel = class {
  providerId = "dingtalk";
  runner;
  constructor(runner) {
    this.runner = runner ?? new CliRunner(dingtalk);
  }
  async sendText(target, text) {
    return this.runner.runJson([
      "chat",
      "+messages-send",
      "--group",
      target.conversationId,
      "--markdown",
      text,
      "--identity",
      "user",
      "--yes"
    ]);
  }
  async listen(onMessage) {
    return this.runner.stream(
      ["event", "+listen-im", "--kind", "all-group", "--format", "ndjson"],
      (line) => {
        if (line.startsWith("\0")) return;
        const message = normalizeDingTalkEvent(line);
        if (message) onMessage(message);
      }
    );
  }
  async status() {
    return this.runner.runJson(["auth", "status"]);
  }
};

// src/providers/wecom.ts
var wecom = {
  id: "wecom",
  displayName: "\u4F01\u4E1A\u5FAE\u4FE1",
  bin: "wecom-cli",
  npmPackage: "@wecom/cli",
  binScript: "@wecom/cli/bin/wecom.js",
  formatArgs: [],
  envBin: "WECOM_CLI_BIN",
  examples: [
    '["contact","users","search","--keywords","\u5F20\u4E09"]',
    '["chat","messages","list","--chat-id","<id>","--begin-time","2026-10-01 00:00:00","--end-time","2026-10-21 00:00:00"]',
    '["auth","show","--status"]',
    '\u901A\u7528\u5F62\u6001\uFF1A["<service>","<resource>","<operation>",...flags]\uFF1B--schema \u67E5\u770B\u65B9\u6CD5 schema\uFF0C--dry-run \u9884\u89C8\u4E0D\u53D1\u9001\u3002'
  ]
};

// src/channels/wecom.ts
var WeComChannel = class {
  providerId = "wecom";
  runner;
  constructor(runner) {
    this.runner = runner ?? new CliRunner(wecom);
  }
  async sendText(target, text) {
    return this.runner.runJson([
      "message",
      "send",
      "--chat-id",
      target.conversationId,
      "--msg-type",
      "text",
      "--text",
      JSON.stringify({ content: text })
    ]);
  }
  /** 分页拉取指定会话的消息（供轮询式监听使用）。时间格式 YYYY-MM-DD HH:MM:SS。 */
  async listMessages(conversationId, beginTime, endTime, opts) {
    return this.runner.runJson([
      "chat",
      "messages",
      "list",
      "--chat-id",
      conversationId,
      "--begin-time",
      beginTime,
      "--end-time",
      endTime,
      ...opts?.cursor ? ["--cursor", opts.cursor] : []
    ]);
  }
  async listen(_onMessage) {
    return { stop: () => void 0 };
  }
  async status() {
    return this.runner.runJson(["auth", "show", "--status"]);
  }
};

// src/channels/registry.ts
function listChannels() {
  return [new DingTalkChannel(), new WeComChannel()];
}

// src/plugin/engine.ts
var JsonSessionMap = class {
  constructor(file) {
    this.file = file;
    try {
      this.data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      this.data = {};
    }
  }
  file;
  data = {};
  get(key) {
    return this.data[key];
  }
  put(key, sessionId) {
    this.data[key] = sessionId;
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch {
    }
  }
};
function dataFile(ctx) {
  const dir = ctx.baseDir ?? join2(process.env.TEMP ?? "/tmp", "im-connect");
  mkdirSync(dir, { recursive: true });
  return join2(dir, "session-map.json");
}
function createEngine(ctx, channels = listChannels()) {
  const log = ctx.logger ?? { info: () => {
  }, warn: () => {
  }, error: () => {
  } };
  const store = new JsonSessionMap(dataFile(ctx));
  const stops = [];
  const selfIds = /* @__PURE__ */ new Set();
  let disposed = false;
  const dispatch = async (channel, message) => {
    if (disposed) return;
    try {
      if (!gateAllows(message, selfIds)) return;
      const key = `${channel.providerId}:${message.conversationId}`;
      let sessionId = store.get(key);
      if (!sessionId) {
        const created = await ctx.sessionController.create({});
        sessionId = created.sessionId;
        store.put(key, sessionId);
        log.info(`[im-connect] new session ${sessionId} for ${key}`);
      }
      const requestId = `im-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await ctx.sessionController.resolveAgent(sessionId);
      await ctx.sessionController.prompt(
        {
          requestId,
          sessionId,
          mode: "queue",
          content: [{ type: "text", text: message.text }]
        },
        new AbortController().signal
      );
      const reply = await collectReply(ctx, sessionId);
      if (reply.trim()) {
        await channel.sendText({ conversationId: message.conversationId }, reply.trim());
        log.info(`[im-connect] replied to ${channel.providerId}:${message.conversationId}`);
      }
    } catch (e) {
      log.error(`[im-connect] dispatch failed: ${e?.message ?? String(e)}`);
    }
  };
  void (async () => {
    for (const channel of channels) {
      try {
        const handle = await channel.listen((m) => {
          void dispatch(channel, m);
        });
        stops.push(handle.stop);
        log.info(`[im-connect] ${channel.providerId} listener started`);
        try {
          const status = await channel.status();
          const selfId = status.user_id ?? status.userid;
          if (selfId) selfIds.add(String(selfId));
        } catch {
        }
      } catch (e) {
        log.warn(`[im-connect] ${channel.providerId} listen failed: ${String(e)}`);
      }
    }
  })();
  const stop = () => {
    disposed = true;
    for (const s of stops) {
      try {
        s();
      } catch {
      }
    }
  };
  ctx.onDispose?.(stop);
  return stop;
}
function gateAllows(message, selfIds) {
  if (message.senderId && selfIds.has(message.senderId)) return false;
  if (message.conversationType === "group") return message.mentionedBot === true;
  return true;
}
async function collectReply(ctx, sessionId) {
  const ac = new AbortController();
  const parts = [];
  try {
    const frames = ctx.sessionController.follow(
      { address: { kind: "session", sessionId }, assistantStream: true },
      ac.signal
    );
    for await (const frame of frames) {
      if (frame.type !== "assistant-stream") continue;
      const f = frame.frame;
      if (f.type === "chunk") {
        const c = f.chunk;
        if (c && typeof c === "object" && c.type === "text-delta" && typeof c.text === "string") {
          parts.push(c.text);
        }
      } else if (f.type === "end") {
        ac.abort();
        break;
      }
    }
  } catch {
  }
  return parts.join("");
}

// src/plugin/index.ts
var inject = ["sessionController"];
function apply(ctx) {
  const engineCtx = {
    sessionController: ctx.sessionController,
    // 仅依赖已注入的 sessionController 与标准 ctx.on；数据目录由引擎回退到临时目录。
    onDispose: (fn) => {
      ctx.on("dispose", fn);
    }
  };
  const stop = createEngine(engineCtx);
  return stop;
}
export {
  apply,
  inject
};
