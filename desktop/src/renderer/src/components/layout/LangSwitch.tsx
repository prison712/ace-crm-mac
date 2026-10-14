import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/I18nContext";
import type { UiLang } from "@/lib/i18n";

export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <Button
      type="button"
      variant="ghost"
      className={className}
      onClick={() => setLang(lang === "zh" ? "en" : ("zh" as UiLang))}
      aria-label={t("lang.switch")}
    >
      {t("lang.switch")}
    </Button>
  );
}
