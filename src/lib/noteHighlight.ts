import { useEffect, useRef, type RefObject } from "react";
import { HAND_COLORS, HAND_TINTS } from "./handColors";
import { countWork, timeWork } from "./diagnostics";
import { pitchStatus } from "./practiceJudgement";

export class NoteHighlighter {
  private notes = new Map<
    string,
    {
      hand: "right" | "left";
      paths: SVGElement[];
      element: SVGGraphicsElement;
      frame?: SVGRectElement;
      color?: string;
      pitch?: number;
    }[]
  >();
  private active = new Set<string>();
  private statuses: Record<string, string> | undefined;
  private initialized = false;
  constructor(root: Element) {
    root.querySelectorAll<SVGElement>("[data-note-id]").forEach((element) => {
      const id = element.getAttribute("data-note-id")!;
      const entries = this.notes.get(id) ?? [];
      entries.push({
        element: element as SVGGraphicsElement,
        frame:
          element.querySelector<SVGRectElement>(".staff-key-frame") ??
          undefined,
        hand:
          element.getAttribute("data-note-hand") === "left" ? "left" : "right",
        pitch: /^\d+$/.test(element.getAttribute("data-note-pitch") ?? "")
          ? Number(element.getAttribute("data-note-pitch"))
          : undefined,
        paths: Array.from(
          element.querySelectorAll<SVGElement>("path,text,ellipse"),
        ).filter(
          (path) =>
            typeof path.closest !== "function" ||
            !path.closest("[data-note-pitch]") ||
            path.closest("[data-note-pitch]") === element,
        ),
      });
      this.notes.set(id, entries);
    });
  }
  update(activeIds: string[], statuses: Record<string, string>) {
    const end = timeWork("noteHighlight");
    const active = new Set(activeIds),
      dirty = new Set([...this.active, ...active]);
    if (!this.initialized) this.notes.forEach((_, id) => dirty.add(id));
    else if (this.statuses !== statuses)
      this.notes.forEach((_, id) => {
        if (
          this.statuses?.[id] !== statuses[id] ||
          this.notes
            .get(id)
            ?.some(
              (note) =>
                note.pitch !== undefined &&
                this.statuses?.[`${id}:${note.pitch}`] !==
                  statuses[`${id}:${note.pitch}`],
            )
        )
          dirty.add(id);
      });
    for (const id of dirty)
      for (const note of this.notes.get(id) ?? []) {
        if (
          active.has(id) &&
          !note.frame &&
          typeof note.element.getBBox === "function"
        ) {
          const box = note.element.getBBox();
          if (box.width > 0 && box.height > 0) {
            const frame = note.element.ownerDocument.createElementNS(
              "http://www.w3.org/2000/svg",
              "rect",
            );
            frame.setAttribute("class", "staff-key-frame");
            frame.setAttribute("x", String(box.x - 6));
            frame.setAttribute("y", String(box.y - 6));
            frame.setAttribute("width", String(box.width + 12));
            frame.setAttribute("height", String(box.height + 12));
            frame.setAttribute("rx", "5");
            frame.setAttribute("fill", HAND_TINTS[note.hand]);
            frame.setAttribute("stroke", HAND_COLORS[note.hand]);
            frame.setAttribute("stroke-width", "1.5");
            frame.setAttribute("pointer-events", "none");
            frame.setAttribute("aria-hidden", "true");
            note.element.prepend(frame);
            note.frame = frame;
          }
        }
        if (note.frame) {
          const display = active.has(id) ? "" : "none";
          if (note.frame.style.display !== display)
            note.frame.style.display = display;
        }
        const status = pitchStatus(statuses, id, note.pitch);
        const color =
          status === "wrong"
            ? "#b65f53"
            : active.has(id)
              ? HAND_COLORS[note.hand]
              : status === "correct"
                ? "#507563"
                : status === "wrong"
                  ? "#b65f53"
                  : "#292e2a";
        if (note.color === color) continue;
        for (const path of note.paths) {
          path.style.fill = color;
          path.style.stroke = color;
          countWork("highlightStyleWrites", 2);
        }
        note.color = color;
      }
    this.active = active;
    this.statuses = statuses;
    this.initialized = true;
    end();
  }
}

export function useNoteHighlight(
  root: RefObject<HTMLElement | null>,
  activeIds: string[],
  statuses: Record<string, string>,
  revision: string | number,
) {
  const painter = useRef<NoteHighlighter | null>(null);
  useEffect(() => {
    painter.current = root.current ? new NoteHighlighter(root.current) : null;
    return () => {
      painter.current = null;
    };
  }, [root, revision]);
  useEffect(() => {
    painter.current?.update(activeIds, statuses);
  }, [activeIds, statuses, revision]);
}
