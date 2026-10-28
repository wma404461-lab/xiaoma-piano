import type { MidiNote } from "./midiMessages";

export interface MidiDevice {
  id: string;
  name: string;
  transport?: "usb" | "bluetooth";
}
export type InputPreference = "auto" | "keyboard" | "microphone" | "midi";
export interface MidiState {
  device: MidiDevice | null;
  connecting: boolean;
  error: string;
}
export interface MidiAdapter {
  devices(): Promise<MidiDevice[]>;
  connect(
    device: MidiDevice,
    note: (note: MidiNote) => void,
    ended: () => void,
    automatic: boolean,
  ): Promise<() => Promise<void>>;
  restoreBluetooth?: boolean;
}
interface Preferences {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// The application owns the physical port; practice pages only subscribe to it.
export class MidiSession {
  state: MidiState = { device: null, connecting: false, error: "" };
  preference: InputPreference = "auto";
  private last: MidiDevice | null = null;
  private notes = new Set<(note: MidiNote, held: readonly number[]) => void>();
  private heldChannels = new Map<number, Set<number>>();
  get held(): number[] {
    return [
      ...new Set(
        [...this.heldChannels.values()].flatMap((pitches) => [...pitches]),
      ),
    ].sort((a, b) => a - b);
  }
  private listeners = new Set<(state: MidiState) => void>();
  private cleanup: (() => Promise<void>) | undefined;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private restoring: Promise<MidiDevice | null> | undefined;

  constructor(
    private adapter: MidiAdapter,
    private storage?: Preferences,
  ) {
    try {
      const preference = storage?.getItem("qinban-input-source");
      if (
        preference === "keyboard" ||
        preference === "microphone" ||
        preference === "midi"
      )
        this.preference = preference;
      const saved = JSON.parse(
        storage?.getItem("qinban-midi-device") ?? "null",
      );
      if (typeof saved?.id === "string" && typeof saved?.name === "string")
        this.last = saved;
    } catch {
      /* Browsers may disable local storage. */
    }
  }

  subscribe(
    note: (note: MidiNote, held: readonly number[]) => void,
    state: (value: MidiState) => void,
  ) {
    this.notes.add(note);
    this.listeners.add(state);
    state(this.state);
    return () => {
      this.notes.delete(note);
      this.listeners.delete(state);
    };
  }

  private update(value: Partial<MidiState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener(this.state));
  }

  selectInput(preference: InputPreference) {
    this.preference = preference;
    try {
      this.storage?.setItem("qinban-input-source", preference);
    } catch {
      /* Optional persistence. */
    }
    if (preference !== "midi" && preference !== "auto") this.disconnect();
  }

  disconnect() {
    this.generation++;
    this.heldChannels.clear();
    this.update({ device: null, connecting: false, error: "" });
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const close = this.cleanup;
        this.cleanup = undefined;
        await close?.();
      });
  }

  async connect(
    device: MidiDevice,
    automatic = false,
  ): Promise<MidiDevice | null> {
    if (this.state.device?.id === device.id) return this.state.device;
    const generation = ++this.generation;
    this.update({ connecting: true, error: "" });
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const previous = this.cleanup;
        this.cleanup = undefined;
        await previous?.();
        if (generation !== this.generation) return null;
        this.heldChannels.clear();
        this.update({ device: null });
        try {
          let ended = false;
          const close = await this.adapter.connect(
            device,
            (note) => {
              if (generation !== this.generation || !this.state.device) return;
              const alreadyHeld = note.on && this.held.includes(note.pitch);
              let pitches = this.heldChannels.get(note.channel);
              if (!pitches) {
                pitches = new Set();
                this.heldChannels.set(note.channel, pitches);
              }
              if (note.pitch < 0) pitches.clear();
              else if (note.on) pitches.add(note.pitch);
              else pitches.delete(note.pitch);
              const held = this.held;
              if (alreadyHeld) return;
              this.notes.forEach((listener) => listener(note, held));
            },
            () => {
              ended = true;
              if (generation !== this.generation) return;
              this.generation++;
              this.heldChannels.clear();
              this.update({
                device: null,
                connecting: false,
                error: "The piano disconnected. It will reconnect automatically when it returns.",
              });
            },
            automatic,
          );
          if (generation !== this.generation || ended) {
            await close();
            return null;
          }
          this.cleanup = close;
          this.last = device;
          this.selectInput("midi");
          try {
            this.storage?.setItem("qinban-midi-device", JSON.stringify(device));
          } catch {
            /* Optional persistence. */
          }
          this.update({ device, connecting: false, error: "" });
          return device;
        } catch (error) {
          if (generation !== this.generation) return null;
          this.update({
            device: null,
            connecting: false,
            error: (error as Error).message || "MIDI connection failed.",
          });
          if (!automatic) throw error;
          return null;
        }
      });
    this.queue = operation;
    return operation;
  }

  ensureConnected(): Promise<MidiDevice | null> {
    if (this.state.device) return Promise.resolve(this.state.device);
    if (this.state.connecting) return this.queue.then(() => this.state.device);
    if (this.preference === "keyboard" || this.preference === "microphone")
      return Promise.resolve(null);
    if (this.restoring) return this.restoring;
    const generation = this.generation;
    const restore = async () => {
      try {
        const found = await this.adapter.devices();
        if (generation !== this.generation) return this.state.device;
        const matched =
          found.find((d) => d.id === this.last?.id) ??
          found.find(
            (d) =>
              d.name === this.last?.name &&
              d.transport === this.last?.transport,
          );
        const selected =
          matched ??
          (this.last?.transport === "bluetooth" && this.adapter.restoreBluetooth
            ? this.last
            : found.length === 1
              ? found[0]
              : null);
        if (!selected) return null;
        return await this.connect(selected, true);
      } catch (error) {
        if (generation === this.generation)
          this.update({ error: (error as Error).message });
        return null;
      }
    };
    this.restoring = restore().finally(() => {
      this.restoring = undefined;
    });
    return this.restoring;
  }
}
