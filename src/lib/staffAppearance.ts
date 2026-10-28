import { useEffect, useRef, type RefObject } from "react";

/** Remember transparent/outline-only paint before the highlighter sets inline colors. */
export function prepareStaffSvg(root: Element) {
  root.querySelectorAll<SVGElement>("svg *").forEach((element) => {
    for (const property of ["fill", "stroke"] as const) {
      // Engravers also put paint on enclosing groups. Read the source tree,
      // rather than computed CSS, before active-note styles replace it.
      let source: SVGElement | null = element;
      let paint = property === "stroke" ? "none" : "black";
      while (source) {
        const explicit = (
          source.style[property] ||
          source.getAttribute(property) ||
          ""
        )
          .trim()
          .toLowerCase();
        if (explicit && explicit !== "inherit" && explicit !== "unset") {
          paint = explicit;
          break;
        }
        if (source.localName === "svg") break;
        source = source.parentElement as SVGElement | null;
      }
      if (paint === "none")
        element.setAttribute(`data-staff-${property}`, "none");
      else if (
        paint === "transparent" ||
        paint === "#00000000" ||
        paint.replace(/\s/g, "") === "rgba(0,0,0,0)"
      )
        element.setAttribute(`data-staff-${property}`, "transparent");
    }
  });
}

/** Expose note state to CSS, so theme changes do not re-engrave cached pages. */
export class StaffNoteAppearance {
  private notes = new Map<string, Element[]>();
  private active = new Set<string>();
  private statuses: Record<string, string> | undefined;
  private initialized = false;
  constructor(root: Element) {
    root.querySelectorAll("[data-note-id]").forEach((element) => {
      const id = element.getAttribute("data-note-id")!;
      const entries = this.notes.get(id) ?? [];
      entries.push(element);
      this.notes.set(id, entries);
    });
  }
  update(activeIds: string[], statuses: Record<string, string>) {
    const active = new Set(activeIds);
    const changed = new Set([...this.active, ...active]);
    if (!this.initialized) this.notes.forEach((_, id) => changed.add(id));
    else if (statuses !== this.statuses) {
      this.notes.forEach((_, id) => {
        if (statuses[id] !== this.statuses?.[id]) changed.add(id);
      });
    }
    for (const id of changed) {
      const state = active.has(id)
        ? "active"
        : statuses[id] === "correct"
          ? "correct"
          : statuses[id] === "wrong"
            ? "wrong"
            : "idle";
      for (const element of this.notes.get(id) ?? []) {
        if (element.getAttribute("data-note-state") !== state)
          element.setAttribute("data-note-state", state);
      }
    }
    this.active = active;
    this.statuses = statuses;
    this.initialized = true;
  }
}

export function useStaffAppearance(
  root: RefObject<HTMLElement | null>,
  activeIds: string[],
  statuses: Record<string, string>,
  revision: string | number,
) {
  const painter = useRef<StaffNoteAppearance | null>(null);
  useEffect(() => {
    painter.current = root.current
      ? new StaffNoteAppearance(root.current)
      : null;
    return () => {
      painter.current = null;
    };
  }, [root, revision]);
  useEffect(() => {
    painter.current?.update(activeIds, statuses);
  }, [activeIds, statuses, revision]);
}
