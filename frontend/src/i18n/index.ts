import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import hi from "./hi.json";
import ur from "./ur.json";

const savedLanguage = window.localStorage.getItem("notez-language");
const language = savedLanguage === "ur" || savedLanguage === "hi" ? savedLanguage : "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ur: { translation: ur }, hi: { translation: hi } },
  lng: language,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (nextLanguage) => {
  const resolvedLanguage = nextLanguage === "ur" || nextLanguage === "hi" ? nextLanguage : "en";
  window.localStorage.setItem("notez-language", resolvedLanguage);
  document.documentElement.lang = resolvedLanguage;
  document.documentElement.dir = resolvedLanguage === "ur" ? "rtl" : "ltr";
});

document.documentElement.lang = language;
document.documentElement.dir = language === "ur" ? "rtl" : "ltr";

export type LanguageChoice = "en" | "ur" | "hi";
export default i18n;
