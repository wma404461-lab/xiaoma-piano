/** Keep bundled resources inside the current app root on web, desktop and native. */
export function appAsset(resource: string, base?: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(resource)) return resource;
  base ??= typeof document === "undefined" ? undefined : document.baseURI;
  if (!base) return resource;
  return new URL(resource.replace(/^\/+/, ""), new URL("./", base)).href;
}
