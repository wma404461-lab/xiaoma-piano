import { Capacitor, registerPlugin } from "@capacitor/core";
import { MidiSession, type MidiDevice } from "./midiSession";
import { MidiMessages, type MidiNote } from "./midiMessages";
export type { MidiDevice } from "./midiSession";

interface NativeMidi {
  devices(): Promise<{ devices: MidiDevice[] }>;
  bluetoothDevices(): Promise<{ devices: MidiDevice[] }>;
  cancelBluetoothScan(): Promise<void>;
  connect(options: { id: string }): Promise<void>;
  disconnect(): Promise<void>;
  addListener(
    event: "note",
    callback: (note: MidiNote) => void,
  ): Promise<{ remove(): Promise<void> }>;
  addListener(
    event: "disconnected" | "devicesChanged",
    callback: () => void,
  ): Promise<{ remove(): Promise<void> }>;
}
const nativeMidi = registerPlugin<NativeMidi>("PianoMidi");
interface WebMidiInput {
  id: string;
  name?: string;
  state?: string;
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
  open(): Promise<void>;
  close(): Promise<void>;
}
interface WebMidiAccess {
  inputs: Map<string, WebMidiInput>;
  onstatechange:
    | ((event: { port: { id: string; state: string; type: string } }) => void)
    | null;
}
let access: WebMidiAccess | undefined;
let inputChanged: (() => void) | undefined;
let inputDisconnected: ((id: string) => void) | undefined;
export async function midiDevices(): Promise<MidiDevice[]> {
  if (Capacitor.isNativePlatform()) return (await nativeMidi.devices()).devices;
  const request = (
    navigator as unknown as {
      requestMIDIAccess?: (options: {
        sysex: boolean;
      }) => Promise<WebMidiAccess>;
    }
  ).requestMIDIAccess;
  if (!request)
    throw new Error(
      "This browser does not support MIDI. Use the Xiaoma Piano Android app or a browser that supports Web MIDI.",
    );
  if (!access) {
    access = await request.call(navigator, { sysex: false });
    access.onstatechange = (event) => {
      if (event.port.type !== "input") return;
      if (event.port.state === "disconnected")
        inputDisconnected?.(event.port.id);
      else inputChanged?.();
    };
  }
  return [...access.inputs.values()]
    .filter((input) => input.state !== "disconnected")
    .map((input) => ({
      id: input.id,
      name: input.name ?? "MIDI keyboard",
      transport: "usb",
    }));
}
async function availableMidiDevices(): Promise<MidiDevice[]> {
  if (!Capacitor.isNativePlatform() && !access) {
    try {
      const permission = await navigator.permissions.query({
        name: "midi",
        sysex: false,
      } as unknown as PermissionDescriptor);
      if (permission.state !== "granted") return [];
    } catch {
      return [];
    }
  }
  return midiDevices();
}
export async function bluetoothMidiDevices(): Promise<MidiDevice[]> {
  if (!Capacitor.isNativePlatform())
    throw new Error(
      "Use the Xiaoma Piano Android app to search for Bluetooth MIDI directly. On a computer, connect Bluetooth MIDI in system settings, then select it from the MIDI device list.",
    );
  return (await nativeMidi.bluetoothDevices()).devices;
}
export function cancelBluetoothMidiSearch() {
  if (Capacitor.isNativePlatform()) void nativeMidi.cancelBluetoothScan();
}

let storage: Storage | undefined;
try {
  storage = localStorage;
} catch {
  /* Optional persistence. */
}
export const midiSession = new MidiSession(
  {
    devices: availableMidiDevices,
    restoreBluetooth: Capacitor.isNativePlatform(),
    async connect(device, onNote, onDisconnected) {
      if (Capacitor.isNativePlatform()) {
        const noteListener = await nativeMidi.addListener("note", onNote);
        const disconnectListener = await nativeMidi.addListener(
          "disconnected",
          onDisconnected,
        );
        try {
          await nativeMidi.connect({ id: device.id });
        } catch (error) {
          await noteListener.remove();
          await disconnectListener.remove();
          throw error;
        }
        return async () => {
          await noteListener.remove();
          await disconnectListener.remove();
          await nativeMidi.disconnect();
        };
      }
      const input = access?.inputs.get(device.id);
      if (!input) throw new Error("The device is offline. Please search again.");
      await input.open();
      const messages = new MidiMessages(onNote);
      input.onmidimessage = (event) => messages.feed(event.data);
      inputDisconnected = (id) => {
        if (id === device.id) onDisconnected();
      };
      return async () => {
        input.onmidimessage = null;
        inputDisconnected = undefined;
        await input.close();
      };
    },
  },
  storage,
);

// A single observer is shared across songs. Automatic recovery never scans BLE
// or prompts for permission; it only reopens the previously selected address.
let watching = false;
export function watchMidiDevices() {
  if (watching) return;
  watching = true;
  const restore = () => {
    if (!document.hidden) void midiSession.ensureConnected();
  };
  inputChanged = restore;
  document.addEventListener("visibilitychange", restore);
  if (Capacitor.isNativePlatform())
    void nativeMidi.addListener("devicesChanged", () => {
      if (
        midiSession.preference === "midi" ||
        midiSession.preference === "auto"
      )
        restore();
    });
  // Also recovers a BLE connection after the piano powers back on.
  window.setInterval(() => {
    if (
      midiSession.preference === "midi" &&
      !midiSession.state.device &&
      !midiSession.state.connecting
    )
      restore();
  }, 5000);
}
