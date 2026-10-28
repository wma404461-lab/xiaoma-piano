import {
  useEffect,
  useSyncExternalStore,
  useState,
  useRef,
  type RefObject,
} from "react";

const query = "(prefers-reduced-motion: reduce)";
export const DIALOG_EXIT_MS = 180;
let mediaWindow: Window | undefined;
let mediaQuery: MediaQueryList | undefined;
function motionMedia() {
  if (typeof window === "undefined") return undefined;
  if (mediaWindow !== window) {
    mediaWindow = window;
    mediaQuery = window.matchMedia?.(query);
  }
  return mediaQuery;
}

function reducedMotion() {
  return Boolean(motionMedia()?.matches);
}
function subscribeMotion(notify: () => void) {
  const media = motionMedia();
  if (!media) return () => {};
  if (media.addEventListener) {
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }
  media.addListener(notify);
  return () => media.removeListener(notify);
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, reducedMotion, () => true);
}

/** Keep the modal in the top layer until its exit finishes, including Android Back. */
export function useDialogMotion(
  dialog: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
  dismissible = true,
  open = true,
) {
  const reduce = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const latest = useRef({ onClose, dismissible, open });
  latest.current = { onClose, dismissible, open };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    closingRef.current = false;
  };
  useEffect(() => {
    cancel();
    setClosing(false);
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    else if (!open && element?.open) element.close();
    return () => {
      cancel();
      if (element?.open) element.close();
    };
  }, [dialog, open]);
  useEffect(() => {
    if (!dismissible && closingRef.current) {
      cancel();
      setClosing(false);
    }
  }, [dismissible]);
  const finishClose = () => {
    if (!closingRef.current) return;
    cancel();
    if (latest.current.open && latest.current.dismissible)
      latest.current.onClose();
    else setClosing(false);
  };
  useEffect(() => {
    if (reduce && closingRef.current) finishClose();
  }, [reduce]);
  const requestClose = () => {
    if (
      !latest.current.open ||
      !latest.current.dismissible ||
      closingRef.current
    )
      return;
    if (reduce) {
      latest.current.onClose();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    timer.current = setTimeout(finishClose, DIALOG_EXIT_MS);
  };
  return { closing, requestClose, finishClose };
}

export function useExitPresence(visible: boolean) {
  const reduce = useReducedMotion();
  const [present, setPresent] = useState(visible);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (visible) {
      setPresent(true);
      setClosing(false);
      return;
    }
    if (reduce) {
      setPresent(false);
      setClosing(false);
      return;
    }
    if (!present) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setPresent(false);
      setClosing(false);
    }, DIALOG_EXIT_MS);
    return () => clearTimeout(timer);
  }, [visible, reduce, present]);
  return { present, closing };
}
