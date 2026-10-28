import type { TempoPoint } from "../types";

const units: Record<string, number> = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625 };
const number = (value: string | null | undefined) => Number(value?.trim());

/** MusicXML sound tempo is already quarter BPM. A printed metronome mark
 * needs its beat unit (including augmentation dots) converted to quarter BPM. */
function directionTempo(node: Element) {
  const sound = node.tagName === "sound" ? node : node.querySelector("sound");
  const explicit = number(sound?.getAttribute("tempo"));
  if (explicit > 0 && Number.isFinite(explicit)) return explicit;
  const mark = node.querySelector("metronome");
  if (!mark) return null;
  const perMinute = number(mark.querySelector("per-minute")?.textContent?.match(/\d+(?:\.\d+)?/)?.[0]);
  const unit = units[mark.querySelector("beat-unit")?.textContent?.trim() ?? "quarter"];
  const dots = mark.querySelectorAll("beat-unit-dot").length;
  const bpm = perMinute * unit * (2 - 2 ** (-dots));
  return bpm > 0 && Number.isFinite(bpm) ? bpm : null;
}

/** Read every tempo without changing notes, bar layout, hands or spelling. */
export function readScoreTempo(doc: Document, durations: number[], fallback: number): TempoPoint[] {
  const starts = [0];
  for (const duration of durations) starts.push(starts[starts.length - 1] + duration);
  const marks = new Map<number, { bpm: number; part: number }>();
  Array.from(doc.querySelectorAll("score-partwise > part")).forEach((part, pi) => {
    let divisions = 1;
    const bars = Array.from(part.children).filter(node => node.tagName === "measure");
    bars.forEach((bar, mi) => {
      let cursor = 0;
      for (const node of Array.from(bar.children)) {
        if (node.tagName === "attributes") {
          const value = number(node.querySelector("divisions")?.textContent);
          if (value > 0) divisions = value;
        } else if (node.tagName === "direction" || node.tagName === "sound") {
          const bpm = directionTempo(node);
          if (bpm === null || starts[mi] === undefined) continue;
          const sound = node.tagName === "sound" ? node : node.querySelector("sound");
          const soundOffset = sound?.querySelector("offset");
          const offset = soundOffset ?? Array.from(node.children).find(child => child.tagName === "offset" && child.getAttribute("sound") === "yes");
          const position = Math.max(0, starts[mi] + cursor + (number(offset?.textContent) || 0) / divisions);
          const beat = Math.round(position * 1e8) / 1e8;
          if (!marks.has(beat) || marks.get(beat)!.part === pi)
            marks.set(beat, { bpm, part: pi });
        } else {
          const duration = (number(node.querySelector("duration")?.textContent) || 0) / divisions;
          if (node.tagName === "backup") cursor -= duration;
          else if (node.tagName === "forward") cursor += duration;
          else if (node.tagName === "note" && !node.querySelector("chord") && !node.querySelector("grace")) cursor += duration;
        }
      }
    });
  });
  const result: TempoPoint[] = [{ beat: 0, bpm: marks.get(0)?.bpm ?? fallback }];
  for (const [beat, { bpm }] of [...marks].sort((a, b) => a[0] - b[0]))
    if (beat > 0 && bpm !== result[result.length - 1].bpm) result.push({ beat, bpm });
  return result;
}
