import { useSyncExternalStore } from "react";

export type Locale = "zh" | "en";
export type Messages = Record<string, string>;
const dictionaries: Messages[] = [];
const listeners = new Set<() => void>();
let locale: Locale = "en";
export function getLocale(): Locale { return locale; }
export function registerMessages(messages: Messages) { dictionaries.push(messages); }
export function translate(text: string, selected: Locale = locale, values?: Record<string, string | number>): string {
  let result = text;
  for (let index = dictionaries.length - 1; index >= 0; index--) {
    const translated = dictionaries[index][text];
    if (translated !== undefined) { result = translated; break; }
  }
  return result.replace(/\{(\w+)\}/g, (match, key: string) => values?.[key] === undefined ? match : String(values[key]));
}
export function setLocale(next: Locale) {
  next = "en";
  locale = next;
  try { localStorage.setItem("qinban.locale", next); } catch {}
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", next);
      window.history.replaceState(window.history.state, "", url);
    }
  }
  if (typeof document !== "undefined") document.documentElement.lang = "en";
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key === "qinban.locale") setLocale(event.newValue === "en" ? "en" : "zh");
});
if (typeof document !== "undefined") document.documentElement.lang = "en";
export function useI18n() {
  const selected = useSyncExternalStore(subscribe, getLocale, () => "en" as Locale);
  return { locale: selected, setLocale, t: (text: string, values?: Record<string, string | number>) => translate(text, selected, values) };
}
