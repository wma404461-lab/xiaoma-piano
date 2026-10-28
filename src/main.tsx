import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initializeTheme } from "./lib/theme";
initializeTheme();
import { startPerformanceProbe } from "./lib/diagnostics";
import { registerPianoWebApp } from "./lib/pwa";
import { lockAppViewport } from "./lib/viewportLock";
lockAppViewport();
startPerformanceProbe();
registerPianoWebApp();

createRoot(document.getElementById("root")!).render(<App />);
