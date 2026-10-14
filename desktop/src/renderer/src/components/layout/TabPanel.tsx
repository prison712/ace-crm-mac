import { useState } from "react";
import { Plus, Settings2, StickyNote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DevCluePanel } from "@/components/layout/DevCluePanel";
import { TabRemarkDialog } from "@/components/layout/TabRemarkDialog";
import { useI18n } from "@/context/I18nContext";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/AppProvider";

export function TabPanel() {
  const { t } = useI18n();
  const {
    state,
    groups,
    groupTabs,
    activeTab,
    setActiveTab,
    addTab,
    removeTab,
    openSettings,
    updateTab,
    isTabBlinking,
    getTabUnreadCount,
    openTabRemark,
    closeTabRemark,
  } = useApp();

  const [remarkTabId, setRemarkTabId] = useState<string | null>(null);
  const remarkTab =
    remarkTabId != null
      ? state.tabs.find((tab) => tab.id === remarkTabId) ?? null
      : null;

  const selectedGroup = groups.find((g) => g.id === state.selectedGroupId);

  if (!state.selectedGroupId || !selectedGroup) {
    return null;
  }

  const groupName = selectedGroup.name;

  return (
    <>
      <aside className="flex w-52 min-w-52 shrink-0 flex-col overflow-hidden border-r border-border bg-card/40">
        <div className="flex items-center justify-between gap-1 px-2 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{groupName}</p>
            <p className="text-[11px] text-muted-foreground">
              {t("tabPanel.count", { count: groupTabs.length })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => addTab(state.selectedGroupId!)}
            title={t("tabPanel.newTab")}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Separator />
        <ScrollArea className="min-w-0 flex-1">
          <div className="min-w-0 space-y-px p-1 pb-2">
            {groupTabs.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-muted-foreground">
                {t("tabPanel.empty")}
              </p>
            ) : null}
            {groupTabs.map((tab) => {
              const isActive = activeTab?.id === tab.id;
              const blinking = isTabBlinking(tab.id);
              const unread = getTabUnreadCount(tab.id);
              return (
                <div
                  key={tab.id}
                  className={cn(
                    "grid min-w-0 grid-cols-[minmax(0,1fr)_1.75rem_1.75rem_1.75rem] items-center gap-0.5 overflow-hidden py-0.5 pr-0.5 pl-1.5",
                    isActive
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                    blinking && "omni-message-blink bg-primary/15 ring-1 ring-primary/60",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1 overflow-hidden py-1 text-left text-[13px]"
                    onClick={() => setActiveTab(tab.id)}
                    title={tab.title}
                  >
                    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                    {unread > 0 ? (
                      <span className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : null}
                    {tab.proxyEnabled ? (
                      <span className="shrink-0 text-[9px] uppercase text-primary">
                        {t("tabPanel.proxy")}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground",
                      tab.remark?.trim() && "text-primary",
                    )}
                    title={
                      tab.remark?.trim()
                        ? t("tabPanel.remark")
                        : t("tabPanel.addRemark")
                    }
                    aria-label={t("tabPanel.remarkAria", { title: tab.title })}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void openTabRemark().then(() => setRemarkTabId(tab.id));
                    }}
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={t("tabPanel.settings")}
                    aria-label={t("tabPanel.settingsAria", { title: tab.title })}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void openSettings({ type: "tab", tabId: tab.id });
                    }}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    title={t("tabPanel.close")}
                    aria-label={t("tabPanel.closeAria", { title: tab.title })}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void removeTab(tab.id);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <DevCluePanel />
      </aside>

      <TabRemarkDialog
        tab={remarkTab}
        open={remarkTabId != null}
        onOpenChange={(open) => {
          if (!open) {
            setRemarkTabId(null);
            void closeTabRemark();
          }
        }}
        onSave={(tabItem, remark) => updateTab({ ...tabItem, remark })}
      />
    </>
  );
}
