import { Capacitor } from "@capacitor/core";
import { input as nativeInput } from "./microphone";

type SessionType = "playback" | "play-and-record";
type SessionNavigator = Navigator & { audioSession?: { type: SessionType } };
let microphones = 0;
let nativePreparation: Promise<void> | undefined;
let silentMedia: HTMLAudioElement | undefined;
let observingVisibility = false;

function iosWebKit() {
  return typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
}

function setType(type: SessionType) {
  if (typeof navigator === "undefined") return false;
  try {
    const session = (navigator as SessionNavigator).audioSession;
    if (!session) return false;
    session.type = type;
    return session.type === type;
  } catch { return false; }
}

function observeVisibility() {
  if (observingVisibility || typeof document === "undefined") return;
  observingVisibility = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      silentMedia?.pause();
      nativePreparation = undefined;
    }
  });
}

// Old iOS treats Web Audio as ambient audio. An unmuted, zero-valued media
// stream selects the media playback route; the piano still uses its original
// AudioContext, stereo samples and velocity layers. Start inside the gesture.
function startLegacyMediaRoute() {
  if (!silentMedia && typeof Audio !== "undefined") {
    const data = new Uint8Array(1644);
    const header = new DataView(data.buffer);
    const write = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) data[offset + i] = value.charCodeAt(i);
    };
    write(0, "RIFF"); header.setUint32(4, 1636, true); write(8, "WAVEfmt ");
    header.setUint32(16, 16, true); header.setUint16(20, 1, true);
    header.setUint16(22, 1, true); header.setUint32(24, 8000, true);
    header.setUint32(28, 16000, true); header.setUint16(32, 2, true);
    header.setUint16(34, 16, true); write(36, "data"); header.setUint32(40, 1600, true);
    silentMedia = new Audio("data:audio/wav;base64," + btoa(String.fromCharCode(...data)));
    silentMedia.loop = true;
    silentMedia.preload = "auto";
    silentMedia.muted = false;
    silentMedia.volume = 1;
    silentMedia.setAttribute("playsinline", "");
  }
  if (silentMedia?.paused) {
    // A prefetch without a gesture may be rejected; the next real key retries.
    void silentMedia.play()?.catch(() => {});
  }
}

export function preparePlaybackSession(): Promise<void> | undefined {
  observeVisibility();
  const supported = setType(microphones ? "play-and-record" : "playback");
  if (!supported && iosWebKit()) startLegacyMediaRoute();
  if (!microphones && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
    nativePreparation ??= nativeInput.preparePlayback().catch(() => {
      nativePreparation = undefined;
      // Older shells can still use WebKit's audio-session or media route.
    });
    return nativePreparation;
  }
}

export function stopPlaybackSession() { silentMedia?.pause(); }

export function beginMicrophoneSession() {
  microphones++;
  nativePreparation = undefined;
  setType("play-and-record");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    microphones = Math.max(0, microphones - 1);
    if (!microphones) {
      setType("playback");
      // Restore the native speaker/playback route without starting silent media
      // outside a gesture or asking for another microphone permission.
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
        nativePreparation = nativeInput.preparePlayback().catch(() => { nativePreparation = undefined; });
      }
    }
  };
}
