import { Capacitor, registerPlugin } from "@capacitor/core";

export const input = registerPlugin<{
  preparePlayback(): Promise<void>;
  prepareMicrophone(): Promise<void>;
  microphoneStatus(): Promise<{ granted: boolean; blocked: boolean }>;
  openSettings(): Promise<void>;
}>("PianoInput");

export async function prepareMicrophone() {
  if (Capacitor.isNativePlatform()) await input.prepareMicrophone();
}
export async function microphoneError(error: unknown) {
  const problem = error as { name?: string; message?: string; code?: string };
  if (problem.code === "MIC_PERMISSION" || problem.code === "MIC_PRIVACY")
    return problem.message!;
  if (problem.name === "NotFoundError")
    return "No microphone found. Check your device microphone or external audio input.";
  if (problem.name === "NotReadableError" || problem.name === "AbortError")
    return "The microphone could not start. Close any recording, calling, or other app using it, then try again.";
  if (problem.name === "NotAllowedError" || problem.name === "SecurityError") {
    if (Capacitor.isNativePlatform()) {
      const status = await input.microphoneStatus().catch(() => null);
      if (status?.blocked)
        return "Recording permission is allowed, but the system microphone is muted or disabled. Check microphone access and mute settings.";
      if (status?.granted)
        return Capacitor.getPlatform() === "ios"
          ? "Recording permission is allowed, but recording could not start. Close other apps using the microphone and reopen Xiaoma Piano."
          : "Recording permission is allowed, but Android WebView denied recording. Install the latest Xiaoma Piano version; if already current, update Android System WebView and restart Xiaoma Piano.";
      return "Xiaoma Piano does not have microphone permission. Open app permissions and allow microphone access while using the app.";
    }
    return "This page does not have microphone access. Allow it in the browser's site permissions and make sure the system allows the browser to record.";
  }
  if (problem.name === "OverconstrainedError")
    return "The microphone does not support these recording settings. Select another input device and try again.";
  return problem.message || "The microphone could not start. Please try again.";
}
export function openInputSettings() {
  return input.openSettings();
}
