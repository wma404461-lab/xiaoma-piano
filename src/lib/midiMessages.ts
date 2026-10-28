export interface MidiNote {
  pitch: number;
  velocity: number;
  on: boolean;
  channel: number;
}
// Handles chord packets, running status, split packets, and interleaved clocks.
export class MidiMessages {
  private status = 0;
  private first: number | undefined;
  constructor(private emit: (note: MidiNote) => void) {}
  feed(data: Uint8Array) {
    for (const value of data) {
      if (value >= 0xf8) continue;
      if (value >= 0x80) {
        this.status = value < 0xf0 ? value : 0;
        this.first = undefined;
        continue;
      }
      if (!this.status) continue;
      const kind = this.status & 0xf0,
        channel = this.status & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) {
        this.first = undefined;
        continue;
      }
      if (this.first === undefined) {
        this.first = value;
        continue;
      }
      const first = this.first;
      this.first = undefined;
      if (kind === 0x90 || kind === 0x80)
        this.emit({
          pitch: first,
          velocity: value,
          on: kind === 0x90 && value > 0,
          channel,
        });
      if (kind === 0xb0 && (first === 120 || first === 123))
        this.emit({ pitch: -1, velocity: 0, on: false, channel });
    }
  }
}
