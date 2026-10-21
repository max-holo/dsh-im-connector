import type { ImChannel } from "./types.js";
import { DingTalkChannel } from "./dingtalk.js";
import { WeComChannel } from "./wecom.js";

/** 已注册的渠道适配器。新增飞书 / Discord 时在此追加。 */
export function listChannels(): ImChannel[] {
  return [new DingTalkChannel(), new WeComChannel()];
}

export function getChannel(providerId: string): ImChannel | undefined {
  return listChannels().find((c) => c.providerId === providerId);
}
