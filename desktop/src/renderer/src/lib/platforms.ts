import type { EnabledPlatforms, PlatformId, SocialPlatformId, TabGroup } from "./types";

export interface PlatformDef {
  id: PlatformId;
  name: string;
  chatUrl: string;
  logo: string;
}

export interface SocialPlatformDef {
  id: SocialPlatformId;
  name: string;
  chatUrl: string;
  logo: string;
}

/**
 * 渠道列表：URL / 名称对齐海王 appList；展示风格沿用 electron-app（侧栏开关 + logo）。
 * 图标：既有 SVG 保留；新增渠道自海王 PNG/JPG。
 */
export const PLATFORMS: PlatformDef[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    chatUrl: "https://web.whatsapp.com/",
    logo: "./platforms/whatsapp.svg",
  },
  {
    id: "zalo",
    name: "Zalo",
    chatUrl: "https://id.zalo.me",
    logo: "./platforms/zalo.png",
  },
  {
    id: "line",
    name: "LINE",
    chatUrl: "chrome-extension://(runtime)/index.html",
    logo: "./platforms/line.svg",
  },
  {
    id: "line_business",
    name: "LINE Business",
    chatUrl: "https://chat.line.biz",
    logo: "./platforms/line_business.png",
  },
  {
    id: "telegram",
    name: "Telegram",
    chatUrl: "https://web.telegram.org/k/",
    logo: "./platforms/telegram.svg",
  },
  {
    id: "telegram_w",
    name: "Telegram-W",
    chatUrl: "https://tg.scrmceo.com/telegram-a/",
    logo: "./platforms/telegram_w.png",
  },
  {
    id: "tiktok",
    name: "TikTok",
    chatUrl: "https://www.tiktok.com/messages",
    logo: "./platforms/tiktok.svg",
  },
  {
    id: "instagram",
    name: "Instagram",
    chatUrl: "https://www.instagram.com/direct/inbox/",
    logo: "./platforms/instagram.svg",
  },
  {
    id: "facebook",
    name: "Facebook",
    chatUrl: "https://www.facebook.com/messages/",
    logo: "./platforms/facebook.png",
  },
  {
    id: "meta_business",
    name: "Meta Business",
    chatUrl: "https://business.facebook.com/?locale=zh",
    logo: "./platforms/meta_business.png",
  },
  {
    id: "twitter",
    name: "X (Twitter)",
    chatUrl: "https://x.com/messages",
    logo: "./platforms/twitter.svg",
  },
  {
    id: "messenger",
    name: "Messenger",
    chatUrl: "https://www.messenger.com",
    logo: "./platforms/messenger.svg",
  },
  {
    id: "google_voice",
    name: "Google Voice",
    chatUrl: "https://voice.google.com/messages",
    logo: "./platforms/google_voice.png",
  },
  {
    id: "botim",
    name: "Botim",
    chatUrl: "https://web.botim.me",
    logo: "./platforms/botim.png",
  },
  {
    id: "snapchat",
    name: "Snapchat",
    chatUrl: "https://web.snapchat.com/",
    logo: "./platforms/snapchat.jpg",
  },
  {
    id: "discord",
    name: "Discord",
    chatUrl: "https://discord.com/app/",
    logo: "./platforms/discord.svg",
  },
  {
    id: "skype",
    name: "Skype",
    chatUrl: "https://teams.live.com",
    logo: "./platforms/skype.png",
  },
  {
    id: "line_works",
    name: "LINE Works",
    chatUrl: "https://talk.worksmobile.com",
    logo: "./platforms/line_works.png",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    chatUrl: "https://www.linkedin.com/messaging/",
    logo: "./platforms/linkedin.svg",
  },
  {
    id: "google_chat",
    name: "Google Chat",
    chatUrl: "https://chat.google.com",
    logo: "./platforms/google_chat.png",
  },
  {
    id: "tinder",
    name: "Tinder",
    chatUrl: "https://www.tinder.com",
    logo: "./platforms/tinder.png",
  },
  /** 代理 / 指纹检测（默认关闭，用户设置中开启） */
  {
    id: "whoer",
    name: "BrowserScan",
    chatUrl: "https://browserscan.net/",
    logo: "./platforms/whoer.svg",
  },
];

const platformMap = new Map(PLATFORMS.map((p) => [p.id, p]));

/** 社媒聊天渠道（不含检测页） */
export const MESSAGING_PLATFORMS: SocialPlatformDef[] = PLATFORMS.filter(
  (p) => p.id !== "whoer",
) as SocialPlatformDef[];

/** 检测类渠道（Whoer 等） */
export const TOOL_PLATFORMS: SocialPlatformDef[] = PLATFORMS.filter(
  (p) => p.id === "whoer",
) as SocialPlatformDef[];

/** 可在用户设置中开关的全部渠道 */
export const SOCIAL_PLATFORMS: SocialPlatformDef[] = PLATFORMS as SocialPlatformDef[];

export function defaultEnabledPlatforms(): EnabledPlatforms {
  return Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [p.id, p.id !== "whoer"]),
  ) as EnabledPlatforms;
}

/** 默认社媒顺序（与 PLATFORMS 中 messaging 段一致） */
export function defaultPlatformOrder(): SocialPlatformId[] {
  return MESSAGING_PLATFORMS.map((p) => p.id);
}

/** 合并已保存顺序：保留用户排序，追加新增渠道，去掉已废弃 id */
export function normalizePlatformOrder(raw: unknown): SocialPlatformId[] {
  const defaults = defaultPlatformOrder();
  const known = new Set(defaults);
  const seen = new Set<SocialPlatformId>();
  const next: SocialPlatformId[] = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (typeof id !== "string") continue;
      const pid = id as SocialPlatformId;
      if (!known.has(pid) || seen.has(pid)) continue;
      seen.add(pid);
      next.push(pid);
    }
  }
  for (const id of defaults) {
    if (!seen.has(id)) next.push(id);
  }
  return next;
}

export function orderedMessagingPlatforms(
  order: SocialPlatformId[],
): SocialPlatformDef[] {
  const byId = new Map(MESSAGING_PLATFORMS.map((p) => [p.id, p]));
  return normalizePlatformOrder(order)
    .map((id) => byId.get(id))
    .filter((p): p is SocialPlatformDef => Boolean(p));
}

export function movePlatformInOrder(
  order: SocialPlatformId[],
  id: SocialPlatformId,
  delta: -1 | 1,
): SocialPlatformId[] {
  const list = normalizePlatformOrder(order);
  const i = list.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = list.slice();
  ;[next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function isPlatformEnabled(
  enabledPlatforms: EnabledPlatforms,
  id: PlatformId,
): boolean {
  return enabledPlatforms[id] !== false;
}

export function getPlatform(id: PlatformId): PlatformDef {
  const platform = platformMap.get(id);
  if (!platform) throw new Error(`Unknown platform: ${id}`);
  return platform;
}

export function getFixedGroups(): TabGroup[] {
  return SOCIAL_PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    logo: p.logo,
  }));
}

/** 根据用户开关与排序过滤左侧竖栏；Whoer 等检测页在测试模式且开启时排在末尾 */
export function getVisibleGroups(
  enabledPlatforms: EnabledPlatforms,
  opts?: { testModeEnabled?: boolean; platformOrder?: SocialPlatformId[] },
): TabGroup[] {
  const testOn = Boolean(opts?.testModeEnabled);
  const messaging = orderedMessagingPlatforms(
    opts?.platformOrder ?? defaultPlatformOrder(),
  )
    .filter((p) => isPlatformEnabled(enabledPlatforms, p.id))
    .map((p) => ({ id: p.id, name: p.name, logo: p.logo }));
  const tools = TOOL_PLATFORMS.filter((p) => {
    if (p.id === "whoer" && !testOn) return false;
    return isPlatformEnabled(enabledPlatforms, p.id);
  }).map((p) => ({ id: p.id, name: p.name, logo: p.logo }));
  return [...messaging, ...tools];
}

export function getPlatformChatUrl(
  groupId: PlatformId,
  platformUrls?: Partial<Record<PlatformId, string>>,
): string {
  const override = platformUrls?.[groupId]?.trim();
  if (override) return override;
  return getPlatform(groupId).chatUrl;
}

export function isPlatformId(id: string): id is PlatformId {
  return platformMap.has(id as PlatformId);
}

/** 旧版 ip-test → whoer */
export function normalizePlatformId(id: string): PlatformId | null {
  if (id === "ip-test") return "whoer";
  if (platformMap.has(id as PlatformId)) return id as PlatformId;
  return null;
}

export function defaultTabTitle(groupId: PlatformId, index: number): string {
  const name = getPlatform(groupId).name;
  return index <= 1 ? name : `${name} ${index}`;
}
