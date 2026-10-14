import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/context/I18nContext";
import type { BrowserTab } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TabRemarkDialogProps {
  tab: BrowserTab | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (tab: BrowserTab, remark: string) => void;
}

export function TabRemarkDialog({
  tab,
  open,
  onOpenChange,
  onSave,
}: TabRemarkDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (open && tab) setDraft(tab.remark ?? "");
  }, [open, tab?.id, tab?.remark]);

  if (!tab) return null;

  const handleSave = () => {
    onSave(tab, draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[min(85vh,720px)] w-[min(92vw,640px)] max-w-none flex-col gap-0 p-0",
        )}
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-base">{t("remark.title")}</DialogTitle>
          <DialogDescription className="text-left">
            {tab.title}
            <span className="text-muted-foreground">{t("remark.hint")}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 px-5 py-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("remark.placeholder")}
            className={cn(
              "h-[min(52vh,420px)] w-full resize-y border border-input bg-background px-3 py-2",
              "text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            autoFocus
          />
        </div>

        <DialogFooter className="border-t border-border px-5 py-3 sm:justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("remark.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            {t("remark.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
