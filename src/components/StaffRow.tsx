import "../data/componentMessages";
import { useI18n } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import {
  Accidental,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from "vexflow/bravura";
import type { Hands, ScoreNote, Song } from "../types";
import { notationDuration, numberedPitch, vexKey } from "../lib/music";
import { useNoteHighlight } from "../lib/noteHighlight";
import { songTitle } from "../lib/songLocale";
import { prepareStaffSvg, useStaffAppearance } from "../lib/staffAppearance";
import { createScoreNoteNavigator } from "../lib/scoreNoteNavigation";
export default function StaffRow({
  song,
  first,
  count,
  hands,
  activeIds,
  statuses,
  hybrid,
  maxHeight,
  onSelect,
  onPlayFrom,
}: {
  song: Song;
  first: number;
  count: number;
  hands: Hands;
  activeIds: string[];
  statuses: Record<string, string>;
  hybrid: boolean;
  maxHeight: number;
  onSelect: (measure: number, beat?: number) => void;
  onPlayFrom?: (measure: number, beat?: number) => void;
}) {
  const { t, locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const playCallback = useRef(onPlayFrom);
  playCallback.current = onPlayFrom;
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0].contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = container.current;
    if (!element || !width) return;
    element.replaceChildren();
    const both = hands === "both";
    const height = both ? 246 : hybrid ? 168 : 138;
    const fittedHeight = Math.min(height, Math.max(24, maxHeight));
    const renderWidth = (width * height) / fittedHeight;
    const renderer = new Renderer(element, Renderer.Backends.SVG);
    renderer.resize(renderWidth, height);
    const context = renderer.getContext();
    const cellWidth = (renderWidth - 24) / count;
    const noteElements: { node: StaveNote; note: ScoreNote }[] = [];
    const navigation = createScoreNoteNavigator(
      (measure, beat) => callback.current(measure, beat),
      onPlayFrom
        ? (measure, beat) => playCallback.current?.(measure, beat)
        : undefined,
    );
    for (let m = 0; m < count; m++) {
      const measure = song.measures[first + m];
      if (!measure) continue;
      const x = 16 + cellWidth * m;
      const drawHand = (hand: "right" | "left", y: number) => {
        const stave = new Stave(x, y, cellWidth);
        if (m === 0)
          stave
            .addClef(hand === "right" ? "treble" : "bass")
            .addKeySignature(song.key)
            .addTimeSignature(`${song.meter}/4`);
        stave.setContext(context).draw();
        const notes = measure[hand].map((note) => {
          const duration = notationDuration(note);
          const keys = note.pitches.length
            ? note.pitches.map(vexKey)
            : [{ key: hand === "right" ? "b/4" : "d/3" }];
          const node = new StaveNote({
            clef: hand === "right" ? "treble" : "bass",
            keys: keys.map((p) => p.key),
            duration: duration.duration,
            dots: duration.dots,
          });
          keys.forEach((pitch, i) => {
            if (pitch.accidental)
              node.addModifier(new Accidental(pitch.accidental), i);
          });
          if (duration.dots) Dot.buildAndAttach([node], { all: true });
          node.setStyle({ fillStyle: "#292e2a", strokeStyle: "#292e2a" });
          noteElements.push({ node, note });
          return node;
        });
        const voice = new Voice({
          numBeats: song.meter,
          beatValue: 4,
        }).addTickables(notes);
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(context, stave);
        Beam.generateBeams(notes).forEach((beam) =>
          beam.setContext(context).draw(),
        );
        if (hybrid) {
          context.setFont("Arial", 12, "normal");
          notes.forEach((node, i) => {
            const original = measure[hand][i];
            const text = original.pitches.length
              ? original.pitches
                  .map((p) => {
                    const numbered = numberedPitch(
                      p,
                      original.key ?? measure.key ?? song.key,
                      original.spellings?.[p],
                    );
                    return `${numbered.digit}${numbered.octave > 0 ? "⁺".repeat(numbered.octave) : "₋".repeat(-numbered.octave)}`;
                  })
                  .join("·")
              : "0";
            context.fillText(text, node.getAbsoluteX() - 4, y + 121);
          });
        }
        return stave;
      };
      const top = drawHand(hands === "left" ? "left" : "right", 0);
      if (both) {
        const bottom = drawHand("left", 116);
        if (m === 0)
          new StaveConnector(top, bottom)
            .setType(StaveConnector.type.BRACE)
            .setContext(context)
            .draw();
      }
    }
    noteElements.forEach(({ node, note }) => {
      const svg = node.getSVGElement();
      if (svg) {
        svg.style.cursor = "pointer";
        svg.setAttribute("data-note-id", note.id);
        svg.setAttribute("data-note-hand", note.hand);
        node.noteHeads.forEach((head, index) => {
          const element = head.getSVGElement();
          if (element && note.pitches[index] !== undefined) {
            element.setAttribute("data-note-id", note.id);
            element.setAttribute("data-note-hand", note.hand);
            element.setAttribute(
              "data-note-pitch",
              String(note.pitches[index]),
            );
          }
        });
        svg.setAttribute("tabindex", "0");
        svg.setAttribute("role", "button");
        svg.onclick = (event) =>
          navigation.click(note.measure, note.beat, note.id, event);
        svg.onkeydown = (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          navigation.reset();
          if (event.shiftKey && event.key === "Enter" && playCallback.current)
            playCallback.current(note.measure, note.beat);
          else callback.current(note.measure, note.beat);
        };
      }
    });
    const svg = element.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", `0 0 ${renderWidth} ${height}`);
      svg.setAttribute("height", String(fittedHeight));
      svg.style.height = `${fittedHeight}px`;
      svg.style.width = "100%";
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
    svg?.setAttribute("role", "img");
    prepareStaffSvg(element);
  }, [
    song,
    first,
    count,
    hands,
    width,
    hybrid,
    maxHeight,
    Boolean(onPlayFrom),
  ]);
  useEffect(() => {
    container.current?.querySelector("svg")?.setAttribute(
      "aria-label",
      t("{song}, staff notation for measures {first}–{last}", {
        song: songTitle(song, locale),
        first: first + 1,
        last: first + count,
      }),
    );
  }, [locale, song, first, count, hands, width, hybrid, maxHeight]);
  useNoteHighlight(
    container,
    activeIds,
    statuses,
    `${song.id}:${first}:${count}:${width}:${hands}:${hybrid}:${maxHeight}`,
  );
  useStaffAppearance(
    container,
    activeIds,
    statuses,
    `${song.id}:${first}:${count}:${width}:${hands}:${hybrid}:${maxHeight}`,
  );
  return <div className="staff-render" ref={container} />;
}
