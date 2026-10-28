import type { Song } from "../types";
import { countWork, timeWork } from "./diagnostics";

const preparedScores = new WeakMap<
  Song,
  { xml: string; pages: ReturnType<typeof prepareXmlPages> }
>();
/** A reopened cached score reuses its preparation; evicted scores can be collected. */
export function prepareSongXmlPages(song: Song) {
  const previous = preparedScores.get(song);
  if (previous && previous.xml === song.xml) {
    countWork("xmlSourceReuseHits");
    return previous.pages;
  }
  const finish = timeWork("xmlSourcePreparation");
  try {
    const pages = prepareXmlPages(song.xml!);
    preparedScores.set(song, { xml: song.xml!, pages });
    return pages;
  } finally {
    finish();
  }
}

/** Parse the complete score once; subsequent page turns only load a small XML slice. */
export function prepareXmlPages(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // Sound-only tempo directions from imports lack the required direction-type.
  // Keep their playback metadata as a measure-level sound; OSMD otherwise skips
  // the remainder of that measure, including its playable notes.
  doc.querySelectorAll("direction").forEach((direction) => {
    if (direction.querySelector("direction-type")) return;
    direction
      .querySelectorAll("sound")
      .forEach((sound) => direction.before(sound));
    direction.remove();
  });
  const serializer = new XMLSerializer();
  const header = Array.from(doc.documentElement.children)
    .filter((n) => n.tagName !== "part")
    .map((n) => serializer.serializeToString(n))
    .join("");
  const parts = Array.from(doc.querySelectorAll("score-partwise > part")).map(
    (part) => {
      const attributes = new Map<string, string>();
      const bars = Array.from(part.children)
        .filter((n) => n.tagName === "measure")
        .map((bar) => {
          Array.from(bar.querySelector("attributes")?.children ?? []).forEach(
            (n) =>
              attributes.set(
                `${n.tagName}-${n.getAttribute("number") ?? ""}`,
                serializer.serializeToString(n),
              ),
          );
          bar.querySelectorAll("print").forEach((n) => n.remove());
          const first = bar.cloneNode(true) as Element;
          first.querySelector("attributes")?.remove();
          const serialized = serializer.serializeToString(first);
          const prepared = {
            xml: serializer.serializeToString(bar),
            start: serialized.replace(
              /(<measure\b[^>]*>)/,
              `$1<attributes>${[...attributes.values()].join("")}</attributes>`,
            ),
          };
          // Mid-measure clef/key changes apply to the following page too.
          // Capture them after preparing this measure's starting attributes.
          Array.from(bar.querySelectorAll("attributes"))
            .slice(1)
            .forEach((group) => {
              Array.from(group.children).forEach((n) =>
                attributes.set(
                  `${n.tagName}-${n.getAttribute("number") ?? ""}`,
                  serializer.serializeToString(n),
                ),
              );
            });
          return prepared;
        });
      return { id: part.getAttribute("id")!, bars };
    },
  );
  const pages = new Map<string, string>();
  return (first: number, count: number) => {
    const key = `${first}-${count}`;
    const cached = pages.get(key);
    if (cached) {
      pages.delete(key);
      pages.set(key, cached);
      return cached;
    }
    if (!pages.has(key))
      pages.set(
        key,
        `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${header}${parts
          .map(
            (part) =>
              `<part id="${part.id}">${part.bars
                .slice(first, first + count)
                .map((bar, i) => (i ? bar.xml : bar.start))
                .join("")}</part>`,
          )
          .join("")}</score-partwise>`,
      );
    // Flipping through a long score must not retain another copy of every page.
    while (pages.size > 8) pages.delete(pages.keys().next().value!);
    return pages.get(key)!;
  };
}
