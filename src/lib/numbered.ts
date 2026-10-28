import type { SpelledPitch } from "../types";
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_KEYS = [
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
const MINOR_KEYS = [
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
export function normalizeKey(key: string) {
  return key
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/\s/g, "")
    .replace(/(?:minor|\u5c0f\u8c03)$/i, "m")
    .replace(/(?:major|\u5927\u8c03)$/i, "");
}
export function numberedTonic(key: string) {
  const normalized = normalizeKey(key),
    minor = MINOR_KEYS.indexOf(normalized);
  return minor < 0 ? normalized : MAJOR_KEYS[minor];
}
export function numberedKeyLabel(key: string) {
  const normalized = normalizeKey(key),
    tonic = numberedTonic(normalized);
  const printable = (value: string) =>
    value.replace(/#/g, "♯").replace(/b/g, "♭");
  return `1 = ${printable(tonic)}${normalized.endsWith("m") ? ` · ${printable(normalized.slice(0, -1))} minor` : ""}`;
}
const contexts = new Map<
  string,
  { reference: number; letter: number; preferFlats: boolean }
>();
function context(key: string) {
  let value = contexts.get(key);
  if (!value) {
    const tonic = numberedTonic(key),
      match = /^([A-G])([#b]?)$/.exec(tonic) ?? ["C", "C", ""];
    const letter = LETTERS.indexOf(match[1]),
      alteration = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
    value = {
      reference: 60 + NATURAL[letter] + alteration,
      letter,
      preferFlats:
        MAJOR_KEYS.indexOf(tonic) >= 0 && MAJOR_KEYS.indexOf(tonic) < 7,
    };
    contexts.set(key, value);
  }
  return value;
}
/** Explain the black keys already included by 1=tonic, without adding accidentals. */
export function numberedBlackKeyGuide(key: string) {
  const { reference, letter } = context(key);
  const mappings = NATURAL.flatMap((offset, degree) => {
    const midi = reference + offset;
    if (NATURAL.includes(midi % 12)) return [];
    const absoluteLetter = letter + degree;
    const alteration =
      midi -
      (60 + NATURAL[absoluteLetter % 7] + 12 * Math.floor(absoluteLetter / 7));
    const accidental =
      alteration > 0 ? "♯".repeat(alteration) : "♭".repeat(-alteration);
    return [`${degree + 1}=${LETTERS[absoluteLetter % 7]}${accidental}`];
  });
  return mappings.length
    ? `Black keys in this key: ${mappings.join(" · ")} (included in the key signature)`
    : "In this key, 1–7 use white keys; ♯/♭ mark accidentals";
}
const mod = (value: number, base: number) => ((value % base) + base) % base;
function result(degree: number, alteration: number, octave: number) {
  return {
    digit: `${alteration > 0 ? "♯".repeat(alteration) : "♭".repeat(-alteration)}${degree + 1}`,
    octave,
  };
}
export function numberedPitch(
  midi: number,
  key: string,
  spelling?: SpelledPitch,
) {
  const { reference, letter, preferFlats } = context(key);
  const sourceLetter = spelling ? LETTERS.indexOf(spelling.step) : -1;
  if (
    spelling &&
    sourceLetter >= 0 &&
    (spelling.octave + 1) * 12 + NATURAL[sourceLetter] + spelling.alter === midi
  ) {
    const diatonic = spelling.octave * 7 + sourceLetter - (4 * 7 + letter);
    const degree = mod(diatonic, 7),
      octave = Math.floor(diatonic / 7);
    return result(
      degree,
      midi - (reference + octave * 12 + NATURAL[degree]),
      octave,
    );
  }
  // MIDI has no enharmonic spelling. Use the key's sharp/flat family, while
  // MusicXML retains its original letter, alteration, and written octave.
  const relative = mod(midi - reference, 12),
    exact = NATURAL.indexOf(relative);
  if (exact >= 0) return result(exact, 0, Math.floor((midi - reference) / 12));
  const degree = preferFlats
    ? NATURAL.findIndex((value) => value > relative)
    : NATURAL.findIndex((value) => value > relative) - 1;
  const alteration = relative - NATURAL[degree];
  return result(
    degree,
    alteration,
    Math.round((midi - reference - NATURAL[degree] - alteration) / 12),
  );
}
