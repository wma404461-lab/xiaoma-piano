import "../data/componentMessages";
import { useI18n } from "../lib/i18n";
import { X } from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";
import { useDialogMotion } from "../lib/motion";
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const { closing, requestClose, finishClose } = useDialogMotion(
    ref,
    onClose,
    dismissible,
  );
  return (
    <dialog
      className={`modal motion-dialog ${wide ? "wide" : ""}`}
      ref={ref}
      data-motion={closing ? "closing" : "open"}
      onAnimationEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.animationName === "qinban-dialog-out"
        )
          finishClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Close")}
          disabled={!dismissible || closing}
          onClick={requestClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
