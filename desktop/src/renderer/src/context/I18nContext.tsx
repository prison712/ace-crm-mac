import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  getLang,
  setLangAndNotify,
  subscribeLang,
  t,
  type I18nKey,
  type UiLang,
} from "@/lib/i18n";

interface I18nContextValue {
  lang: UiLang;
  setLang: (lang: UiLang) => void;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(getLang);

  useEffect(() => subscribeLang(() => setLangState(getLang())), []);

  const value: I18nContextValue = {
    lang,
    setLang: setLangAndNotify,
    t: (key, vars) => t(key, vars, lang),
  };

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
