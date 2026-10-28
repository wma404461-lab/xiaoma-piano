import "../data/componentMessages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Search,
  X,
} from "lucide-react";
import { appAsset } from "../lib/assets";
import { useI18n } from "../lib/i18n";

type ScanDoc = {
  id: string;
  title: string;
  pages: number;
  dir: string;
  sourceType?: string;
  note?: string;
};
type ScanCollection = {
  id: string;
  title: string;
  kind: "piano" | "orchestral" | string;
  docs: ScanDoc[];
};
type ScanIndex = { version: number; collections: ScanCollection[] };

const pad = (page: number) => String(page).padStart(3, "0");

export function ScoreLibrary() {
  const { locale } = useI18n();
  const en = locale === "en";
  const [index, setIndex] = useState<ScanIndex | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<{
    doc: ScanDoc;
    collection: ScanCollection;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(appAsset("scans/index.json"), { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ScanIndex>;
      })
      .then((data) => {
        if (!cancelled) setIndex(data);
      })
      .catch(() => {
        if (!cancelled)
          setError(en ? "Sheet library is unavailable." : "Sheet library is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [en]);

  const { piano, orchestral, docs, pages } = useMemo(() => {
    const collections = index?.collections ?? [];
    const keyword = query.trim().toLowerCase();
    const matches = (doc: ScanDoc) =>
      !keyword || `${doc.title} ${doc.pages}`.toLowerCase().includes(keyword);
    const filter = (list: ScanCollection[]) =>
      list
        .map((collection) => ({
          ...collection,
          docs: collection.docs.filter(matches),
        }))
        .filter((collection) => collection.docs.length);
    return {
      piano: filter(collections.filter((item) => item.kind !== "orchestral")),
      orchestral: filter(
        collections.filter((item) => item.kind === "orchestral"),
      ),
      docs: collections.reduce((sum, item) => sum + item.docs.length, 0),
      pages: collections.reduce(
        (sum, item) =>
          sum + item.docs.reduce((count, doc) => count + doc.pages, 0),
        0,
      ),
    };
  }, [index, query]);

  const openDoc = useCallback((doc: ScanDoc, collection: ScanCollection) => {
    if (!doc.pages || !doc.dir) return;
    setActive({ doc, collection });
    window.scrollTo({ top: 0 });
  }, []);

  if (active)
    return (
      <ScanViewer
        doc={active.doc}
        collectionTitle={active.collection.title}
        onClose={() => setActive(null)}
      />
    );

  const renderCollection = (collection: ScanCollection, note?: string) => (
    <section className="scan-collection" key={collection.id}>
      <div className="scan-collection-head">
        <h2>{collection.title}</h2>
        <span>
          {collection.docs.length} {en ? "scores" : "scores"} ·{" "}
          {collection.docs.reduce((sum, doc) => sum + doc.pages, 0)}{" "}
          {en ? "pages" : "pages"}
        </span>
      </div>
      {note && <p className="scan-collection-note">{note}</p>}
      <div className="scan-grid">
        {collection.docs.map((doc) =>
          doc.pages ? (
            <button
              type="button"
              key={doc.id}
              className="scan-card"
              onClick={() => openDoc(doc, collection)}
              aria-label={`${en ? "Open" : "Open"} ${doc.title}`}
            >
              <span className="scan-cover">
                <img
                  src={appAsset(`scans/${doc.dir}/cover.webp`)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </span>
              <span className="scan-title">{doc.title}</span>
              <span className="scan-meta">
                {doc.pages} {en ? "pages" : "pages"}
              </span>
            </button>
          ) : (
            <div key={doc.id} className="scan-card scan-card-disabled">
              <span className="scan-cover scan-cover-empty">
                <BookMarked size={28} />
              </span>
              <span className="scan-title">{doc.title}</span>
              <span className="scan-meta">
                {doc.note || (en ? "Not available" : "Not available")}
              </span>
            </div>
          ),
        )}
      </div>
    </section>
  );

  return (
    <div className="page-body scan-library-page">
      <div className="eyebrow">{en ? "Sheet library" : "Sheet library"}</div>
      <div className="library-heading">
        <div>
          <h1>{en ? "Every sheet, in one place" : "Every sheet, in one place"}</h1>
          <p>
            {en
              ? "Scanned scores from the collection: browse page by page and zoom in to read. These pages are view-only, not playable notes."
              : "Browse scanned pages and zoom in to read. Image-only scores do not support playback or guided practice."}
          </p>
        </div>
        <span className="library-count">
          {docs}
          <small>
            {en ? ` scores · ${pages} pages` : ` scores · ${pages} pages`}
          </small>
        </span>
      </div>
      <div className="library-tools">
        <label className="search-field">
          <Search size={20} />
          <input
            type="search"
            placeholder={en ? "Search a score or collection" : "Search a score or collection"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label={en ? "Clear search" : "Clear search"}
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
        </label>
      </div>
      {error && <p className="scan-error">{error}</p>}
      {!index && !error && (
        <p className="scan-loading">
          {en ? "Loading…" : "Loading the score index…"}
        </p>
      )}
      {index && docs === 0 && (
        <p className="scan-loading" role="status">
          No scanned scores are bundled in this source edition. Open Library to
          practise the original exercise or import your own note score.
        </p>
      )}
      {piano.map((collection) => renderCollection(collection))}
      {orchestral.length > 0 && (
        <div className="scan-orchestral">
          <div className="eyebrow">{en ? "Full scores" : "Full scores"}</div>
          {orchestral.map((collection) =>
            renderCollection(
              collection,
              en
                ? "Orchestral full scores are kept for reading only; they are not piano practice material."
                : "These orchestral full scores are for reading, not piano practice.",
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ScanViewer({
  doc,
  collectionTitle,
  onClose,
}: {
  doc: ScanDoc;
  collectionTitle: string;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const en = locale === "en";
  const [page, setPage] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const total = doc.pages;
  const src = appAsset(`scans/${doc.dir}/${pad(page)}.webp`);

  const go = useCallback(
    (delta: number) => {
      setPage((current) => Math.min(total, Math.max(1, current + delta)));
    },
    [total],
  );

  useEffect(() => {
    setPage(1);
    setZoomed(false);
  }, [doc.dir]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [go, onClose]);

  useEffect(() => {
    if (page < total) {
      const next = new Image();
      next.src = appAsset(`scans/${doc.dir}/${pad(page + 1)}.webp`);
    }
    scroller.current?.scrollTo({ top: 0, left: 0 });
  }, [doc.dir, page, total]);

  return (
    <div
      className="scan-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={doc.title}
    >
      <header className="scan-viewer-bar">
        <button
          type="button"
          className="scan-close"
          onClick={onClose}
          aria-label={en ? "Close" : "Close"}
        >
          <X size={20} />
        </button>
        <div className="scan-viewer-title">
          <strong>{doc.title}</strong>
          <small>{collectionTitle}</small>
        </div>
        <span className="scan-counter">
          {page} / {total}
        </span>
        <button
          type="button"
          className="scan-zoom"
          aria-pressed={zoomed}
          onClick={() => setZoomed((value) => !value)}
          aria-label={
            zoomed ? (en ? "Fit width" : "Fit width") : en ? "Zoom in" : "Zoom in"
          }
        >
          {zoomed ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </header>
      <div
        className={`scan-stage${zoomed ? " is-zoomed" : ""}`}
        ref={scroller}
        onTouchStart={(event) => {
          const point = event.touches[0];
          touch.current = { x: point.clientX, y: point.clientY };
        }}
        onTouchEnd={(event) => {
          if (!touch.current) return;
          const point = event.changedTouches[0];
          const dx = point.clientX - touch.current.x;
          const dy = point.clientY - touch.current.y;
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4)
            go(dx < 0 ? 1 : -1);
          touch.current = null;
        }}
      >
        <img src={src} alt={`${doc.title} ${page}`} decoding="async" />
      </div>
      <footer className="scan-viewer-foot">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={page <= 1}
          aria-label={en ? "Previous page" : "Previous"}
        >
          <ChevronLeft size={20} />
        </button>
        <input
          type="range"
          min={1}
          max={total}
          value={page}
          aria-label={en ? "Page" : "Page"}
          onChange={(event) => setPage(Number(event.target.value))}
        />
        <button
          type="button"
          onClick={() => go(1)}
          disabled={page >= total}
          aria-label={en ? "Next page" : "Next"}
        >
          <ChevronRight size={20} />
        </button>
      </footer>
    </div>
  );
}
