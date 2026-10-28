import "../data/componentMessages";
import { Component, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";

function PracticeFailure({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  return (
    <div className="loading-overlay" role="alert">
      <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
        <h2>{t("The practice view could not load")}</h2>
        <p style={{ margin: "18px 0", lineHeight: 1.8 }}>
          {t("Check your connection and reload. Your saved practice history remains on this device.")}
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button className="primary-button" onClick={() => location.reload()}>
            {t("Reload")}
          </button>
          <button className="secondary-button" onClick={onExit}>
            {t("Back to library")}
          </button>
        </div>
      </div>
    </div>
  );
}
export class PracticeBoundary extends Component<
  { children: ReactNode; onExit: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <PracticeFailure onExit={this.props.onExit} />
    ) : (
      this.props.children
    );
  }
}
