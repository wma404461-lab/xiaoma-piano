import { useRef, type ReactNode } from "react";
import { useExitPresence } from "../lib/motion";

export function AnimatedToast({ children }: { children: ReactNode | null }) {
  const visible = Boolean(children);
  const message = useRef(children);
  if (visible) message.current = children;
  const { present, closing } = useExitPresence(visible);
  if (!present) return null;
  return (
    <div
      className="toast motion-toast"
      role="status"
      data-motion={closing ? "closing" : "open"}
    >
      {message.current}
    </div>
  );
}
