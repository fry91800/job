import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { fr } from "./fr";

// Interface languages (FEATURE L1). The choice is kept in the browser; it will follow the
// account's setting (uiLanguage) once accounts are connected (FRONTEND.md §8, step 3).
export const LANGUAGES = ["fr", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = "job.language";

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    // Storage unavailable: the browser's language.
  }
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React escapes
});
document.documentElement.lang = i18n.language;

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
  document.documentElement.lang = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not kept: fine.
  }
}

export default i18n;
