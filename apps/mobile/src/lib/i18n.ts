import { pickLocale, translations } from '@check-in/shared';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const locale = pickLocale(getLocales().map((l) => l.languageTag));

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: translations.en },
    sv: { translation: translations.sv },
  },
  lng: locale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
