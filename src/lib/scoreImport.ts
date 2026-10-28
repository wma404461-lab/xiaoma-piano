import type { Measure, ScoreNote, Song } from "../types";
import { strFromU8 } from "fflate";
import { unpackScoreArchive } from "./scoreArchive";
import { midiToMusicXml } from "./midiScore";
import { readScoreTempo } from "./scoreTempo";
import { TempoTimeline } from "./tempo";

const natural: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const keys = [
  "Cb",
  "Gb",
  "Db",
  "Ab",
  "Eb",
  "Bb",
  "F",
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
];
const minorKeys = [
  "Abm",
  "Ebm",
  "Bbm",
  "Fm",
  "Cm",
  "Gm",
  "Dm",
  "Am",
  "Em",
  "Bm",
  "F#m",
  "C#m",
  "G#m",
  "D#m",
  "A#m",
];
export function parseMusicXml(xml: string, template?: Song): Song {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.tagName !== "score-partwise"
  )
    throw new Error("Import a valid MusicXML (score-partwise) piano score.");
  const parts = Array.from(doc.querySelectorAll("score-partwise > part"));
  if (!parts.length || parts.length > 4)
    throw new Error("Piano note scores support up to four parts or two staves.");
  const id = template?.id ?? `import-${crypto.randomUUID()}`;
  const measures: Measure[] = [];
  let firstMeter = 4,
    firstSignature = "4/4",
    firstKey = "C",
    bpm = template?.tempo ?? 80;
  const activeTies = new Map<string, ScoreNote>();
  for (const [pi, part] of parts.entries()) {
    let divisions = 1,
      barBeats = 4,
      signature = "4/4";
    let key = "C";
    const bars = Array.from(part.children).filter(
      (n) => n.tagName === "measure",
    );
    bars.forEach((bar, mi) => {
      let cursor = 0,
        onset = 0,
        maxEnd = 0;
      const measure =
        measures[mi] ??
        (measures[mi] = {
          right: [],
          left: [],
          duration: barBeats,
          signature,
          key,
        });
      for (const [ni, node] of Array.from(bar.children).entries()) {
        if (node.tagName === "attributes") {
          divisions = Number(
            node.querySelector("divisions")?.textContent ?? divisions,
          );
          const time = node.querySelector("time");
          if (time) {
            const numerator = Number(time.querySelector("beats")?.textContent),
              denominator = Number(
                time.querySelector("beat-type")?.textContent,
              );
            barBeats = (numerator * 4) / denominator;
            signature = `${numerator}/${denominator}`;
          }
          if (mi === 0 && pi === 0) {
            firstMeter = barBeats;
            firstSignature = signature;
          }
          const keyNode = node.querySelector("key");
          if (keyNode) {
            const family =
              keyNode.querySelector("mode")?.textContent === "minor"
                ? minorKeys
                : keys;
            key =
              family[
                Number(keyNode.querySelector("fifths")?.textContent ?? 0) + 7
              ] ?? "C";
            if (mi === 0 && pi === 0) firstKey = key;
            if (pi === 0) measure.key = key;
          }
          if (pi === 0) measure.duration = barBeats;
          measure.signature = signature;
          continue;
        }
        const duration =
          Number(node.querySelector("duration")?.textContent ?? 0) / divisions;
        if (node.tagName === "backup") {
          cursor -= duration;
          continue;
        }
        if (node.tagName === "forward") {
          cursor += duration;
          maxEnd = Math.max(maxEnd, cursor);
          continue;
        }
        if (node.tagName === "direction") {
          continue;
        }
        if (
          node.tagName !== "note" ||
          node.querySelector("grace") ||
          duration <= 0
        )
          continue;
        if (!node.querySelector("chord")) onset = cursor;
        const hand =
          parts.length > 1
            ? pi === 0
              ? "right"
              : "left"
            : Number(node.querySelector("staff")?.textContent ?? 1) > 1
              ? "left"
              : "right";
        const pitch = node.querySelector("pitch");
        const midi = pitch
          ? (Number(pitch.querySelector("octave")?.textContent) + 1) * 12 +
            natural[pitch.querySelector("step")?.textContent ?? "C"] +
            Number(pitch.querySelector("alter")?.textContent ?? 0)
          : null;
        if (midi !== null && (midi < 21 || midi > 108))
          throw new Error("The score includes notes outside the standard 88-key piano range.");
        const stop = !!node.querySelector('tie[type="stop"]'),
          start = !!node.querySelector('tie[type="start"]');
        const note: ScoreNote = {
          key,
          spellings:
            midi !== null && pitch
              ? {
                  [midi]: {
                    step: pitch.querySelector("step")?.textContent ?? "C",
                    alter: Number(
                      pitch.querySelector("alter")?.textContent ?? 0,
                    ),
                    octave: Number(pitch.querySelector("octave")?.textContent),
                  },
                }
              : undefined,
          id: `${id}-${mi}-${hand}-${pi}-${ni}`,
          measure: mi,
          hand,
          beat: Math.max(0, onset),
          beats: duration,
          pitches: midi === null ? [] : [midi],
          attackPitches: midi !== null && !stop ? [midi] : [],
          playDurations: midi !== null && !stop ? { [midi]: duration } : {},
        };
        const tuplet = node.querySelector(
          "time-modification > actual-notes",
        )?.textContent;
        if (tuplet) note.tuplet = tuplet;
        measure[hand].push(note);
        if (midi !== null) {
          const tieKey = `${pi}-${hand}-${node.querySelector("voice")?.textContent ?? 1}-${midi}`;
          if (stop) {
            const previous = activeTies.get(tieKey);
            if (previous) previous.playDurations![midi] += duration;
          }
          if (start && !stop) activeTies.set(tieKey, note);
          if (stop && !start) activeTies.delete(tieKey);
        }
        if (!node.querySelector("chord")) cursor += duration;
        maxEnd = Math.max(maxEnd, onset + duration);
      }
      if (bar.getAttribute("implicit") === "yes" && maxEnd > 0)
        measure.duration =
          pi === 0 ? maxEnd : Math.max(measure.duration ?? 0, maxEnd);
    });
  }
  if (!measures.length || measures.length > 5000)
    throw new Error("The score is empty or too large. Split it into individual movements and import again.");
  measures.forEach((m) => {
    m.right.sort((a, b) => a.beat - b.beat);
    m.left.sort((a, b) => a.beat - b.beat);
  });
  const title =
    template?.title ??
    doc.querySelector("work-title")?.textContent ??
    doc.querySelector("movement-title")?.textContent ??
    "Imported score";
  const durations = measures.map(bar => bar.duration ?? firstMeter);
  const tempoMap = readScoreTempo(doc, durations, bpm);
  bpm = tempoMap[0].bpm;
  return {
    ...template,
    notationVersion: 2,
    id,
    title,
    subtitle: template?.subtitle ?? "My note score",
    composer:
      doc.querySelector('creator[type="composer"]')?.textContent ??
      template?.composer ??
      "Personal import",
    category: template?.category ?? "My scores",
    level: template?.level ?? 2,
    tempo: bpm,
    tempoMap,
    meter: firstMeter,
    signature: firstSignature,
    key: firstKey,
    color: template?.color ?? "sage",
    motif: template?.motif ?? "arch",
    description:
      "A personal note score. Playback follows its tempo markings; adjust parts and overall practice speed.",
    skills: ["Personal import", "Note score"],
    measures,
    xml,
    onlineUrl: undefined,
    scoreAsset: undefined,
    measureCount: measures.length,
    durationSeconds: new TempoTimeline(tempoMap, bpm).secondsAt(durations.reduce((sum, beats) => sum + beats, 0)),
  };
}
export function upgradeScoreNotation(song: Song): Song {
  if (!song.xml || (song.notationVersion === 2 && song.tempoMap)) return song;
  const source = parseMusicXml(song.xml, song);
  if (song.notationVersion === 2)
    return { ...song, tempo: source.tempo, tempoMap: source.tempoMap, durationSeconds: source.durationSeconds };
  const measures = song.measures.map((measure, mi) => {
    const sourceMeasure = source.measures[mi];
    if (!sourceMeasure) return measure;
    const withSpelling = (hand: "right" | "left") =>
      measure[hand].map((note) => {
        const spellings = { ...note.spellings };
        let key = note.key ?? sourceMeasure.key ?? song.key;
        for (const pitch of note.pitches) {
          const matches = sourceMeasure[hand].filter((candidate) =>
            candidate.pitches.includes(pitch),
          );
          const exact = matches.find(
            (candidate) => Math.abs(candidate.beat - note.beat) < 1e-5,
          );
          const unique = new Set(
            matches.map((candidate) =>
              JSON.stringify([candidate.spellings?.[pitch], candidate.key]),
            ),
          );
          const original =
            exact ?? (unique.size === 1 ? matches[0] : undefined);
          if (original?.spellings?.[pitch]) {
            spellings[pitch] = original.spellings[pitch];
            key = original.key ?? key;
          }
        }
        return { ...note, spellings, key };
      });
    return {
      ...measure,
      key: sourceMeasure.key,
      right: withSpelling("right"),
      left: withSpelling("left"),
    };
  });
  return { ...song, key: source.key, notationVersion: 2, measures, tempo: source.tempo, tempoMap: source.tempoMap, durationSeconds: source.durationSeconds };
}
export async function readScoreFile(
  file: File,
  template?: Song,
): Promise<Song> {
  if (file.size > 15 * 1024 * 1024)
    throw new Error("Import a single-piece file smaller than 15 MB.");
  let xml: string;
  if (/\.midi?$/i.test(file.name)) {
    xml = midiToMusicXml(
      await file.arrayBuffer(),
      template?.title ?? file.name.replace(/\.[^.]+$/, ""),
    );
  } else if (/\.mxl$/i.test(file.name)) {
    const archive = unpackScoreArchive(new Uint8Array(await file.arrayBuffer()));
    const container = archive["META-INF/container.xml"];
    if (!container) throw new Error("The MXL file has no score directory.");
    const doc = new DOMParser().parseFromString(
      strFromU8(container),
      "application/xml",
    );
    const fullPath = doc.querySelector("rootfile")?.getAttribute("full-path");
    if (!fullPath || !archive[fullPath])
      throw new Error("No note-based score was found in the MXL file.");
    xml = strFromU8(archive[fullPath]);
  } else if (/\.(musicxml|xml)$/i.test(file.name)) xml = await file.text();
  else
    throw new Error(
      "Choose a MIDI, MusicXML, XML or MXL file. PDFs and images cannot currently be converted into notes.",
    );
  const song = parseMusicXml(xml, template);
  if (!template && song.title === "Imported score")
    song.title = file.name.replace(/\.[^.]+$/, "");
  return song;
}
