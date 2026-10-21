import { join } from "node:path";
import { createEngine } from "./engine.js";
import { JsonConfigStore, resolveDataDir } from "./config.js";
import { ImConnectHost, registerRoutes } from "./host.js";

/** Host 插件入口：DSH Loader 以 `@local/im-connect` 加载并调用 apply(ctx, config)。 */
export const inject = ["sessionController", "webServer", "connection"];

export function apply(ctx: {
  sessionController: unknown;
  webServer: unknown;
  connection: unknown;
  on(event: string, listener: (...args: unknown[]) => void): () => void;
}): () => void {
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
  });
  const stopRoutes = registerRoutes(
    { webServer: ctx.webServer as never, connection: ctx.connection as never },
    host,
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
  };
  ctx.on("dispose", dispose);
  return dispose;
}
