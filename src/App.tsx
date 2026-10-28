import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BookMarked,
  ChevronRight,
  Clock3,
  Heart,
  Home,
  Leaf,
  Music2,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  TrendingUp,
  Trophy,
  X,
  LoaderCircle,
  Upload,
} from "lucide-react";
import type { Page, PracticeRecord, Song, UserData } from "./types";
import { songs, songById } from "./data/songs";
import { dayKey, loadData, saveData } from "./lib/storage";
import { durationText, scoreDuration } from "./lib/music";
import { SongArt } from "./components/SongArt";
import { Modal } from "./components/Modal";
import { exportUserData } from "./lib/export";
import { listSavedScores, saveScore } from "./lib/scoreStore";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { ThemeToggle } from "./components/ThemeToggle";
import { AnimatedSegmented } from "./components/AnimatedSegmented";
import { AnimatedToast } from "./components/AnimatedToast";
import { SongLeaderboard } from "./components/SongLeaderboard";
import { UpdatePanel } from "./components/UpdatePanel";
import { APP_VERSION, startUpdateConfirmation } from "./lib/updates";
import { appAsset } from "./lib/assets";
import { loadScoreAsset } from "./lib/scoreResponse";
import { loadDownloadCatalog, mergeDownloadCatalog } from "./lib/downloadCatalog";
import { PracticeBoundary } from "./components/PracticeBoundary";
import { ScoreLibrary } from "./pages/ScoreLibrary";
import { ScoreCache } from "./lib/scoreCache";
import {initializeOfflineScores,mergeOfflineRows,registerOfflineCatalog,syncOfflinePractice} from "./lib/offlineScores";
import {
  DemoShuffleQueue,
  playNextDemo,
  sameFamilyPool,
  type DemoSettings,
} from "./lib/demoShuffle";
import {
  getSongPracticeHistory,
  retainPracticeRecords,
} from "./lib/practiceHistory";

import { translate, useI18n } from "./lib/i18n";
import { LanguageToggle } from "./components/LanguageToggle";
import { songTitle, songSubtitle, songComposer } from "./lib/songLocale";
import { ArtistAvatar } from "./components/ArtistAvatar";
import {
  artistName,
  groupLibraryArtists,
  libraryArtist,
} from "./lib/libraryArtists";
import "./data/appMessages";
import { traceInteraction } from "./lib/diagnostics";
import {
  LibrarySongGrid,
  LIBRARY_BATCH_SIZE,
} from "./components/LibrarySongGrid";
import { practiceSummary } from "./lib/practiceSummary";

const levels = ["Beginner", "Elementary", "Intermediate"];
const loadPractice = () => import("./pages/Practice");
const Practice = lazy(() =>
  loadPractice().then((module) => ({ default: module.Practice })),
);
const SongCard = memo(function SongCard({
  song,
  favorite,
  onFavorite,
  onOpen,
}: {
  song: Song;
  favorite: boolean;
  onFavorite: (id: string) => void;
  onOpen: (song: Song) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <article
      className="song-card"
      onPointerEnter={() => {
        void loadPractice();
      }}
    >
      <button
        type="button"
        className="song-cover-button"
        onClick={() => onOpen(song)}
        aria-label={t("Practise {title}", { title: songTitle(song, locale) })}
      >
        <SongArt song={song} />
      </button>
      <button
        type="button"
        className={`favorite-button ${favorite ? "saved" : ""}`}
        onClick={() => onFavorite(song.id)}
        aria-label={t(favorite ? "Remove {title} from favorites" : "Add {title} to favorites", {
          title: songTitle(song, locale),
        })}
      >
        <Heart size={18} fill={favorite ? "currentColor" : "none"} />
      </button>
      <div className="song-card-content">
        <button
          type="button"
          className="song-title-button"
          onClick={() => onOpen(song)}
        >
          <h3>{songTitle(song, locale)}</h3>
          <ArrowRight size={16} />
        </button>
        <p>{songComposer(song, locale)}</p>
        {song.editionLabel?.includes("OMR draft · review pending") && (
          <span className="score-draft-badge">{t("OMR draft · review pending")}</span>
        )}
        {song.editionLabel?.includes("MIDI") && (
          <span className="score-edition-badge">{t("MIDI piano arrangement")}</span>
        )}
        <div className="song-meta">
          <span className={`level level-${song.level}`}>
            <i />
            {t(levels[song.level - 1])}
          </span>
          {song.onlineUrl && !song.measures.length ? (
            <span className="online-score-badge">{t("Import notes to play")}</span>
          ) : (
            <>
              <span>
                {t("{count} measures", {
                  count: song.measureCount ?? song.measures.length,
                })}
              </span>
              <span>{durationText(scoreDuration(song))}</span>
            </>
          )}
        </div>
      </div>
    </article>
  );
});
export default function App() {
  const { locale, t } = useI18n();
  useEffect(() => {
    return startUpdateConfirmation();
  }, []);
  const [data, setData] = useState<UserData>(loadData);
  const completedRecords = useMemo(
    () => data.records.filter((record) => record.completed),
    [data.records],
  );
  const launch = useMemo(() => new URL(window.location.href).searchParams, []);
  const [page, setPage] = useState<Page>(() =>
    launch.get("page") === "library" ? "library" : "home",
  );
  const mainContent = useRef<HTMLElement>(null);
  const entry = useRef<{ page: Page; scroll: number; mainScroll: number }>({
    page,
    scroll: 0,
    mainScroll: 0,
  });
  const restoreScroll = useRef<{ window: number; main: number } | null>(null);
  useLayoutEffect(() => {
    if (
      page !== "practice" &&
      restoreScroll.current !== null &&
      mainContent.current
    ) {
      mainContent.current.scrollTop = restoreScroll.current.main;
      window.scrollTo({
        top: restoreScroll.current.window,
        behavior: "instant",
      });
      restoreScroll.current = null;
    }
  }, [page]);
  const exitPractice = useCallback(() => {
    restoreScroll.current = {
      window: entry.current.scroll,
      main: entry.current.mainScroll,
    };
    setPage(entry.current.page);
  }, []);
  const backAction = useRef<() => void>(() => {});
  const [song, setSong] = useState(() => songById(data.recentSongId));
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState("All pieces");
  const [libraryView, setLibraryView] = useState<"artists" | "categories">(
    "artists",
  );
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  useEffect(() => {
    if (page !== "library") return;
    const preload = () => {
      void loadPractice().catch(() => {});
      if (data.notation === "staff" || data.notation === "hybrid")
        void import("./lib/xmlRenderer")
          .then((module) => module.preloadXmlRenderer())
          .catch(() => {});
    };
    if ("requestIdleCallback" in window) {
      const idle = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback(idle);
    }
    const timeout = setTimeout(preload, 400);
    return () => clearTimeout(timeout);
  }, [page, data.notation]);
  const showArtist = (id: string) => {
    traceInteraction("openArtist", ".artist-detail-heading");
    setSelectedArtist(id);
    mainContent.current?.scrollTo({ top: 0, behavior: "instant" });
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const [level, setLevel] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [settings, setSettings] = useState(false);
  const [updates, setUpdates] = useState(false);
  const updatesFromSettings = useRef(false);
  const openUpdates = (fromSettings = false) => {
    updatesFromSettings.current = fromSettings;
    setSettings(false);
    setUpdates(true);
  };
  const closeUpdates = () => {
    setUpdates(false);
    setSettings(updatesFromSettings.current);
  };
  const [toast, setToast] = useState("");
  const [sessionStart, setSessionStart] = useState<number | undefined>();
  const [demoLaunch, setDemoLaunch] = useState<DemoSettings | undefined>();
  const [shuffleDemo, setShuffleDemo] = useState(() => {
    try {
      return localStorage.getItem("qinban-demo-shuffle") === "true";
    } catch {
      return false;
    }
  });
  const demoQueue = useRef(new DemoShuffleQueue());
  const changeShuffleDemo = (enabled: boolean) => {
    setShuffleDemo(enabled);
    try {
      localStorage.setItem("qinban-demo-shuffle", String(enabled));
    } catch {
      /* Optional preference. */
    }
  };
  const [sourceSong, setSourceSong] = useState<Song | null>(null);
  const [leaderboardSong, setLeaderboardSong] = useState<Pick<
    Song,
    "id" | "title"
  > | null>(null);
  backAction.current = () => {
    const dialogs =
      document.querySelectorAll<HTMLDialogElement>("dialog[open]");
    const topDialog = dialogs.item(dialogs.length - 1);
    if (topDialog) {
      topDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      return;
    }
    if (leaderboardSong) setLeaderboardSong(null);
    else if (sourceSong) setSourceSong(null);
    else if (updates) closeUpdates();
    else if (settings) setSettings(false);
    else if (page === "practice") exitPractice();
    else if (page !== "home") setPage("home");
    else void NativeApp.minimizeApp();
  };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener("backButton", () =>
      backAction.current(),
    );
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);
  const [loadingSong, setLoadingSong] = useState("");
  const loadGeneration = useRef(0);
  const loadingRequest = useRef<AbortController | null>(null);
  const loadedScores = useRef(new ScoreCache());
  const [importedSongs, setImportedSongs] = useState<Song[]>([]);
  const [downloadedSongs, setDownloadedSongs] = useState<Song[]>([]);
  useEffect(()=>{
    let request:AbortController|null=null;
    const refresh=()=>{
      if(document.hidden||request)return;
      request=new AbortController();const current=request;
      const timer=setTimeout(()=>current.abort(),15000);
      void loadDownloadCatalog(current.signal).then(setDownloadedSongs).catch(()=>{}).finally(()=>{clearTimeout(timer);if(request===current)request=null;});
    };
    refresh();const interval=setInterval(refresh,300000);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{request?.abort();clearInterval(interval);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  const fileInput = useRef<HTMLInputElement>(null);
  const importTarget = useRef<Song | undefined>(undefined);
  const allSongs = useMemo(() => {
    return mergeDownloadCatalog(songs,downloadedSongs,importedSongs);
  }, [importedSongs,downloadedSongs]);
  useEffect(()=>{syncOfflinePractice(data);registerOfflineCatalog(allSongs,(row,signal)=>loadScoreAsset(row.scoreAsset!,signal,Capacitor.isNativePlatform(),row.scoreSha256));},[allSongs,data.records]);
  useEffect(()=>{void initializeOfflineScores().then(()=>setDownloadedSongs(current=>mergeOfflineRows(current)));},[]);
  const allArtists = useMemo(() => groupLibraryArtists(allSongs), [allSongs]);
  const songsById = useMemo(
    () => new Map(allSongs.map((item) => [item.id, item])),
    [allSongs],
  );
  const searchText = useMemo(
    () =>
      new Map(
        allSongs.map((song) => [
          song.id,
          `${song.title} ${song.subtitle} ${song.composer} ${artistName(libraryArtist(song), "zh")} ${artistName(libraryArtist(song), "en")} ${songTitle(song, "en")} ${songComposer(song, "en")} ${song.skills.map((skill) => translate(skill, "en")).join(" ")} ${song.skills.join(" ")}`.toLowerCase(),
        ]),
      ),
    [allSongs],
  );
  const lookup = (id: string) =>
    songsById.get(id) ?? songById(id);
  const historyTitle = (id: string, original: string) => {
    const known = songsById.get(id);
    return known ? songTitle(known, locale) : original;
  };
  useEffect(
    () => () => {
      loadGeneration.current++;
      loadingRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    void listSavedScores()
      .then((rows) => {
        setImportedSongs((current) => [
          ...new Map(
            [...rows, ...current].map((song) => [song.id, song]),
          ).values(),
        ]);
        rows.forEach((row) => {
          if (!loadedScores.current.has(row.id))
            loadedScores.current.set(row.id, row);
        });
      })
      .catch(() => {});
  }, []);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!saveData(data))
      notify("Storage is full. Your practice records could not be saved. Export a backup first.");
  }, [data, notify]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  const favorite = useCallback(
    (id: string) =>
      setData((current) => ({
        ...current,
        favorites: current.favorites.includes(id)
          ? current.favorites.filter((n) => n !== id)
          : [...current.favorites, id],
      })),
    [],
  );
  const openSong = useCallback(
    async (
      requested: Song,
      measure?: number,
      demo?: { settings: DemoSettings; signal: AbortSignal },
    ): Promise<boolean> => {
      if (demo?.signal.aborted) return false;
      if (page !== "practice")
        traceInteraction(
          "openScoreReady",
          ".xml-staff svg, .complex-numbered .score-page-body > svg, .staff-render svg, .waterfall-score canvas",
        );
      const generation = ++loadGeneration.current;
      loadingRequest.current?.abort();
      loadingRequest.current = null;
      setLoadingSong("");
      if (page !== "practice")
        entry.current = {
          page,
          scroll: window.scrollY,
          mainScroll: mainContent.current?.scrollTop ?? 0,
        };
      setData((current) => ({
        ...current,
        recentSongIds: [
          requested.id,
          ...current.recentSongIds.filter((id) => id !== requested.id),
        ].slice(0, 8),
      }));
      if (requested.onlineUrl && !requested.measures.length) {
        setSourceSong(requested);
        return false;
      }
      const cached=loadedScores.current.get(requested.id);
      let target = cached&&(!requested.scoreSha256||cached.scoreSha256===requested.scoreSha256)?cached:requested;
      if (!target.measures.length && target.scoreAsset) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        demo?.signal.addEventListener("abort", abort, { once: true });
        loadingRequest.current = controller;
        setLoadingSong(target.title);
        try {
          target = await loadScoreAsset(
            target.scoreAsset,
            controller.signal,
            Capacitor.isNativePlatform(),
            target.scoreSha256,
          );
          if (target.id !== requested.id)
            throw new Error("The score could not be loaded. Please try again.");
          if (generation !== loadGeneration.current || demo?.signal.aborted)
            return false;
          if (!target.measures.length)
            throw new Error("This score has no playable notes.");
          loadedScores.current.set(target.id, target);
        } catch (error) {
          if (
            generation !== loadGeneration.current ||
            controller.signal.aborted
          )
            return false;
          if (!demo) notify((error as Error).message);
          return false;
        } finally {
          demo?.signal.removeEventListener("abort", abort);
          if (generation === loadGeneration.current) {
            setLoadingSong("");
            loadingRequest.current = null;
          }
        }
      }
      if (!target.measures.length) {
        notify("This score is not ready yet. Please choose another piece.");
        return false;
      }
      if (target.xml && (target.notationVersion !== 2 || !target.tempoMap)) {
        try {
          const { upgradeScoreNotation } = await import("./lib/scoreImport");
          if (generation !== loadGeneration.current || demo?.signal.aborted)
            return false;
          target = upgradeScoreNotation(target);
          loadedScores.current.set(target.id, target);
        } catch (error) {
          if (generation !== loadGeneration.current || demo?.signal.aborted)
            return false;
          notify((error as Error).message || "The score’s key signature could not be read.");
        }
      }
      const credit = {
        editionLabel: requested.editionLabel ?? target.editionLabel,
        originalScoreUrl: requested.originalScoreUrl ?? target.originalScoreUrl,
        composer: requested.composer || target.composer,
      };
      if (
        target.editionLabel !== credit.editionLabel ||
        target.originalScoreUrl !== credit.originalScoreUrl ||
        target.composer !== credit.composer
      )
        target = {
          ...target,
          ...credit,
        };
      loadedScores.current.set(target.id, target);
      if (generation !== loadGeneration.current || demo?.signal.aborted)
        return false;
      setDemoLaunch(demo?.settings);
      setSong(target);
      setSessionStart(measure);
      setPage("practice");
      setData((current) => ({ ...current, recentSongId: target.id }));
      return true;
    },
    [page, notify],
  );
  const nextDemo = (settings: DemoSettings, signal: AbortSignal) =>
    playNextDemo(
      demoQueue.current,
      sameFamilyPool(allSongs, song),
      song.id,
      signal,
      (next) => openSong(next, undefined, { settings, signal }),
    );
  const launchHandled = useRef(false);
  useEffect(() => {
    if (launchHandled.current) return;
    const launchUrl = new URL(window.location.href);
    const requestedId = launchUrl.searchParams.get("song");
    const id = requestedId === "pop-02-clayderman" ? "disk-d728ac38ae38936c" : requestedId;
    if (id !== requestedId && id) {
      launchUrl.searchParams.set("song", id);
      history.replaceState(history.state, "", launchUrl.href);
    }
    const requested = allSongs.find((item) => item.id === id);
    if (requested) { launchHandled.current=true; void openSong(requested); }
    else if(!id?.startsWith('disk-')) launchHandled.current=true;
  }, [openSong,allSongs]);
  function requestImport(template?: Song) {
    importTarget.current = template;
    fileInput.current?.click();
  }
  async function importSelected(file?: File) {
    if (!file) return;
    setLoadingSong(file.name);
    const generation = ++loadGeneration.current;
    loadingRequest.current?.abort();
    loadingRequest.current = null;
    const target = importTarget.current;
    try {
      const { readScoreFile } = await import("./lib/scoreImport");
      const imported = await readScoreFile(file, target);
      if (generation !== loadGeneration.current) return;
      await saveScore(imported);
      loadedScores.current.set(imported.id, imported);
      setImportedSongs((rows) => [
        ...rows.filter((s) => s.id !== imported.id),
        imported,
      ]);
      if (generation !== loadGeneration.current) return;
      setSourceSong(null);
      setLoadingSong("");
      notify("Your score is saved on this device and ready to play.");
      await openSong(imported);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      notify((error as Error).message);
    } finally {
      if (generation === loadGeneration.current) setLoadingSong("");
    }
  }
  const saveRecord = useCallback(
    (record: PracticeRecord) =>
      setData((current) => ({
        ...current,
        records: retainPracticeRecords([record, ...current.records]),
      })),
    [],
  );
  function openHistory(id: string, measure?: number) {
    const saved = songsById.get(id);
    if (saved) void openSong(saved, measure);
    else notify("The original score is unavailable. Import it again to practise. Your history is still saved.");
  }
  const today = dayKey(new Date());
  const { todaySeconds, totalSeconds, practiced, mistakes } = useMemo(
    () => practiceSummary(data.records, today),
    [data.records, today],
  );
  const progress = Math.min(100, (todaySeconds / (data.dailyGoal * 60)) * 100);
  const recommended = songs.filter((s) =>
    ["twinkle", "ode", "frere", "five-fingers"].includes(s.id),
  );
  const recentlyOpened = data.recentSongIds
    .map((id) => songsById.get(id))
    .filter((s): s is Song => !!s);
  const favoriteFilter = favoritesOnly ? data.favorites : undefined;
  const filtered = useMemo(
    () =>
      allSongs.filter(
        (s) =>
          (!deferredQuery ||
            searchText.get(s.id)?.includes(deferredQuery.toLowerCase())) &&
          (category === "All pieces" || s.category === category) &&
          (level === "all" || s.level === Number(level)) &&
          (!favoriteFilter || favoriteFilter.includes(s.id)),
      ),
    [allSongs, searchText, deferredQuery, category, level, favoriteFilter],
  );
  const artistGroups = useMemo(() => groupLibraryArtists(filtered), [filtered]);
  const recentRank = useMemo(() => {
    const rank = new Map<string, number>();
    data.recentSongIds.forEach((id, index) => {
      if (!rank.has(id)) rank.set(id, index);
    });
    let next = rank.size;
    for (let index = data.records.length - 1; index >= 0; index -= 1) {
      const id = data.records[index].songId;
      if (!rank.has(id)) rank.set(id, next++);
    }
    return rank;
  }, [data.recentSongIds, data.records]);
  // Practised pieces first (most recent first), then the catalogue order.
  const ordered = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          (recentRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (recentRank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      ),
    [filtered, recentRank],
  );
  const activeArtist = selectedArtist
    ? allArtists.find((item) => item.id === selectedArtist)
    : undefined;
  const visibleSongs = useMemo(
    () =>
      libraryView === "artists" && selectedArtist
        ? (artistGroups.find((artist) => artist.id === selectedArtist)?.songs ??
          [])
        : ordered,
    [libraryView, selectedArtist, artistGroups, ordered],
  );
  // Keep the batch on a practice round trip so the exact library scroll restores.
  const [libraryBatch, setLibraryBatch] = useState<{
    songs: Song[];
    count: number;
  }>({ songs: [], count: LIBRARY_BATCH_SIZE });
  const libraryCount =
    libraryBatch.songs === visibleSongs
      ? libraryBatch.count
      : LIBRARY_BATCH_SIZE;
  const showMoreSongs = useCallback(
    () =>
      setLibraryBatch((current) => ({
        songs: visibleSongs,
        count: Math.min(
          visibleSongs.length,
          (current.songs === visibleSongs
            ? current.count
            : LIBRARY_BATCH_SIZE) + LIBRARY_BATCH_SIZE,
        ),
      })),
    [visibleSongs],
  );
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    return d;
  });
  const recent = lookup(data.recentSongId);
  async function exportRecords() {
    try {
      await exportUserData(data, today);
      notify("Your practice records are ready to export.");
    } catch {
      notify("Export did not finish. Try again or check your device’s file sharing settings.");
    }
  }
  if (page === "practice")
    return (
      <PracticeBoundary onExit={exitPractice}>
        <Suspense
          fallback={
            <div className="loading-overlay" role="status">
              {t("Preparing your practice space…")}
            </div>
          }
        >
          <Practice
            key={`${song.id}-${sessionStart ?? 0}`}
            song={song}
            initialMeasure={sessionStart}
            initialMode={
              demoLaunch
                ? "listen"
                : song.id === launch.get("song") &&
                    launch.get("mode") === "game"
                  ? "game"
                  : song.id === launch.get("song") &&
                      launch.get("mode") === "wait"
                    ? "wait"
                    : song.id === launch.get("song") &&
                        launch.get("mode") === "rhythm"
                      ? "rhythm"
                      : "listen"
            }
            initialHands={
              demoLaunch
                ? demoLaunch.hands
                : song.id === launch.get("song") &&
                    launch.get("hands") === "right"
                  ? "right"
                  : "both"
            }
            notation={data.notation}
            onNotation={(notation) =>
              setData((current) => ({ ...current, notation }))
            }
            onExit={exitPractice}
            onSave={saveRecord}
            notify={notify}
            toast={toast}
            records={data.records}
            demoLaunch={demoLaunch}
            shuffleDemo={shuffleDemo}
            onShuffleDemo={changeShuffleDemo}
            onNextDemo={nextDemo}
          />
        </Suspense>
      </PracticeBoundary>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <a
            className="brand"
            href={import.meta.env.VITE_PIANO_WEBSITE || undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={t("Open the Xiaoma Piano website")}
          >
            <img src={appAsset("/icon.svg")} alt="" />
            <span>
              {t("Xiaoma Piano")}
              <small>XIAOMA PIANO</small>
            </span>
          </a>
          <div className="author-links">
            <a
              className="author-link author-bilibili"
              href="https://space.bilibili.com/517588057"
              target="_blank"
              rel="noreferrer noopener"
              title={t("Creator on Bilibili")}
              aria-label={t("Creator on Bilibili")}
            >
              <svg viewBox="0 0 32 32" aria-hidden="true" fill="none">
                <path
                  d="M9 4l4 4m10-4-4 4"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <rect
                  x="5"
                  y="8"
                  width="22"
                  height="18"
                  rx="4"
                  stroke="currentColor"
                  strokeWidth="2.2"
                />
                <path
                  d="m10 14 3 2m9-2-3 2"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <path
                  d="M13 21h6"
                  stroke="#e990b5"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </a>
            <a
              className="author-link author-douyin"
              href="https://v.douyin.com/aHI3XSG0ozs/"
              target="_blank"
              rel="noopener noreferrer"
              title={t("Creator on Douyin")}
              aria-label={t("Creator on Douyin")}
            >
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <path
                  d="M18 4h4c.4 3 2.1 4.9 5 5.4v4.1a11 11 0 0 1-5-1.6v10.2a7.3 7.3 0 1 1-7.3-7.3h1.2v4.2h-1.2a3.1 3.1 0 1 0 3.3 3.1Z"
                  fill="#25f4ee"
                  transform="translate(-1 -1)"
                />
                <path
                  d="M18 4h4c.4 3 2.1 4.9 5 5.4v4.1a11 11 0 0 1-5-1.6v10.2a7.3 7.3 0 1 1-7.3-7.3h1.2v4.2h-1.2a3.1 3.1 0 1 0 3.3 3.1Z"
                  fill="#fe2c55"
                  transform="translate(1 1)"
                />
                <path
                  d="M18 4h4c.4 3 2.1 4.9 5 5.4v4.1a11 11 0 0 1-5-1.6v10.2a7.3 7.3 0 1 1-7.3-7.3h1.2v4.2h-1.2a3.1 3.1 0 1 0 3.3 3.1Z"
                  fill="currentColor"
                />
              </svg>
            </a>
          </div>
        </div>
        <div className="sidebar-label">{t("Make room for music")}</div>
        <nav aria-label={t("Main navigation")}>
          {[
            { id: "home", title: t("Home"), icon: Home },
            { id: "library", title: t("Library"), icon: BookOpen },
            { id: "scores", title: t("Score library"), icon: BookMarked },
            { id: "progress", title: t("Progress"), icon: TrendingUp },
          ].map((item) => (
            <button
              type="button"
              key={item.id}
              aria-label={item.title}
              className={page === item.id ? "nav-active" : ""}
              onClick={() => setPage(item.id as Page)}
            >
              <item.icon size={20} />
              <span>{item.title}</span>
              {page === item.id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="offline-note">
            <Leaf size={18} />
            <span>
              {t("A quiet moment to practise")}
              <small>{t("Scores and progress stay here")}</small>
            </span>
          </div>
          <button
            type="button"
            className="settings-link"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={19} />
            <span>{t("Practice settings")}</span>
          </button>
          <div className="profile">
            <span className="avatar">{t("Q")}</span>
            <span>
              {t("My music time")}
              <small>{t("Every small step counts")}</small>
            </span>
          </div>
        </div>
      </aside>
      <main className="main-content" ref={mainContent}>
        <header className="topbar">
          <span>
            {page === "home"
              ? t("Home")
              : page === "library"
                ? t("Library")
                : page === "scores"
                  ? t("Score library")
                  : t("Progress")}
          </span>
          <span className="topbar-right">
            <button
              type="button"
              className="home-update-button"
              onClick={() => openUpdates()}
            >
              <RefreshCw size={16} />
              <span>{t("Software update")}</span>
            </button>
            <LanguageToggle />
            <ThemeToggle />
            <span className="topbar-local">
              <span className="offline-dot" />
              {t("On this device")}
            </span>
            <span className="topbar-date">
              {new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}
            </span>
          </span>
        </header>
        {page === "home" && (
          <div className="page-body home-page">
            <section className="welcome">
              <div className="eyebrow">
                <span />
                {t("A gift for piano lovers")}
              </div>
              <h1>
                {t("Make music part of your day")}
                <span>{locale === "en" ? "." : "。"}</span>
              </h1>
              <p>{t("Start with one note. Get a little closer to a melody you love.")}</p>
              <div className="welcome-flourish" aria-hidden="true">
                <Music2 size={74} strokeWidth={0.7} />
                <span>andante</span>
              </div>
            </section>
            <div className="home-feature-grid">
              <section className="continue-card">
                <div className="section-kicker">
                  {data.records.length
                    ? t("Pick up where you left off")
                    : t("Your first piece")}
                </div>
                <div className="continue-inner">
                  <SongArt song={recent} small />
                  <div>
                    <h2>{songTitle(recent, locale)}</h2>
                    <p>{songSubtitle(recent, locale)}</p>
                    <div className="continue-tags">
                      <span>{t(levels[recent.level - 1])}</span>
                      <span>
                        {recent.key.endsWith("m")
                          ? t("{key} minor", { key: recent.key.slice(0, -1) })
                          : t("{key} major", { key: recent.key })}
                      </span>
                      <span>
                        {t("{count} measures", {
                          count: recent.measureCount ?? recent.measures.length,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="continue-footer">
                  <span>
                    <Music2 size={15} />
                    {data.records.length
                      ? t("Keep going, one small step at a time")
                      : t("Find the melody with your right hand")}
                  </span>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => openSong(recent)}
                  >
                    {data.records.length ? t("Continue") : t("Start practice")}
                    <ArrowRight size={17} />
                  </button>
                </div>
              </section>
              <section className="daily-card">
                <div className="daily-heading">
                  <span className="section-kicker">{t("Today’s music time")}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSettings(true)}
                  >
                    {t("Edit goal")}
                  </button>
                </div>
                <div className="daily-value">
                  {Math.floor(todaySeconds / 60)}
                  <span>/ {t("{count} min", { count: data.dailyGoal })}</span>
                  <Leaf size={32} strokeWidth={1.2} />
                </div>
                <div
                  className="goal-track"
                  role="progressbar"
                  aria-label={t("Today’s practice goal")}
                  aria-valuenow={Math.round(progress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${progress}%` }} />
                </div>
                <p>
                  {progress >= 100
                    ? t("You reached today’s goal. Take a moment to hear your progress.")
                    : todaySeconds > 0
                      ? t("You’ve made a start. Give this little section another try.")
                      : t("A short practice is enough. Give one phrase your full attention.")}
                </p>
              </section>
            </div>
            <section className="daily-route">
              <div className="route-title">
                <Sparkles size={19} />
                <span>{t("A gentle practice routine")}</span>
                <small>{t("At your own pace")}</small>
              </div>
              <div className="route-steps">
                <button
                  type="button"
                  onClick={() => openSong(songById("five-fingers"))}
                >
                  <span className="step-number">01</span>
                  <div>
                    <strong>{t("Warm up your fingers")}</strong>
                    <small>{t("C Major Steps · 2 min")}</small>
                  </div>
                  <ChevronRight size={18} />
                </button>
                <button type="button" onClick={() => openSong(recent)}>
                  <span className="step-number">02</span>
                  <div>
                    <strong>{t("Play a melody you love")}</strong>
                    <small>{t("Loop a few measures and take your time")}</small>
                  </div>
                  <ChevronRight size={18} />
                </button>
                <button type="button" onClick={() => setPage("progress")}>
                  <span className="step-number">03</span>
                  <div>
                    <strong>{t("See today’s progress")}</strong>
                    <small>{t("Celebrate a step, then choose the next")}</small>
                  </div>
                  <ChevronRight size={18} />
                </button>
              </div>
            </section>
            <section className="recommendations">
              <div className="section-heading">
                <div>
                  <h2>
                    {recentlyOpened.length
                      ? t("Recently opened")
                      : t("Start with a familiar melody")}
                  </h2>
                  <p>
                    {recentlyOpened.length
                      ? t("Your last eight pieces, with the most recent first.")
                      : t("Beginner pieces for a little achievement in every practice.")}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPage("library")}
                >
                  {t("Explore the library")}
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="song-grid">
                {(recentlyOpened.length ? recentlyOpened : recommended).map(
                  (s) => (
                    <SongCard
                      key={s.id}
                      song={s}
                      favorite={data.favorites.includes(s.id)}
                      onFavorite={favorite}
                      onOpen={openSong}
                    />
                  ),
                )}
              </div>
            </section>
            <footer className="page-footer">
              <Music2 size={15} />
              <span>{t("Take your time. Give every note room to land.")}</span>
              <button
                type="button"
                className="footer-version-link"
                title={t("View versions and updates")}
                onClick={() => openUpdates()}
              >
                {t("Xiaoma Piano · v")}
                {APP_VERSION}
              </button>
            </footer>
          </div>
        )}
        {page === "library" && (
          <div className="page-body library-page">
            <div className="eyebrow">{t("A little music, every day")}</div>
            <div className="library-heading">
              <div>
                <h1>{t("Find your next favorite piece")}</h1>
                <p>{t("Melodies and original exercises to read, listen to and practise in sections.")}</p>
              </div>
              <span className="library-count">
                {allSongs.length}
                <small>{t("pieces · including import entries")}</small>
              </span>
            </div>
            <div className="library-tools">
              <label className="search-field">
                <Search size={20} />
                <input
                  type="search"
                  placeholder={t("Search pieces, singers or composers")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    aria-label={t("Clear search")}
                    onClick={() => setQuery("")}
                  >
                    <X size={16} />
                  </button>
                )}
              </label>
              <label className="level-select">
                <span>{t("Level")}</span>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  <option value="all">{t("All levels")}</option>
                  <option value="1">{t("Beginner")}</option>
                  <option value="2">{t("Elementary")}</option>
                  <option value="3">{t("Intermediate")}</option>
                </select>
              </label>
              <button
                type="button"
                className={`filter-favorites ${favoritesOnly ? "selected" : ""}`}
                onClick={() => setFavoritesOnly((n) => !n)}
              >
                <Heart
                  size={17}
                  fill={favoritesOnly ? "currentColor" : "none"}
                />
                {t("Favorites")}
              </button>
              <button
                type="button"
                className="filter-favorites import-score-button"
                onClick={() => requestImport()}
              >
                <Upload size={17} />
                {t("Import a score")}
              </button>
            </div>
            <AnimatedSegmented
              value={libraryView}
              className="library-view-switch"
              role="tablist"
              aria-label={t("Library grouping")}
            >
              {(
                [
                  ["artists", "By artist"],
                  ["categories", "By category"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  role="tab"
                  data-segment-id={value}
                  aria-selected={libraryView === value}
                  className={libraryView === value ? "selected" : ""}
                  onClick={() => {
                    traceInteraction(
                      value === "artists" ? "showArtists" : "showScores",
                      value === "artists" ? ".artist-grid" : ".library-grid",
                    );
                    if (libraryView !== value)
                      setLibraryBatch({ songs: [], count: LIBRARY_BATCH_SIZE });
                    setLibraryView(value);
                    setSelectedArtist(null);
                    setCategory("All pieces");
                  }}
                >
                  {t(label)}
                </button>
              ))}
            </AnimatedSegmented>
            {libraryView === "categories" && (
              <AnimatedSegmented
                value={category}
                className="category-tabs"
                role="tablist"
                aria-label={t("Score categories")}
              >
                {[
                  "All pieces",
                  "Popular",
                  "Classical",
                  "Familiar melodies",
                  "Classical starters",
                  "Exercises",
                  "My scores",
                ].map((c) => (
                  <button
                    type="button"
                    key={c}
                    data-segment-id={c}
                    role="tab"
                    aria-selected={category === c}
                    className={category === c ? "selected" : ""}
                    onClick={() => setCategory(c)}
                  >
                    {t(c)}
                  </button>
                ))}
                <span>{t("{count} pieces", { count: filtered.length })}</span>
              </AnimatedSegmented>
            )}
            {libraryView === "artists" && activeArtist && (
              <div className="artist-detail-heading">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSelectedArtist(null)}
                >
                  <ArrowLeft size={16} />
                  {t("All artists")}
                </button>
                <ArtistAvatar artist={activeArtist} />
                <div>
                  <h2>{artistName(activeArtist, locale)}</h2>
                  <span>
                    {t("{count} pieces", { count: visibleSongs.length })}
                  </span>
                </div>
                {activeArtist.name === "Jay Chou" && (
                  <a
                    className="secondary-button artist-progress-link"
                    href={appAsset("jay-albums/index.html")}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Album conversion progress")}
                  </a>
                )}
              </div>
            )}
            {libraryView === "artists" &&
            !selectedArtist &&
            artistGroups.length ? (
              <div className="artist-grid" aria-label={t("Artists and musicians")}>
                {artistGroups.map((artist) => (
                  <button
                    type="button"
                    className="artist-card"
                    key={artist.id}
                    aria-label={t("View pieces by {name}", {
                      name: artistName(artist, locale),
                    })}
                    onClick={() => showArtist(artist.id)}
                  >
                    <ArtistAvatar artist={artist} />
                    <h2>{artistName(artist, locale)}</h2>
                    <span>
                      {t(artist.kind)} ·{" "}
                      {t("{count} pieces", { count: artist.songs.length })}
                    </span>
                  </button>
                ))}
              </div>
            ) : visibleSongs.length ? (
              <LibrarySongGrid
                shown={Math.min(libraryCount, visibleSongs.length)}
                total={visibleSongs.length}
                onMore={showMoreSongs}
              >
                {visibleSongs.slice(0, libraryCount).map((s) => (
                  <SongCard
                    key={s.id}
                    song={s}
                    favorite={data.favorites.includes(s.id)}
                    onFavorite={favorite}
                    onOpen={openSong}
                  />
                ))}
              </LibrarySongGrid>
            ) : (
              <div className="empty-state">
                <BookOpen size={40} strokeWidth={1} />
                <h2>
                  {favoritesOnly
                    ? t("Make room for your favorites")
                    : t("No matching pieces")}
                </h2>
                <p>
                  {favoritesOnly
                    ? t("Tap the heart on a piece to save it here.")
                    : t("Try another title or adjust your filters.")}
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setQuery("");
                    setCategory("All pieces");
                    setLevel("all");
                    setFavoritesOnly(false);
                    setSelectedArtist(null);
                  }}
                >
                  {t("View all pieces")}
                </button>
              </div>
            )}
            <div className="library-note">
              <Leaf size={17} />
              <span>
                {t(
                  "Pieces with notes are ready to listen to and practise. Change the tempo or focus on a short section.",
                )}
              </span>
            </div>
          </div>
        )}
        {page === "scores" && <ScoreLibrary />}
        {page === "progress" && (
          <div className="page-body progress-page">
            <div className="eyebrow">{t("Every small step counts")}</div>
            <div className="section-heading">
              <div>
                <h1>{t("Progress lives in every practice")}</h1>
                <p>{t("Your own practice journey, with no need to compare.")}</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={exportRecords}
              >
                <ArrowDownToLine size={17} />
                {t("Export records")}
              </button>
            </div>
            <div className="progress-stat-grid">
              <div>
                <Clock3 size={20} />
                <span>{t("Total practice")}</span>
                <strong>
                  {Math.floor(totalSeconds / 60)}
                  <small>{t("min")}</small>
                </strong>
              </div>
              <div>
                <Music2 size={20} />
                <span>{t("Pieces practised")}</span>
                <strong>
                  {practiced}
                  <small>{t("pieces")}</small>
                </strong>
              </div>
              <div>
                <Leaf size={20} />
                <span>{t("Attempts")}</span>
                <strong>
                  {data.records.length}
                  <small>{t("sessions")}</small>
                </strong>
              </div>
            </div>
            <section className="week-section">
              <div className="section-heading">
                <h2>{t("The last seven days")}</h2>
                <span className="muted">{t("Active practice time · min")}</span>
              </div>
              <div className="week-chart">
                {weekdays.map((d) => {
                  const seconds = data.records
                    .filter((r) => dayKey(new Date(r.date)) === dayKey(d))
                    .reduce((sum, r) => sum + r.activeSeconds, 0);
                  const maximum = Math.max(
                    data.dailyGoal * 60,
                    ...weekdays.map((day) =>
                      data.records
                        .filter((r) => dayKey(new Date(r.date)) === dayKey(day))
                        .reduce((sum, r) => sum + r.activeSeconds, 0),
                    ),
                  );
                  return (
                    <div className="week-day" key={dayKey(d)}>
                      <span>{Math.floor(seconds / 60)}</span>
                      <div className="week-bar-track">
                        <div
                          style={{ height: `${(seconds / maximum) * 100}%` }}
                        />
                      </div>
                      <small className={dayKey(d) === today ? "today" : ""}>
                        {dayKey(d) === today
                          ? t("Today")
                          : `${d.getMonth() + 1}/${d.getDate()}`}
                      </small>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="song-progress-section">
              <div className="section-heading">
                <h2>{t("Progress for each piece")}</h2>
                <span className="muted">{t("Scores · Accuracy · Combos")}</span>
              </div>
              {practiced ? (
                <div className="song-progress-grid">
                  {[
                    ...new Set(data.records.map((record) => record.songId)),
                  ].map((id) => {
                    const target = allSongs.find((item) => item.id === id) ?? {
                        id,
                        title:
                          data.records.find((record) => record.songId === id)
                            ?.title ?? id,
                      },
                      wait = getSongPracticeHistory(data.records, id, "wait"),
                      rhythm = getSongPracticeHistory(
                        data.records,
                        id,
                        "rhythm",
                      ),
                      waitBest = getSongPracticeHistory(
                        completedRecords,
                        id,
                        "wait",
                      ).best,
                      rhythmBest = getSongPracticeHistory(
                        completedRecords,
                        id,
                        "rhythm",
                      ).best;
                    if (!wait.attempts && !rhythm.attempts) return null;
                    return (
                      <button
                        type="button"
                        className="song-progress-card"
                        key={id}
                        onClick={() => setLeaderboardSong(target)}
                      >
                        <Trophy size={19} />
                        <div>
                          <strong>{songTitle(target, locale)}</strong>
                          <small>
                            {t("Wait mode {wait} pts · Rhythm mode {rhythm} pts", {
                              wait: waitBest.points?.toLocaleString() ?? "—",
                              rhythm:
                                rhythmBest.points?.toLocaleString() ?? "—",
                            })}
                          </small>
                          <small>
                            {t("{count} sessions · Completed-section scores and trends", {
                              count: wait.attempts + rhythm.attempts,
                            })}
                          </small>
                        </div>
                        <ChevronRight size={17} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">
                  {t("Your progress appears here after your first practice session.")}
                </p>
              )}
            </section>
            <div className="progress-columns">
              <section className="history-section">
                <div className="section-heading">
                  <h2>{t("Practice history")}</h2>
                  <span className="muted">{t("Last 20 attempts")}</span>
                </div>
                {data.records.length ? (
                  data.records.slice(0, 20).map((record) => (
                    <button
                      type="button"
                      className="history-row"
                      key={record.id}
                      onClick={() =>
                        openHistory(record.songId, record.fromMeasure)
                      }
                    >
                      {allSongs.some((item) => item.id === record.songId) ? (
                        <SongArt song={lookup(record.songId)} small />
                      ) : (
                        <Music2 size={28} />
                      )}
                      <div>
                        <strong>
                          {historyTitle(record.songId, record.title)}
                        </strong>
                        <small>
                          {new Date(record.date).toLocaleString(
                            locale === "en" ? "en-US" : "zh-CN",
                            {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}{" "}
                          · {record.tempo} BPM ·{" "}
                          {t(
                            record.mode === "wait"
                              ? "Wait for Notes"
                              : record.mode === "game"
                                ? "Piano game"
                                : record.mode === "listen"
                                  ? "Listen"
                                  : "Play in Time",
                          )}
                          {record.points !== undefined &&
                            t(" · {points} pts · Best combo {combo}", {
                              points: record.points,
                              combo: record.bestCombo ?? 0,
                            })}
                        </small>
                      </div>
                      <span>
                        {durationText(record.activeSeconds)}
                        <small>
                          {record.completed ? t("Section completed") : t("Free practice")}
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="empty-state compact">
                    <Music2 size={32} strokeWidth={1} />
                    <p>{t("Your first musical moment is waiting.")}</p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => openSong(recent)}
                    >
                      {t("Play a piece")}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </section>
              <section className="mistake-section">
                <div className="section-heading">
                  <h2>{t("Worth another try")}</h2>
                  <span className="muted">{t("Places to revisit")}</span>
                </div>
                {mistakes.length ? (
                  mistakes.map((m) => (
                    <button
                      type="button"
                      className="mistake-row"
                      key={`${m.songId}-${m.measure}`}
                      onClick={() => openHistory(m.songId, m.measure)}
                    >
                      <span className="measure-badge">
                        {String(m.measure + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{historyTitle(m.songId, m.title)}</strong>
                        <small>
                          {t("Measure {measure} · {count} recorded mistakes", {
                            measure: m.measure + 1,
                            count: m.count,
                          })}
                        </small>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="empty-state compact">
                    <Leaf size={32} strokeWidth={1} />
                    <p>
                      {t("Tricky places are saved here.")}
                      <br />
                      {t("Tap one to return to that measure.")}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </main>
      {settings && (
        <Modal
          title={t("Make practice your own")}
          onClose={() => setSettings(false)}
        >
          <p className="modal-description">
            {t("Your daily goal is a gentle reminder. Change it whenever you like.")}
          </p>
          <div className="setting-row">
            <span>{t("Dark mode")}</span>
            <ThemeToggle />
          </div>
          <label className="setting-row">
            <span>{t("Daily practice goal")}</span>
            <select
              value={data.dailyGoal}
              onChange={(e) =>
                setData((current) => ({
                  ...current,
                  dailyGoal: Number(e.target.value),
                }))
              }
            >
              {[5, 10, 15, 20, 30, 45, 60].map((n) => (
                <option key={n} value={n}>
                  {t("{count} min", { count: n })}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-row">
            <span>{t("Default notation")}</span>
            <select
              value={data.notation}
              onChange={(e) =>
                setData((current) => ({
                  ...current,
                  notation: e.target.value as UserData["notation"],
                }))
              }
            >
              <option value="hybrid">{t("Staff with number hints")}</option>
              <option value="staff">{t("Staff")}</option>
              <option value="numbered">{t("Numbered")}</option>
              <option value="beginner">{t("Easy numbers")}</option>
            </select>
          </label>
          <div className="settings-info">
            <Leaf size={20} />
            <p>
              {t(
                "Scores and practice records stay on this device. The microphone is used only when you enable it. Audio is never uploaded.",
              )}
            </p>
          </div>
          <button
            type="button"
            className="setting-row settings-update-link"
            onClick={() => openUpdates(true)}
          >
            <span>{t("Version and updates")}</span>
            <span>
              {t("Version {version}", { version: APP_VERSION })}{" "}
              <ChevronRight size={15} />
            </span>
          </button>
          <p className="audio-credit">
            Generated tone · Warm, Bright and Soft are original additive-synthesis
            practice tones generated during the build. No recorded piano samples
            or third-party soundfonts are bundled in this source edition.
          </p>
          <button
            type="button"
            className="primary-button full-width"
            onClick={() => setSettings(false)}
          >
            {t("Ready")}
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {updates && <UpdatePanel onClose={closeUpdates} />}
      <AnimatedToast>{toast ? t(toast) : null}</AnimatedToast>
      {loadingSong && (
        <Modal
          title={t("Loading {title}", {
            title: historyTitle(
              allSongs.find((item) => item.title === loadingSong)?.id ?? "",
              loadingSong,
            ),
          })}
          onClose={() => {
            loadGeneration.current++;
            loadingRequest.current?.abort();
            loadingRequest.current = null;
            setLoadingSong("");
          }}
        >
          <p className="modal-description">
            <LoaderCircle size={19} className="loading-spinner" />
            {t("Loading the full score. Just a moment.")}
          </p>
        </Modal>
      )}
      {sourceSong && (
        <Modal
          title={songTitle(sourceSong, locale)}
          onClose={() => setSourceSong(null)}
        >
          <p className="modal-description">
            {t("This entry does not have playable notes yet. Import a note-based score to listen and practise.")}
          </p>
          {sourceSong.sourceLabel && (
            <p className="source-note">
              {t("Score source: {source}", { source: t(sourceSong.sourceLabel) })}
            </p>
          )}
          <a
            className="primary-button full-width"
            style={{ marginBottom: 10, textDecoration: "none" }}
            href={sourceSong.onlineUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("View piano score")}
          </a>
          <button
            type="button"
            className="secondary-button full-width"
            onClick={() => requestImport(sourceSong)}
          >
            <Upload size={16} />
            {t("Import notes for this piece")}
          </button>
          <p className="source-note">
            {t(
              "Supports MIDI, MusicXML, XML and MXL. PDFs and images cannot currently be converted into playable notes.",
            )}
          </p>
        </Modal>
      )}
      {leaderboardSong && (
        <SongLeaderboard
          song={leaderboardSong}
          records={data.records}
          onClose={() => setLeaderboardSong(null)}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".musicxml,.xml,.mxl,.mid,.midi"
        aria-label={t("Import a note-based score file")}
        onChange={(e) => {
          void importSelected(e.currentTarget.files?.[0]);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}
