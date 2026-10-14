import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/context/I18nContext";
import {
  TARGET_LANGUAGES,
  targetLanguageLabel,
  type TargetLanguageCode,
} from "@/lib/languages";
import { getPlatform, getPlatformChatUrl } from "@/lib/platforms";
import { testProxy } from "@/lib/proxyApi";
import type {
  BrowserTab,
  ChatLangPref,
  ProxyConfig,
  ProxyTestResult,
  SettingsView,
} from "@/lib/types";
import { useApp } from "@/store/AppProvider";

interface SettingsPanelProps {
  view: Extract<SettingsView, { type: "tab" }>;
}

export function SettingsPanel({ view }: SettingsPanelProps) {
  const { t, lang } = useI18n();
  const { state, closeSettings, applyProxyToTab, updateTab } = useApp();
  const tab = state.tabs.find((item) => item.id === view.tabId);

  if (!tab) {
    return (
      <SettingsShell title={t("settings.tabTitle")} onClose={closeSettings}>
        <p className="text-sm text-muted-foreground">{t("settings.tabMissing")}</p>
      </SettingsShell>
    );
  }

  return (
    <TabSettingsForm
      tab={tab}
      lang={lang}
      onClose={closeSettings}
      onUpdateTab={updateTab}
      onApply={async (updated) => {
        await applyProxyToTab(updated);
      }}
    />
  );
}

export function SettingsShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-1.5 px-2 py-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <h2 className="text-xs font-semibold">{title}</h2>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-3">{children}</div>
      </ScrollArea>
    </aside>
  );
}

function TabSettingsForm({
  tab,
  lang,
  onClose,
  onUpdateTab,
  onApply,
}: {
  tab: BrowserTab;
  lang: "zh" | "en";
  onClose: () => void;
  onUpdateTab: (tab: BrowserTab) => void;
  onApply: (tab: BrowserTab) => Promise<void>;
}) {
  const { t } = useI18n();
  const { state } = useApp();
  const platform = getPlatform(tab.groupId);
  const platformName = platform.name;
  const resolvedChatUrl = getPlatformChatUrl(tab.groupId, state.user.platformUrls);
  const [title, setTitle] = useState(tab.title);
  const [proxyEnabled, setProxyEnabled] = useState(tab.proxyEnabled);
  const [proxy, setProxy] = useState<ProxyConfig>({ ...tab.proxy });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const [chatUrl, setChatUrl] = useState(resolvedChatUrl);

  useEffect(() => {
    setTitle(tab.title);
    setProxyEnabled(tab.proxyEnabled);
    setProxy({ ...tab.proxy });
    setTestResult(null);
  }, [tab]);

  useEffect(() => {
    // 测试模式覆盖优先；LINE 无覆盖时再解析扩展运行时入口
    if (state.user.platformUrls[tab.groupId]?.trim()) {
      setChatUrl(resolvedChatUrl);
      return;
    }
    if (tab.groupId !== 'line') {
      setChatUrl(resolvedChatUrl);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const info = await window.api.getLineExtensionInfo();
        if (cancelled) return;
        setChatUrl(info.entryUrl || resolvedChatUrl);
      } catch {
        if (!cancelled) setChatUrl(resolvedChatUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.groupId, resolvedChatUrl, state.user.platformUrls]);

  const updateProxy = (patch: Partial<ProxyConfig>) => {
    setProxy((prev) => ({ ...prev, ...patch }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProxy(proxy);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsShell title={t("settings.tabTitle")} onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid gap-1">
          <Label className="text-muted-foreground">{t("settings.platform")}</Label>
          <p className="text-[13px] font-medium">{platformName}</p>
        </div>

        <div className="grid gap-1">
          <Label className="text-muted-foreground">{t("settings.chatPage")}</Label>
          <p className="break-all text-[11px] text-muted-foreground">
            {chatUrl}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("settings.urlFixed")}</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="tab-title">{t("settings.tabName")}</Label>
          <Input
            id="tab-title"
            value={title}
            maxLength={16}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <Separator />

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">{t("settings.translateLang")}</p>
            <span className="text-[10px] text-muted-foreground">
              {t("settings.autoSave")}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.translateHint")}
          </p>
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("settings.tabDefaultLang")}
          </p>
          <LangSelect
            id="send-target-lang"
            label={t("settings.sendTarget")}
            lang={lang}
            value={tab.sendTargetLang}
            onChange={(code) =>
              onUpdateTab({ ...tab, sendTargetLang: code })
            }
          />
          <LangSelect
            id="receive-target-lang"
            label={t("settings.receiveTarget")}
            lang={lang}
            value={tab.receiveTargetLang}
            onChange={(code) =>
              onUpdateTab({ ...tab, receiveTargetLang: code })
            }
          />
        </div>

        <Separator />

        <ChatLangSection tab={tab} lang={lang} onUpdateTab={onUpdateTab} />

        <Separator />

        <div className="flex items-center justify-between gap-2 border p-2">
          <div className="min-w-0">
            <p className="text-xs font-medium">{t("settings.manualPanelDisablesAuto")}</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("settings.manualPanelDisablesAutoHint")}
            </p>
          </div>
          <Switch
            checked={Boolean(tab.manualPanelDisablesAutoTranslate)}
            onCheckedChange={(checked) =>
              onUpdateTab({ ...tab, manualPanelDisablesAutoTranslate: checked })
            }
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between border p-2">
          <div>
            <p className="text-xs font-medium">{t("settings.proxyEnable")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.proxyTabOnly")}</p>
          </div>
          <Switch checked={proxyEnabled} onCheckedChange={setProxyEnabled} />
        </div>

        <div
          className={`grid gap-2 ${!proxyEnabled ? "pointer-events-none opacity-50" : ""}`}
        >
          <div className="grid gap-2">
            <Label htmlFor="proxy-host">{t("settings.proxyHost")}</Label>
            <Input
              id="proxy-host"
              value={proxy.host}
              onChange={(e) => updateProxy({ host: e.target.value })}
              placeholder="127.0.0.1"
              disabled={!proxyEnabled}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proxy-port">{t("settings.proxyPort")}</Label>
            <Input
              id="proxy-port"
              type="number"
              min={1}
              max={65535}
              value={proxy.port || ""}
              onChange={(e) =>
                updateProxy({ port: Number(e.target.value) || 0 })
              }
              placeholder="7890"
              disabled={!proxyEnabled}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proxy-user">{t("settings.proxyUser")}</Label>
            <Input
              id="proxy-user"
              value={proxy.username}
              onChange={(e) => updateProxy({ username: e.target.value })}
              disabled={!proxyEnabled}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proxy-pass">{t("settings.proxyPass")}</Label>
            <Input
              id="proxy-pass"
              type="password"
              value={proxy.password}
              onChange={(e) => updateProxy({ password: e.target.value })}
              disabled={!proxyEnabled}
              autoComplete="off"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              !proxyEnabled || testing || !proxy.host.trim() || !proxy.port
            }
            onClick={() => void handleTest()}
          >
            {testing ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t("settings.proxyTesting")}
              </>
            ) : (
              t("settings.proxyTest")
            )}
          </Button>

          {testResult ? (
            <div
              className={`border p-2 text-[11px] leading-relaxed ${
                testResult.success
                  ? "border-primary/30 bg-primary/5 text-foreground"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}
            >
              <p>{testResult.message}</p>
              {testResult.success && testResult.ip ? (
                <p className="mt-1 text-muted-foreground">
                  {t("settings.proxyEgress", { ip: testResult.ip })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button
            onClick={() =>
              void onApply({
                ...tab,
                title: title.trim() || tab.title,
                proxyEnabled,
                proxy,
                sendTargetLang: tab.sendTargetLang,
                receiveTargetLang: tab.receiveTargetLang,
              })
            }
          >
            {t("settings.apply")}
          </Button>
        </div>
      </div>
    </SettingsShell>
  );
}

/**
 * 写入或更新某个对话的语言覆盖。
 * @param tab 当前标签
 * @param chatId 对话 id
 * @param contactName 联系人显示名
 * @param patch 要合并的语言字段
 * @returns 更新后的标签
 */
function upsertChatLangPref(
  tab: BrowserTab,
  chatId: string,
  contactName: string,
  patch: Pick<ChatLangPref, "sendTargetLang" | "receiveTargetLang">
): BrowserTab {
  const prev = tab.chatLangPrefs?.[chatId] ?? {};
  const nextPref: ChatLangPref = {
    ...prev,
    ...patch,
    contactName: contactName || prev.contactName || "",
    updatedAt: Date.now(),
  };
  // 保证两端都有显式值，避免只改一边时另一边仍落回窗口默认造成困惑
  if (!nextPref.sendTargetLang) nextPref.sendTargetLang = tab.sendTargetLang;
  if (!nextPref.receiveTargetLang) nextPref.receiveTargetLang = tab.receiveTargetLang;
  return {
    ...tab,
    chatLangPrefs: {
      ...(tab.chatLangPrefs ?? {}),
      [chatId]: nextPref,
    },
  };
}

/**
 * 清除某个对话的语言覆盖，恢复窗口默认。
 * @param tab 当前标签
 * @param chatId 对话 id
 * @returns 更新后的标签
 */
function clearChatLangPref(tab: BrowserTab, chatId: string): BrowserTab {
  const next = { ...(tab.chatLangPrefs ?? {}) };
  delete next[chatId];
  return { ...tab, chatLangPrefs: next };
}

/**
 * 按对话/客户设置收发目标语言（优先级高于窗口默认）。
 */
function ChatLangSection({
  tab,
  lang,
  onUpdateTab,
}: {
  tab: BrowserTab;
  lang: "zh" | "en";
  onUpdateTab: (tab: BrowserTab) => void;
}) {
  const { t } = useI18n();
  const prefs = tab.chatLangPrefs ?? {};
  const activeChatId = String(tab.activeChatId || "").trim();
  const activeName =
    String(tab.activeContactName || "").trim() ||
    prefs[activeChatId]?.contactName ||
    activeChatId;
  const activePref = activeChatId ? prefs[activeChatId] : undefined;
  const otherOverrides = Object.entries(prefs)
    .filter(([id]) => id && id !== activeChatId)
    .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));

  return (
    <div className="grid gap-3">
      <div>
        <p className="text-xs font-medium">{t("settings.chatLangTitle")}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {t("settings.chatLangHint")}
        </p>
      </div>

      <div className="grid gap-2 border border-border p-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">
              {t("settings.currentChat")}
            </p>
            {activeChatId ? (
              <p className="truncate text-[13px] font-medium" title={activeName}>
                {activeName}
              </p>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("settings.noCurrentChat")}
              </p>
            )}
          </div>
          {activePref ? (
            <span className="shrink-0 text-[10px] text-primary">
              {t("settings.chatOverride")}
            </span>
          ) : null}
        </div>

        {activeChatId ? (
          <>
            <LangSelect
              id="chat-send-target-lang"
              label={t("settings.sendTarget")}
              lang={lang}
              value={activePref?.sendTargetLang || tab.sendTargetLang}
              onChange={(code) =>
                onUpdateTab(
                  upsertChatLangPref(tab, activeChatId, activeName, {
                    sendTargetLang: code,
                    receiveTargetLang:
                      activePref?.receiveTargetLang || tab.receiveTargetLang,
                  })
                )
              }
            />
            <LangSelect
              id="chat-receive-target-lang"
              label={t("settings.receiveTarget")}
              lang={lang}
              value={activePref?.receiveTargetLang || tab.receiveTargetLang}
              onChange={(code) =>
                onUpdateTab(
                  upsertChatLangPref(tab, activeChatId, activeName, {
                    sendTargetLang:
                      activePref?.sendTargetLang || tab.sendTargetLang,
                    receiveTargetLang: code,
                  })
                )
              }
            />
            {activePref ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => onUpdateTab(clearChatLangPref(tab, activeChatId))}
              >
                {t("settings.clearChatLang")}
              </Button>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {t("settings.chatUseDefault")}
              </p>
            )}
          </>
        ) : null}
      </div>

      {otherOverrides.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("settings.otherChatOverrides")}
          </p>
          {otherOverrides.map(([chatId, pref]) => {
            const name = pref.contactName?.trim() || chatId;
            return (
              <div key={chatId} className="grid gap-2 border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-medium" title={name}>
                    {name}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-[10px]"
                    onClick={() => onUpdateTab(clearChatLangPref(tab, chatId))}
                  >
                    {t("settings.clearChatLang")}
                  </Button>
                </div>
                <LangSelect
                  id={`chat-send-${chatId}`}
                  label={t("settings.sendTarget")}
                  lang={lang}
                  value={pref.sendTargetLang || tab.sendTargetLang}
                  onChange={(code) =>
                    onUpdateTab(
                      upsertChatLangPref(tab, chatId, name, {
                        sendTargetLang: code,
                        receiveTargetLang:
                          pref.receiveTargetLang || tab.receiveTargetLang,
                      })
                    )
                  }
                />
                <LangSelect
                  id={`chat-recv-${chatId}`}
                  label={t("settings.receiveTarget")}
                  lang={lang}
                  value={pref.receiveTargetLang || tab.receiveTargetLang}
                  onChange={(code) =>
                    onUpdateTab(
                      upsertChatLangPref(tab, chatId, name, {
                        sendTargetLang: pref.sendTargetLang || tab.sendTargetLang,
                        receiveTargetLang: code,
                      })
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function LangSelect({
  id,
  label,
  lang,
  value,
  onChange,
}: {
  id: string;
  label: string;
  lang: "zh" | "en";
  value: string;
  onChange: (code: TargetLanguageCode) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        className="h-9 w-full border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as TargetLanguageCode)}
      >
        {TARGET_LANGUAGES.map((item) => (
          <option key={item.code} value={item.code}>
            {targetLanguageLabel(item.code, lang)} ({item.code})
          </option>
        ))}
      </select>
    </div>
  );
}
