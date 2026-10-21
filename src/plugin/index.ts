import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine, runSelfTest } from "./engine.js";
import { JsonConfigStore, resolveDataDir } from "./config.js";
import { ImConnectHost, registerRoutes } from "./host.js";

/** Host 插件入口：DSH Loader 以 `@local/im-connect` 加载并调用 apply(ctx, config)。 */
export const inject = ["sessionController", "webServer", "connection"];

/** 进程内单例：Loader 卸载时不保证触发 dispose，靠它在新激活时停掉上一实例。 */
const ACTIVE_ENGINE = Symbol.for("im-connect.active-engine");

export function apply(ctx: {
  sessionController: unknown;
  webServer: unknown;
  connection: unknown;
  on(event: string, listener: (...args: unknown[]) => void): () => void;
}): () => void {
  // 停掉同一进程内上一代实例（监听/路由/监督循环），避免进程与路由堆积。
  const g = globalThis as Record<symbol, unknown>;
  const previous = g[ACTIVE_ENGINE] as (() => void) | undefined;
  if (typeof previous === "function") {
    try {
      previous();
    } catch {
      /* ignore */
    }
  }

  const dataDir = resolveDataDir();
  const config = new JsonConfigStore(join(dataDir, "config.json"));
  const host = new ImConnectHost(config);
  const engineCtx = {
    sessionController: ctx.sessionController as never,
    onDispose: (fn: () => void): void => {
      ctx.on("dispose", fn);
    },
  };
  const stopEngine = createEngine(engineCtx, undefined, {
    isEnabled: (providerId) => config.getReceive(providerId),
    allowSelf: () => config.getAllowSelf(),
    command: () => config.getCommand(),
    access: {
      isApproved: (providerId, senderId) => config.isApproved(providerId, senderId),
      recordPending: (providerId, message) => config.recordPending(providerId, message),
      markNotified: (providerId, senderId) => config.markNotified(providerId, senderId),
    },
  });

  // 验证钩子：数据目录存在 run-selftest 标记时，激活即真实跑一轮 Agent 回合并落盘结果。
  try {
    const flag = join(dataDir, "run-selftest");
    if (existsSync(flag)) {
      rmSync(flag, { force: true });
      void runSelfTest(engineCtx).then((result) => {
        try {
          writeFileSync(join(dataDir, "selftest-result.json"), JSON.stringify(result, null, 2));
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    /* ignore */
  }
  const stopRoutes = registerRoutes(
    { webServer: ctx.webServer as never, connection: ctx.connection as never },
    host,
    () => runSelfTest(engineCtx),
  );

  const dispose = (): void => {
    try {
      stopEngine();
    } catch {
      /* ignore */
    }
    try {
      stopRoutes();
    } catch {
      /* ignore */
    }
    if (g[ACTIVE_ENGINE] === dispose) delete g[ACTIVE_ENGINE];
  };
  g[ACTIVE_ENGINE] = dispose;
  ctx.on("dispose", dispose);
  return dispose;
}
