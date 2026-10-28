import { translate, type Locale } from "../lib/i18n";
export function practiceText(text: string, locale: Locale, values?: Record<string, string | number>): string { return translate(text, locale, values); }
