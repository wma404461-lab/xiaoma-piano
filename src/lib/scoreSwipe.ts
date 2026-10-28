import { useRef } from "react";
export function pageSwipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  return Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5
    ? dx < 0
      ? 1
      : -1
    : 0;
}
export class ScoreSwipeGesture {
  private pointers = new Set<number>();
  private start: {
    id: number;
    x: number;
    y: number;
    axis: "pending" | "horizontal" | "vertical";
  } | null = null;
  private suppressClick = false;
  down(id: number, x: number, y: number, button = 0) {
    if (button !== 0) return;
    if (!this.pointers.size) this.suppressClick = false;
    this.pointers.add(id);
    this.start =
      this.pointers.size === 1 ? { id, x, y, axis: "pending" } : null;
    if (this.pointers.size > 1) this.suppressClick = true;
  }
  move(id: number, x: number, y: number): boolean {
    const origin = this.start;
    if (!origin || origin.id !== id) return false;
    const dx = Math.abs(x - origin.x),
      dy = Math.abs(y - origin.y);
    if (origin.axis === "pending" && Math.max(dx, dy) >= 12) {
      if (dx > dy * 1.2) origin.axis = "horizontal";
      else if (dy > dx * 1.2) origin.axis = "vertical";
    }
    if (origin.axis !== "horizontal") return false;
    this.suppressClick = true;
    return true;
  }
  up(id: number, x: number, y: number): -1 | 0 | 1 {
    this.move(id, x, y);
    const origin = this.start;
    this.pointers.delete(id);
    if (!origin || origin.id !== id) return 0;
    this.start = null;
    return origin.axis === "horizontal"
      ? pageSwipeDirection(x - origin.x, y - origin.y)
      : 0;
  }
  cancel(id: number) {
    if (!this.pointers.delete(id)) return;
    this.start = null;
    this.suppressClick = true;
  }
  consumeClick() {
    const result = this.suppressClick;
    this.suppressClick = false;
    return result;
  }
}

export function useScoreSwipe(onTurn: (direction: -1 | 1) => void) {
  const turn = useRef(onTurn);
  turn.current = onTurn;
  const gesture = useRef(new ScoreSwipeGesture());
  return {
    style: { touchAction: "pan-y", userSelect: "none" } as const,
    onPointerDownCapture(event: React.PointerEvent<HTMLDivElement>) {
      gesture.current.down(
        event.pointerId,
        event.clientX,
        event.clientY,
        event.button,
      );
    },
    onPointerMoveCapture(event: React.PointerEvent<HTMLDivElement>) {
      if (gesture.current.move(event.pointerId, event.clientX, event.clientY)) {
        event.preventDefault();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* The browser may already have cancelled this pointer. */
        }
      }
    },
    onPointerUpCapture(event: React.PointerEvent<HTMLDivElement>) {
      const direction = gesture.current.up(
        event.pointerId,
        event.clientX,
        event.clientY,
      );
      if (direction) turn.current(direction);
    },
    onPointerCancelCapture(event: React.PointerEvent<HTMLDivElement>) {
      gesture.current.cancel(event.pointerId);
    },
    onLostPointerCapture(event: React.PointerEvent<HTMLDivElement>) {
      // Touch starts with implicit capture on the SVG note. Transferring it to
      // this surface fires a bubbling loss on that child, not on this surface.
      if (event.target === event.currentTarget)
        gesture.current.cancel(event.pointerId);
    },
    onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
      if (gesture.current.consumeClick()) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
