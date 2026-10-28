import { Capacitor } from "@capacitor/core";
export function registerPianoWebApp() {
  if (!import.meta.env.PROD || Capacitor.isNativePlatform() || !["http:", "https:"].includes(location.protocol) || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // Worker changes affect requests only; they never reload an ongoing practice.
    void navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { scope: "./" }).catch(() => {});
  }, { once: true });
}
