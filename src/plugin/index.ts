import { createEngine } from "./engine.js";

/** Host 插件入口：DSH Loader 以 `@local/im-connect` 加载并调用 apply(ctx, config)。 */
export const inject = ["sessionController"];

export function apply(ctx: {
  sessionController: unknown;
  on(event: string, listener: (...args: unknown[]) => void): () => void;
}): () => void {
  const engineCtx = {
    sessionController: ctx.sessionController as never,
    // 仅依赖已注入的 sessionController 与标准 ctx.on；数据目录由引擎回退到临时目录。
    onDispose: (fn: () => void): void => {
      ctx.on("dispose", fn);
    },
  };
  const stop = createEngine(engineCtx);
  return stop;
}
