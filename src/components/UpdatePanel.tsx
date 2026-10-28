import "../data/componentMessages";
import { useI18n } from "../lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { Modal } from "./Modal";
import { updateMessage } from "../lib/scoreUI";
import {
  APP_VERSION,
  WEB_BUILD,
  browserUpdatesAvailable,
  checkForUpdates,
  installUpdate,
  listenUpdateProgress,
  nativeUpdatesAvailable,
  releaseHistory,
  releaseVersionLabel,
  updateAction,
  updaterStatus,
  type UpdateEnvelope,
  type UpdateManifest,
  type UpdateProgress,
  type UpdaterStatus,
} from "../lib/updates";

const sizeText = (bytes: number) =>
  Number.isFinite(bytes)
    ? `${(Math.max(0, bytes) / 1024 / 1024).toFixed(1)} MB`
    : "—";

export function UpdatePanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const native = nativeUpdatesAvailable();
  const browser = browserUpdatesAvailable();
  const mounted = useRef(true);
  const generation = useRef(0);
  const installKind = useRef<"web" | "apk" | null>(null);
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [checked, setChecked] = useState<{
    envelope: UpdateEnvelope;
    manifest: UpdateManifest;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [permissionRequired, setPermissionRequired] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [message, setMessage] =
    useState(native || browser ? "Updates have not been checked. Release history is available offline." : "No update feed is configured for this unpublished source edition.");
  const [error, setError] = useState(false);
  const entries = useMemo(() => releaseHistory(checked?.manifest), [checked]);
  const currentRelease = entries.find(
    (entry) => entry.webBuild === (status?.webBuild ?? WEB_BUILD),
  );
  const action =
    checked && status ? updateAction(status, checked.manifest, native) : null;

  useEffect(() => {
    mounted.current = true;
    void updaterStatus()
      .then((value) => {
        if (mounted.current) setStatus(value);
      })
      .catch(() => {
        if (mounted.current) {
          setError(true);
          setMessage(
            "Unable to read the installed version. Check again; offline release history is still available.",
          );
        }
      });
    const listener = native
      ? listenUpdateProgress((event) => {
          if (mounted.current && installKind.current === event.kind)
            setProgress(event);
        }).catch(() => null)
      : null;
    return () => {
      mounted.current = false;
      generation.current++;
      void listener?.then((handle) => handle?.remove());
    };
  }, [native]);

  async function check() {
    const request = ++generation.current;
    setChecking(true);
    setError(false);
    setChecked(null);
    setProgress(null);
    setPermissionRequired(false);
    setMessage("Connecting to the update server and verifying update details…");
    try {
      const current = await updaterStatus();
      const result = await checkForUpdates();
      if (!mounted.current || request !== generation.current) return;
      setStatus(current);
      setChecked(result);
      const next = updateAction(current, result.manifest, native);
      setMessage(
        next === "current"
          ? "Check complete. You have the current version."
          : next === "unavailable"
            ? "A new version is available, but no compatible update file is provided for this device yet."
            : next === "web"
              ? "A content update is available. Updating restarts Xiaoma Piano and keeps your practice history."
              : next === "browser"
                ? "A web update is available. Choose Refresh to update. Your practice history is kept, and no installer is needed."
                : native
                ? "This version requires an Android app update. Follow the system prompts to install it over your current app; practice history is kept."
                : "Visit the Xiaoma Piano website for the latest release for this platform.",
      );
    } catch (problem) {
      if (!mounted.current || request !== generation.current) return;
      setError(true);
      setMessage(
        `Update check failed: ${(problem as Error).message || "Check your connection and try again."}`,
      );
    } finally {
      if (mounted.current && request === generation.current) setChecking(false);
    }
  }

  async function install(kind: "web" | "apk") {
    if (!checked || installing || checking) return;
    installKind.current = kind;
    setInstalling(true);
    setProgress(null);
    setError(false);
    setMessage(
      kind === "web"
        ? "Downloading the content update. Keep this page open."
        : "Downloading the Android installer…",
    );
    let restarting = false;
    try {
      const result = await installUpdate(kind, checked.envelope);
      if (!mounted.current) return;
      if (kind === "web") {
        restarting = true;
        setMessage("The update is ready. Restarting Xiaoma Piano…");
      } else if (result?.permissionRequired) {
        setPermissionRequired(true);
        setMessage("Xiaoma Piano is not yet allowed to install apps. Choose Continue installation and grant permission in Android.");
      } else {
        setPermissionRequired(false);
        setMessage(
          "The Android installer is open. Install over your current app, then reopen Xiaoma Piano; your practice history is kept.",
        );
      }
    } catch (problem) {
      if (mounted.current) {
        setError(true);
        setMessage(`Update not completed: ${(problem as Error).message || "Please try again."}`);
      }
    } finally {
      if (mounted.current && !restarting) setInstalling(false);
    }
  }

  const percent = Number.isFinite(progress?.percent)
    ? Math.max(0, Math.min(100, progress!.percent))
    : 0;
  const phase =
    progress?.phase === "verifying"
      ? "Verifying files"
      : progress?.phase === "applying"
        ? "Applying update"
        : "Downloading";
  return (
    <Modal
      title={t("Version and updates")}
      wide
      dismissible={!installing}
      onClose={() => {
        if (!installing) onClose();
      }}
    >
      <div className="update-current">
        <div>
          <span className="section-kicker">{t("Current content version")}</span>
          <strong>{currentRelease ? releaseVersionLabel(currentRelease, entries) : status?.webVersion ?? APP_VERSION}</strong>
          <small>
            {currentRelease
              ? t("Released {date}", { date: currentRelease.releaseDate })
              : t("Content running on this device")}
          </small>
        </div>
        {native ? (
          <div>
            <span className="section-kicker">{t("Installed Android version")}</span>
            <strong>{status?.nativeVersion ?? t("Loading…")}</strong>
            <small>
              {status?.pending
                ? t("Confirming the updated content has started")
                : t("Local practice data is kept")}
            </small>
          </div>
        ) : (
          <p>
            {browser
              ? t("The browser and iPhone/iPad Home Screen app update by refreshing, with no installer needed.")
              : t("Visit the Xiaoma Piano website for the latest release for this platform.")}
          </p>
        )}
      </div>
      {native && (
        <p className="update-help">
          {t("Choose Check for updates, then Update and restart to apply a content update within the app. No installer is needed, and your practice history is kept.")}
        </p>
      )}
      <div
        className={`update-message ${error ? "update-error" : ""}`}
        role="status"
      >
        {(checking || installing) && (
          <LoaderCircle size={17} className="loading-spinner" />
        )}
        {!error && !checking && action === "current" && <Check size={17} />}
        <p>{updateMessage(message)}</p>
      </div>
      {progress && (
        <div className="update-download" aria-live="polite">
          <div>
            <span>{t(phase)}</span>
            <strong>{Math.round(percent)}%</strong>
          </div>
          <progress aria-label={t("Update download progress")} max={100} value={percent} />
          <small>
            {sizeText(progress.received)} / {sizeText(progress.total)}
          </small>
        </div>
      )}
      <div className="update-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={checking || installing || (!native && !browser)}
          onClick={() => void check()}
        >
          <RefreshCw size={16} />
          {checking ? t("Checking…") : checked ? t("Check again") : t("Check for updates")}
        </button>
        {native && (action === "web" || action === "apk") && (
          <button
            type="button"
            className="primary-button"
            disabled={checking || installing}
            onClick={() => void install(action)}
          >
            <Download size={16} />
            {action === "web"
              ? t("Update and restart")
              : permissionRequired
                ? t("Continue installation")
                : t("Install Android update")}
          </button>
        )}
        {action === "browser" && (
          <button
            type="button"
            className="primary-button"
            disabled={checking || installing}
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} />
            {t("Refresh to update")}
          </button>
        )}
        {!native && !browser && action === "unavailable" && (
          <a
            className="secondary-button"
            href={import.meta.env.VITE_PIANO_WEBSITE || undefined}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={16} />
            {t("Open the Xiaoma Piano website")}
          </a>
        )}
      </div>
      {checked && action !== "current" && (
        <section className="update-latest">
          <h3>
            {t("New version {version}", {
              version: action === "apk" ? checked.manifest.latest.apk?.version ?? checked.manifest.latest.version : releaseVersionLabel(checked.manifest.latest, entries),
            })}
          </h3>
          <small>{checked.manifest.latest.releaseDate}</small>
          <ul>
            {checked.manifest.latest.notes.map((note, index) => (
              <li key={index}>{t(note)}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="update-history">
        <h3>{t("Release history")}</h3>
        <p className="muted">
          {t("Local release history is available offline. A successful check adds published releases.")}
        </p>
        {entries.map((entry) => (
          <details
            key={`${entry.versionCode}:${entry.webBuild}`}
            open={entry.webBuild === (status?.webBuild ?? WEB_BUILD)}
          >
            <summary>
              <strong>{releaseVersionLabel(entry, entries)}</strong>
              <span>{t(entry.title ?? "Version update")}</span>
              <small>{entry.releaseDate}</small>
              {entry.webBuild === (status?.webBuild ?? WEB_BUILD) && (
                <b>{t("Current content")}</b>
              )}
            </summary>
            <ul>
              {entry.notes.map((note, index) => (
                <li key={index}>{t(note)}</li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </Modal>
  );
}
