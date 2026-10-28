import { Capacitor, registerPlugin } from "@capacitor/core";
import localReleases from "../data/releases.json";
import { appAsset } from "./assets";

export const APP_VERSION = localReleases[0].version;
export const NATIVE_CODE = localReleases[0].versionCode;
export const WEB_BUILD = localReleases[0].webBuild;
function updateFeed(value: string): string {
 try {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  return url.protocol === "https:" && !url.username && !url.password && !url.hash ? url.href : "";
 } catch { return ""; }
}
export const UPDATE_FEED_URL = updateFeed(import.meta.env.VITE_PIANO_UPDATE_FEED ?? "");

export interface UpdateEnvelope {
  payload: string;
  signature: string;
}
export interface UpdateArtifact {
  version?: string;
  url: string;
  sha256: string;
  size: number;
  inherit?: string[];
}
export interface ReleaseEntry {
  version: string;
  versionCode: number;
  webBuild: number;
  releaseDate: string;
  notes: string[];
  title?: string;
}
export interface UpdateRelease extends ReleaseEntry {
  minNativeVersionCode: number;
  web?: UpdateArtifact;
  apk?: UpdateArtifact;
}
export interface UpdateManifest {
  schemaVersion: 1;
  appId: "com.qinban.piano";
  generatedAt: string;
  latest: UpdateRelease;
  releases: ReleaseEntry[];
}
export interface UpdaterStatus {
  nativeVersion: string;
  nativeVersionCode: number;
  webBuild: number;
  webVersion: string;
  pending: boolean;
  updateUrl: string;
}
export interface UpdateProgress {
  kind: "web" | "apk";
  received: number;
  total: number;
  percent: number;
  phase: "downloading" | "verifying" | "applying";
}
export interface InstallResult {
  restarting?: boolean;
  permissionRequired?: boolean;
  installerOpened?: boolean;
}
interface NativeUpdater {
  status(): Promise<UpdaterStatus>;
  check(): Promise<{ envelope: UpdateEnvelope; manifest: UpdateManifest }>;
  installWeb(options: { envelope: UpdateEnvelope }): Promise<InstallResult>;
  installApk(options: { envelope: UpdateEnvelope }): Promise<InstallResult>;
  notifyReady(options: { webBuild: number }): Promise<void>;
  addListener(
    event: "progress",
    listener: (progress: UpdateProgress) => void,
  ): Promise<{ remove(): Promise<void> }>;
}
const updater = registerPlugin<NativeUpdater>("PianoUpdater");
const HISTORY_KEY = "qinban-release-history-v1";

export function nativeUpdatesAvailable() {
  return Boolean(UPDATE_FEED_URL) && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function browserUpdatesAvailable() {
  return (
    Boolean(UPDATE_FEED_URL) && !Capacitor.isNativePlatform() &&
    ["https:", "http:"].includes(globalThis.location?.protocol)
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid update information format.");
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error("Invalid update build number.");
  return value as number;
}
function release(value: unknown): ReleaseEntry {
  const row = object(value);
  if (
    typeof row.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(row.version) ||
    typeof row.releaseDate !== "string" ||
    !Number.isFinite(Date.parse(row.releaseDate)) ||
    !Array.isArray(row.notes) ||
    !row.notes.every((note) => typeof note === "string")
  )
    throw new Error("Incomplete release version or notes.");
  return {
    version: row.version,
    versionCode: integer(row.versionCode, 1),
    webBuild: integer(row.webBuild),
    releaseDate: row.releaseDate,
    notes: row.notes as string[],
    ...(typeof row.title === "string" ? { title: row.title } : {}),
  };
}
function artifact(value: unknown): UpdateArtifact {
  const row = object(value);
  if (row.version !== undefined && (typeof row.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(row.version)))
    throw new Error("Incomplete release version or notes.");
  let url: URL;
  try {
    url = new URL(row.url as string);
  } catch {
    throw new Error("Invalid update download URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Update artifacts require HTTPS.");
  if (typeof row.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(row.sha256))
    throw new Error("Missing valid update artifact checksum.");
  if (
    row.inherit !== undefined &&
    (!Array.isArray(row.inherit) ||
      !row.inherit.every((name) => name === "audio"))
  )
    throw new Error("Invalid update resource configuration.");
  return {
    ...(typeof row.version === "string" ? { version: row.version } : {}),
    url: url.href,
    sha256: row.sha256.toLowerCase(),
    size: integer(row.size, 1),
    ...(row.inherit ? { inherit: row.inherit as string[] } : {}),
  };
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  const raw = object(value);
  if (raw.schemaVersion !== 1 || raw.appId !== "com.qinban.piano")
    throw new Error("This update is not for Xiaoma Piano.");
  if (
    typeof raw.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.generatedAt)) ||
    !Array.isArray(raw.releases)
  )
    throw new Error("Incomplete update manifest.");
  const latest = object(raw.latest);
  const parsed: UpdateRelease = {
    ...release(latest),
    minNativeVersionCode: integer(latest.minNativeVersionCode, 1),
    ...(latest.web ? { web: artifact(latest.web) } : {}),
    ...(latest.apk ? { apk: artifact(latest.apk) } : {}),
  };
  if (!parsed.web && !parsed.apk)
    throw new Error("No downloadable artifact is available for this release.");
  return {
    schemaVersion: 1,
    appId: "com.qinban.piano",
    generatedAt: raw.generatedAt,
    latest: parsed,
    releases: raw.releases.map(release),
  };
}

function decodeBase64(value: string) {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

export async function verifyUpdateEnvelope(
  value: unknown,
  publicKeyPem: string,
): Promise<UpdateManifest> {
  const envelope = object(value);
  if (
    typeof envelope.payload !== "string" ||
    typeof envelope.signature !== "string"
  )
    throw new Error("Missing update signature.");
  if (envelope.payload.length > 512 * 1024 || envelope.signature.length > 8192)
    throw new Error("Update envelope exceeds the size limit.");
  if (!globalThis.crypto?.subtle)
    throw new Error("This browser cannot verify update signatures. Use a supported browser.");
  try {
    const keyBytes = decodeBase64(
      publicKeyPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
    );
    const key = await crypto.subtle.importKey(
      "spki",
      keyBytes,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const payload = decodeBase64(envelope.payload);
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64(envelope.signature),
      payload,
    );
    if (!verified) throw new Error("Update signature verification failed. Try again later.");
    return parseUpdateManifest(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)),
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Update")) throw error;
    throw new Error("Update information failed integrity verification.");
  }
}

export type UpdateAction = "web" | "browser" | "apk" | "current" | "unavailable";
export function updateAction(
  status: UpdaterStatus,
  manifest: UpdateManifest,
  native = nativeUpdatesAvailable(),
): UpdateAction {
  const latest = manifest.latest;
  if (!native) {
    if (latest.webBuild <= status.webBuild) return "current";
    return browserUpdatesAvailable() ? "browser" : "unavailable";
  }
  if (
    latest.versionCode > status.nativeVersionCode ||
    latest.minNativeVersionCode > status.nativeVersionCode
  )
    return latest.apk ? "apk" : "unavailable";
  if (latest.webBuild > status.webBuild && latest.web) return "web";
  if (latest.webBuild > status.webBuild)
    return latest.apk ? "apk" : "unavailable";
  return "current";
}

export function updaterStatus(): Promise<UpdaterStatus> {
  return nativeUpdatesAvailable()
    ? updater.status()
    : Promise.resolve({
        nativeVersion: APP_VERSION,
        nativeVersionCode: NATIVE_CODE,
        webBuild: WEB_BUILD,
        webVersion: APP_VERSION,
        pending: false,
        updateUrl: UPDATE_FEED_URL,
      });
}

/** Distinguish older content releases that shared an installation version. */
export function releaseVersionLabel(entry: ReleaseEntry, history: ReleaseEntry[]): string {
  const repeated = history.some(row => row.version === entry.version && row.webBuild !== entry.webBuild);
  if (!repeated) return entry.version;
  return `${entry.version}${entry.version.includes("+") ? "." : "+"}${entry.webBuild}`;
}

export function releaseHistory(manifest?: UpdateManifest): ReleaseEntry[] {
  let cached: ReleaseEntry[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    if (Array.isArray(raw)) cached = raw.map(release);
  } catch {
    /* Bundled release notes remain available without storage or connectivity. */
  }
  const rows: ReleaseEntry[] = localReleases.map((row) => ({
    version: row.version,
    versionCode: row.versionCode,
    webBuild: row.webBuild,
    releaseDate: row.date,
    notes: row.changes,
    title: row.title,
  }));
  const merged = new Map<string, ReleaseEntry>();
  for (const row of [
    ...rows,
    ...cached,
    ...(manifest?.releases ?? []),
    ...(manifest ? [manifest.latest] : []),
  ]) {
    const id = `${row.versionCode}:${row.webBuild}`;
    merged.set(id, { ...merged.get(id), ...row });
  }
  return [...merged.values()].sort(
    (a, b) => b.webBuild - a.webBuild || b.versionCode - a.versionCode,
  );
}

export async function checkForUpdates() {
  if (!UPDATE_FEED_URL) throw new Error("No update feed configured for this source edition.");
  let result: { envelope: UpdateEnvelope; manifest: UpdateManifest };
  if (nativeUpdatesAvailable()) {
    const checked = await updater.check();
    result = { ...checked, manifest: parseUpdateManifest(checked.manifest) };
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(UPDATE_FEED_URL, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Update server returned ${response.status}.`);
      const envelope = (await response.json()) as UpdateEnvelope;
      const keyResponse = await fetch(appAsset("/updates/qinban_update_public.pem"), {
        cache: "no-cache",
        signal: controller.signal,
      });
      if (!keyResponse.ok) throw new Error("Unable to read the update verification key.");
      result = {
        envelope,
        manifest: await verifyUpdateEnvelope(
          envelope,
          await keyResponse.text(),
        ),
      };
    } catch (error) {
      if (error instanceof Error && /update|verification|Xiaoma Piano/i.test(error.message))
        throw error;
      throw new Error("Unable to connect to the update server. Check your connection.");
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(releaseHistory(result.manifest).slice(0, 100)),
    );
  } catch {
    /* A full local store must not prevent checking an update. */
  }
  return result;
}

export async function confirmUpdateMounted() {
  if (nativeUpdatesAvailable())
    await updater.notifyReady({ webBuild: WEB_BUILD });
}
/** Confirm after React commits, independently of animation frames or visibility.
 * Older installed shells require a JSON Long (build > 2^31 - 1). New releases
 * retain that wire format, while transient bridge failures get bounded retries. */
export function startUpdateConfirmation(
  onFailure: (error: unknown) => void = (error) =>
    console.warn("Unable to confirm mounted Xiaoma Piano update", error),
) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const confirm = async () => {
    try {
      await confirmUpdateMounted();
    } catch (error) {
      if (cancelled) return;
      if (++attempts >= 8) onFailure(error);
      else timer = setTimeout(() => void confirm(), Math.min(1000, attempts * 250));
    }
  };
  if (nativeUpdatesAvailable()) void confirm();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
export function listenUpdateProgress(
  callback: (event: UpdateProgress) => void,
) {
  return updater.addListener("progress", callback);
}
export function installUpdate(kind: "web" | "apk", envelope: UpdateEnvelope) {
  if (!nativeUpdatesAvailable())
    return Promise.reject(
      new Error("Web previews cannot install native updates."),
    );
  return kind === "web"
    ? updater.installWeb({ envelope })
    : updater.installApk({ envelope });
}
