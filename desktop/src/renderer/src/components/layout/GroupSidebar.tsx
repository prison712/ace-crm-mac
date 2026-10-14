import { ArrowLeft, Briefcase, Headset, MapPinned, MessageCircle, Moon, Sun, User } from "lucide-react";
import { useAppMode } from "@/context/ModeContext";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/context/I18nContext";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/AppProvider";

/** 按钮 h-8 + ring-2 外扩 2px，滚动区顶部留白避免选中环被 overflow 裁切 */
const GROUP_LIST_TOP_PAD_PX = 2;

export function GroupSidebar() {
  const { t } = useI18n();
  const {
    groups,
    state,
    selectGroup,
    toggleTheme,
    openSettings,
    closeSettings,
    settingsView,
    isGroupBlinking,
    getGroupUnreadCount,
  } = useApp();

  const userSettingsOpen = settingsView?.type === "user";
  const { appMode, setAppMode } = useAppMode();

  return (
    <aside className="flex h-full w-11 shrink-0 flex-col border-r border-sidebar-border bg-sidebar py-2">
      <TooltipProvider delayDuration={200}>
        <div className="flex h-full w-full flex-col items-center gap-1">
          <div
            className="sidebar-group-scroll flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto"
            style={{ paddingTop: GROUP_LIST_TOP_PAD_PX }}
          >
            {appMode === "social" ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setAppMode("workbench")}
                      aria-label={t("titlebar.backWorkbench")}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t("titlebar.backWorkbench")}</TooltipContent>
                </Tooltip>
                {groups.map((group) => {
                  const unread = getGroupUnreadCount(group.id);
                  const blinking = isGroupBlinking(group.id);
                  return (
              <Tooltip key={group.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => selectGroup(group.id)}
                    className={cn(
                      "relative flex h-8 w-8 items-center justify-center p-1 transition-colors",
                      "hover:bg-sidebar-accent",
                      state.selectedGroupId === group.id &&
                        "bg-sidebar-accent ring-1 ring-primary/50",
                      blinking && "omni-message-blink ring-2 ring-primary",
                    )}
                    aria-label={
                      unread > 0 ? `${group.name} (${unread})` : group.name
                    }
                  >
                    <img
                      src={group.logo}
                      alt=""
                      className="h-5 w-5 shrink-0 object-contain"
                      draggable={false}
                    />
                    {unread > 0 ? (
                      <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-semibold leading-none text-destructive-foreground">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{group.name}</TooltipContent>
              </Tooltip>
                  );
                })}
              </>
            ) : appMode === "maps" ? (
              <p className="px-1 text-center text-[10px] leading-tight text-muted-foreground">
                {t("sidebar.maps")}
              </p>
            ) : (
              <p className="px-1 text-center text-[10px] leading-tight text-muted-foreground">
                ACE CRM
              </p>
            )}
          </div>

          <div className="mt-auto flex w-full flex-col items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8", appMode === "workbench" && "bg-sidebar-accent ring-1 ring-primary/50")}
                  onClick={() => setAppMode("workbench")}
                  aria-label={t("sidebar.workbench")}
                >
                  <Briefcase className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.workbench")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8", appMode === "social" && "bg-sidebar-accent ring-1 ring-primary/50")}
                  onClick={() => setAppMode("social")}
                  aria-label={t("sidebar.social")}
                >
                  <MessageCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.social")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8", appMode === "maps" && "bg-sidebar-accent ring-1 ring-primary/50")}
                  onClick={() => setAppMode("maps")}
                  aria-label={t("sidebar.maps")}
                >
                  <MapPinned className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.maps")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={t("sidebar.support")}
                >
                  <Headset className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={8}
                className="border border-border bg-popover p-2 text-popover-foreground shadow-md"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <img
                    src="./support-qr.png"
                    alt={t('license.supportQrAlt')}
                    className="h-40 w-40 object-contain"
                    draggable={false}
                    onError={(e) => {
                      e.currentTarget.remove()
                    }}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {t('license.supportHint')}
                  </span>
                </div>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8",
                    userSettingsOpen &&
                      "bg-sidebar-accent ring-1 ring-primary/50",
                  )}
                  onClick={() =>
                    void (userSettingsOpen
                      ? closeSettings()
                      : openSettings({ type: "user" }))
                  }
                  aria-label={t("sidebar.userSettings")}
                >
                  <User className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.userSettings")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={toggleTheme}
                  aria-label={
                    state.theme === "light"
                      ? t("sidebar.themeDark")
                      : t("sidebar.themeLight")
                  }
                >
                  {state.theme === "light" ? (
                    <Moon className="h-3.5 w-3.5" />
                  ) : (
                    <Sun className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {state.theme === "light"
                  ? t("sidebar.themeDark")
                  : t("sidebar.themeLight")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    </aside>
  );
}
