import type { ImProviderSpec } from "./types.js";
import { dingtalk } from "./dingtalk.js";
import { wecom } from "./wecom.js";

/** 已注册的 IM 平台。新增飞书 / Discord 时在此追加。 */
const providers: ImProviderSpec[] = [dingtalk, wecom];

export function listProviders(): ImProviderSpec[] {
  return providers;
}

export function getProvider(id: string): ImProviderSpec | undefined {
  return providers.find((p) => p.id === id);
}
