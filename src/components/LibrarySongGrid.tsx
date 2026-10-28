import { useEffect, useRef } from "react";
import { useI18n } from "../lib/i18n";

export const LIBRARY_BATCH_SIZE = 24;

/** Fetch no scores here. Mount the next batch of light cards near the viewport. */
export function LibrarySongGrid({
  children,
  shown,
  total,
  onMore,
}: {
  children: React.ReactNode;
  shown: number;
  total: number;
  onMore: () => void;
}) {
  const { t } = useI18n();
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!more.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onMore();
      },
      { rootMargin: "300px" },
    );
    observer.observe(more.current);
    return () => observer.disconnect();
  }, [shown, total, onMore]);
  return (
    <>
      <div className="song-grid library-grid">{children}</div>
      {shown < total && (
        <button
          ref={more}
          type="button"
          className="secondary-button library-load-more"
          onClick={onMore}
        >
          {t("Show more pieces")} · {shown} / {total}
        </button>
      )}
    </>
  );
}
