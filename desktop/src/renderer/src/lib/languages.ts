/** 标签页翻译目标语言（BCP-47 简码，提交给大模型），按跨境使用频率排序 */
export const TARGET_LANGUAGES = [
  { code: "zh", labelZh: "中文", labelEn: "Chinese" },
  { code: "en", labelZh: "英语", labelEn: "English" },
  { code: "es", labelZh: "西班牙语", labelEn: "Spanish" },
  { code: "hi", labelZh: "印地语", labelEn: "Hindi" },
  { code: "ar", labelZh: "阿拉伯语", labelEn: "Arabic" },
  { code: "pt", labelZh: "葡萄牙语", labelEn: "Portuguese" },
  { code: "bn", labelZh: "孟加拉语", labelEn: "Bengali" },
  { code: "ru", labelZh: "俄语", labelEn: "Russian" },
  { code: "ja", labelZh: "日语", labelEn: "Japanese" },
  { code: "de", labelZh: "德语", labelEn: "German" },
  { code: "fr", labelZh: "法语", labelEn: "French" },
  { code: "ko", labelZh: "韩语", labelEn: "Korean" },
  { code: "tr", labelZh: "土耳其语", labelEn: "Turkish" },
  { code: "vi", labelZh: "越南语", labelEn: "Vietnamese" },
  { code: "it", labelZh: "意大利语", labelEn: "Italian" },
  { code: "th", labelZh: "泰语", labelEn: "Thai" },
  { code: "pl", labelZh: "波兰语", labelEn: "Polish" },
  { code: "uk", labelZh: "乌克兰语", labelEn: "Ukrainian" },
  { code: "nl", labelZh: "荷兰语", labelEn: "Dutch" },
  { code: "id", labelZh: "印尼语", labelEn: "Indonesian" },
  { code: "ms", labelZh: "马来语", labelEn: "Malay" },
  { code: "ro", labelZh: "罗马尼亚语", labelEn: "Romanian" },
  { code: "el", labelZh: "希腊语", labelEn: "Greek" },
  { code: "cs", labelZh: "捷克语", labelEn: "Czech" },
  { code: "sv", labelZh: "瑞典语", labelEn: "Swedish" },
  { code: "hu", labelZh: "匈牙利语", labelEn: "Hungarian" },
  { code: "fa", labelZh: "波斯语", labelEn: "Persian" },
  { code: "he", labelZh: "希伯来语", labelEn: "Hebrew" },
  { code: "da", labelZh: "丹麦语", labelEn: "Danish" },
  { code: "fi", labelZh: "芬兰语", labelEn: "Finnish" },
  { code: "no", labelZh: "挪威语", labelEn: "Norwegian" },
  { code: "ur", labelZh: "乌尔都语", labelEn: "Urdu" },
  { code: "fil", labelZh: "菲律宾语", labelEn: "Filipino" },
  { code: "ta", labelZh: "泰米尔语", labelEn: "Tamil" },
  { code: "te", labelZh: "泰卢固语", labelEn: "Telugu" },
  { code: "mr", labelZh: "马拉地语", labelEn: "Marathi" },
  { code: "gu", labelZh: "古吉拉特语", labelEn: "Gujarati" },
  { code: "sw", labelZh: "斯瓦希里语", labelEn: "Swahili" },
  { code: "ca", labelZh: "加泰罗尼亚语", labelEn: "Catalan" },
  { code: "sk", labelZh: "斯洛伐克语", labelEn: "Slovak" },
] as const;

export const TARGET_LANGUAGE_COUNT = TARGET_LANGUAGES.length;

export type TargetLanguageCode = (typeof TARGET_LANGUAGES)[number]["code"];

export const DEFAULT_SEND_TARGET_LANG: TargetLanguageCode = "en";
export const DEFAULT_RECEIVE_TARGET_LANG: TargetLanguageCode = "zh";

export function isTargetLanguageCode(code: string): code is TargetLanguageCode {
  return TARGET_LANGUAGES.some((l) => l.code === code);
}

export function normalizeTargetLanguage(
  code: unknown,
  fallback: TargetLanguageCode,
): TargetLanguageCode {
  return typeof code === "string" && isTargetLanguageCode(code) ? code : fallback;
}

export function targetLanguageLabel(
  code: TargetLanguageCode,
  lang: "zh" | "en",
): string {
  const entry = TARGET_LANGUAGES.find((l) => l.code === code);
  if (!entry) return code;
  return lang === "zh" ? entry.labelZh : entry.labelEn;
}

/** 手动翻译面板：源语言可选自动识别 */
export const MANUAL_SOURCE_AUTO = "auto" as const;
export type ManualSourceLangCode = typeof MANUAL_SOURCE_AUTO | TargetLanguageCode;
export const DEFAULT_MANUAL_SOURCE_LANG: ManualSourceLangCode = MANUAL_SOURCE_AUTO;
export const DEFAULT_MANUAL_TARGET_LANG: TargetLanguageCode = DEFAULT_SEND_TARGET_LANG;

export function normalizeManualSourceLanguage(
  code: unknown,
  fallback: ManualSourceLangCode = DEFAULT_MANUAL_SOURCE_LANG,
): ManualSourceLangCode {
  if (code === MANUAL_SOURCE_AUTO) return MANUAL_SOURCE_AUTO;
  return typeof code === "string" && isTargetLanguageCode(code) ? code : fallback;
}
