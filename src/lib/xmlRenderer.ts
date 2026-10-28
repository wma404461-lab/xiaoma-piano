import type { Song } from "../types";
import { countWork, timeWork } from "./diagnostics";
import { createScoreNoteNavigator } from "./scoreNoteNavigation";
import { prepareStaffSvg } from "./staffAppearance";
import { EngravedPageCache } from "./engravedPageCache";

const engravedPages = new EngravedPageCache();
export const preloadXmlRenderer = () => import("opensheetmusicdisplay");

/** Keep only a few already engraved pages; a page turn moves its DOM instead of engraving again. */
export function createXmlRenderer(
  song: Song,
  getPageXml: (first: number, count: number) => string,
  width: number,
  onSelect: (measure: number, beat: number) => void,
  onPlayFrom?: (measure: number, beat: number) => void,
) {
  const navigation = createScoreNoteNavigator(onSelect, onPlayFrom);
  const cache = new Map<string, HTMLDivElement>();
  const pending = new Map<string, Promise<HTMLDivElement>>();
  const stages = new Set<HTMLDivElement>();
  let disposed = false;
  const bindNavigation = (container: HTMLDivElement) => {
    for (const element of container.querySelectorAll<SVGGElement>(
      "[data-navigation-id]",
    )) {
      const measure = Number(element.dataset.noteMeasure),
        beat = Number(element.dataset.noteBeat);
      const noteId = element.dataset.navigationId!;
      element.onclick = (event) =>
        navigation.click(measure, beat, noteId, event);
      element.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        navigation.reset();
        if (event.shiftKey && event.key === "Enter" && onPlayFrom)
          onPlayFrom(measure, beat);
        else onSelect(measure, beat);
      };
    }
  };
  const remember = (key: string, container: HTMLDivElement) => {
    cache.set(key, container);
    for (const [oldKey, oldContainer] of cache) {
      if (cache.size <= 4) break;
      if (
        oldKey !== key &&
        !oldContainer.parentElement?.classList.contains("xml-staff")
      ) {
        cache.delete(oldKey);
        oldContainer.remove();
      }
    }
  };
  const get = (first: number, count: number): Promise<HTMLDivElement> => {
    const key = `${first}:${count}`,
      cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      countWork("xmlPageCacheHits");
      return Promise.resolve(cached);
    }
    const existing = pending.get(key);
    if (existing) return existing;
    const markup = engravedPages.get(song, width, first, count);
    if (markup) {
      const container = document.createElement("div");
      container.innerHTML = markup;
      container.dataset.firstMeasure = String(first);
      container.style.width = "100%";
      container.style.height = "100%";
      bindNavigation(container);
      remember(key, container);
      countWork("xmlEngravingReuseHits");
      return Promise.resolve(container);
    }
    const task = (async () => {
      const { OpenSheetMusicDisplay } = await preloadXmlRenderer();
      if (disposed) throw new Error("The score has been closed");
      const stage = document.createElement("div"),
        container = document.createElement("div");
      stage.setAttribute("aria-hidden", "true");
      Object.assign(stage.style, {
        position: "fixed",
        left: "-100000px",
        top: "0",
        width: `${width}px`,
        height: "300px",
        visibility: "hidden",
        pointerEvents: "none",
      });
      container.style.width = `${width}px`;
      container.dataset.firstMeasure = String(first);
      stage.appendChild(container);
      document.body.appendChild(stage);
      stages.add(stage);
      try {
        const display = new OpenSheetMusicDisplay(container, {
          backend: "svg",
          autoResize: false,
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawPartNames: false,
          drawPartAbbreviations: false,
          renderSingleHorizontalStaffline: true,
          drawMeasureNumbers: true,
        });
        display.setLogLevel("error");
        // Let the surrounding paper supply the theme; a white SVG page would flash during swaps.
        display.EngravingRules.PageBackgroundColor = "transparent";
        const endLayout = timeWork("xmlPageLayout");
        await display.load(getPageXml(first, count));
        if (disposed) throw new Error("The score has been closed");
        display.render();
        prepareStaffSvg(container);
        endLayout();
        display.GraphicSheet.MeasureList.forEach((staffMeasures, local) => {
          staffMeasures.forEach((measure, staff) => {
            const hand = staff === 0 ? "right" : "left";
            for (const entry of measure.staffEntries)
              for (const voice of entry.graphicalVoiceEntries)
                for (const graphical of voice.notes) {
                  const low = graphical as unknown as {
                    getSVGGElement?: () => SVGGElement;
                    sourceNote: { Pitch?: { getHalfTone: () => number } };
                  };
                  const element = low.getSVGGElement?.();
                  if (!element) continue;
                  const beat = entry.relInMeasureTimestamp.RealValue * 4,
                    halfTone = low.sourceNote.Pitch?.getHalfTone();
                  const candidates =
                    song.measures[first + local]?.[hand].filter(
                      (n) => Math.abs(n.beat - beat) < 0.001,
                    ) ?? [];
                  const original =
                    candidates.find((n) =>
                      halfTone === undefined
                        ? !n.pitches.length
                        : n.pitches.includes(halfTone + 12) ||
                          n.pitches.includes(halfTone),
                    ) ?? candidates[0];
                  if (original) {
                    element.setAttribute("data-note-id", original.id);
                    element.setAttribute("data-note-hand", hand);
                    if (halfTone !== undefined)
                      element.setAttribute(
                        "data-note-pitch",
                        String(
                          original.pitches.includes(halfTone + 12)
                            ? halfTone + 12
                            : halfTone,
                        ),
                      );
                  }
                  element.style.cursor = "pointer";
                  const noteId =
                    original?.id ??
                    `${first + local}:${staff}:${beat}:${halfTone ?? "rest"}`;
                  element.setAttribute("tabindex", "0");
                  element.setAttribute("role", "button");
                  element.dataset.noteMeasure = String(first + local);
                  element.dataset.noteBeat = String(beat);
                  element.dataset.navigationId = noteId;
                }
          });
        });
        const svg = container.querySelector("svg");
        if (svg) {
          const bounds = (svg as SVGSVGElement).getBBox(),
            padding = 14;
          svg.setAttribute(
            "viewBox",
            `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`,
          );
          svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          svg.style.width = "100%";
          svg.style.height = "100%";
          svg.style.backgroundColor = "transparent";
          svg.setAttribute("role", "img");
          svg.setAttribute(
            "aria-label",
            `${song.title} full staff score, measures ${first + 1}–${first + count}`,
          );
          container.style.width = "100%";
          container.style.height = "100%";
          let parent = svg.parentElement;
          while (parent && parent !== container) {
            parent.style.height = "100%";
            parent.style.width = "100%";
            parent.style.minHeight = "0";
            parent.style.backgroundColor = "transparent";
            parent = parent.parentElement;
          }
        }
        engravedPages.set(song, width, first, count, container.innerHTML);
        bindNavigation(container);
        remember(key, container);
        return container;
      } finally {
        stage.remove();
        stages.delete(stage);
      }
    })();
    pending.set(key, task);
    void task.finally(() => pending.delete(key)).catch(() => {});
    return task;
  };
  return {
    get,
    dispose: () => {
      disposed = true;
      cache.forEach((container) => container.remove());
      cache.clear();
      stages.forEach((stage) => stage.remove());
      stages.clear();
    },
  };
}
