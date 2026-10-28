import { Midi } from "@tonejs/midi";

const divisions = 480;
const escapeXml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
function durationXml(ticks: number) {
  const values: [number, string][] = [
    [1920, "whole"],
    [960, "half"],
    [480, "quarter"],
    [240, "eighth"],
    [120, "16th"],
    [60, "32nd"],
    [30, "64th"],
  ];
  for (const [n, type] of values) {
    if (ticks === n) return `<type>${type}</type>`;
    if (ticks === n * 1.5) return `<type>${type}</type><dot/>`;
  }
  const [base, type] =
    [...values].reverse().find(([n]) => n >= ticks) ?? values[0];
  const d = gcd(base, ticks);
  return `<type>${type}</type><time-modification><actual-notes>${base / d}</actual-notes><normal-notes>${ticks / d}</normal-notes><normal-type>${type}</normal-type></time-modification>`;
}
function pitchXml(midi: number) {
  const steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
  return `<pitch><step>${steps[midi % 12]}</step>${[1, 3, 6, 8, 10].includes(midi % 12) ? "<alter>1</alter>" : ""}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
}
/** Preserve MIDI attacks and overlapping voices; quantize to 1/48 of a quarter note. */
export function midiToMusicXml(buffer: ArrayBuffer, title: string) {
  const midi = new Midi(buffer);
  const tracks = midi.tracks.filter(
    (t) => t.notes.length && !t.instrument.percussion,
  );
  if (!tracks.length || tracks.length > 2)
    throw new Error(
      "Import a single-track or two-track piano MIDI. Export the piano part from multi-instrument arrangements first.",
    );
  tracks.sort(
    (a, b) =>
      b.notes.reduce((s, n) => s + n.midi, 0) / b.notes.length -
      a.notes.reduce((s, n) => s + n.midi, 0) / a.notes.length,
  );
  const tick = (n: number) =>
    Math.round(((n / midi.header.ppq) * divisions) / 10) * 10;
  const signatures = midi.header.timeSignatures.map((s) => ({
    start: tick(s.ticks),
    n: s.timeSignature[0],
    d: s.timeSignature[1],
  }));
  if (!signatures.length || signatures[0].start > 0)
    signatures.unshift({ start: 0, n: 4, d: 4 });
  const end = Math.max(
    ...tracks.map((t) =>
      Math.max(...t.notes.map((n) => tick(n.ticks + n.durationTicks))),
    ),
  );
  const bars: { start: number; end: number; n: number; d: number }[] = [];
  for (let start = 0; start < end;) {
    const sig = [...signatures].reverse().find((s) => s.start <= start)!;
    const next = signatures.find((s) => s.start > start)?.start ?? Infinity;
    const finish = Math.min(start + ((sig.n * 4) / sig.d) * divisions, next);
    if (finish <= start || bars.length >= 5000)
      throw new Error("Invalid MIDI time signature or score too large.");
    bars.push({ start, end: finish, n: sig.n, d: sig.d });
    start = finish;
  }
  const bpm = midi.header.tempos[0]?.bpm ?? 80;
  const fifthsNames = [
    "Cb",
    "Gb",
    "Db",
    "Ab",
    "Eb",
    "Bb",
    "F",
    "C",
    "G",
    "D",
    "A",
    "E",
    "B",
    "F#",
    "C#",
  ];
  const fifths =
    fifthsNames.indexOf(midi.header.keySignatures[0]?.key ?? "C") - 7;
  const parts = tracks
    .map((track, pi) => {
      const groups = new Map<
        string,
        { start: number; end: number; pitches: number[]; voice: number }
      >();
      for (const n of track.notes) {
        if (n.midi < 21 || n.midi > 108)
          throw new Error("MIDI contains notes outside the standard 88-key piano range.");
        const start = tick(n.ticks),
          finish = Math.max(start + 10, tick(n.ticks + n.durationTicks)),
          k = `${start}-${finish}`;
        const group = groups.get(k) ?? {
          start,
          end: finish,
          pitches: [],
          voice: 0,
        };
        if (!group.pitches.includes(n.midi)) group.pitches.push(n.midi);
        groups.set(k, group);
      }
      const notes = [...groups.values()].sort(
        (a, b) => a.start - b.start || b.end - a.end,
      );
      const voiceEnds: number[] = [];
      for (const n of notes) {
        let voice = voiceEnds.findIndex((e) => e <= n.start);
        if (voice < 0) voice = voiceEnds.length;
        n.voice = voice;
        voiceEnds[voice] = n.end;
      }
      if (voiceEnds.length > 16)
        throw new Error("Too many overlapping MIDI voices. Simplify the piano arrangement first.");
      const measures = bars
        .map((bar, mi) => {
          const attrs =
            mi === 0 || bars[mi - 1].n !== bar.n || bars[mi - 1].d !== bar.d
              ? `<attributes><divisions>${divisions}</divisions><key><fifths>${Math.max(-7, Math.min(7, fifths))}</fifths></key><time><beats>${bar.n}</beats><beat-type>${bar.d}</beat-type></time><clef><sign>${pi === 0 ? "G" : "F"}</sign><line>${pi === 0 ? 2 : 4}</line></clef></attributes>`
              : "";
          const tempos = midi.header.tempos.length ? midi.header.tempos : [{ ticks: 0, bpm }];
          const direction = pi === 0 ? tempos
            .filter(mark => mark.ticks / midi.header.ppq * divisions >= bar.start && mark.ticks / midi.header.ppq * divisions < bar.end)
            .map(mark => `<direction><offset sound="yes">${mark.ticks / midi.header.ppq * divisions - bar.start}</offset><sound tempo="${mark.bpm}"/></direction>`).join("") : "";
          let content = "";
          for (let vi = 0; vi < voiceEnds.length; vi++) {
            if (vi)
              content += `<backup><duration>${bar.end - bar.start}</duration></backup>`;
            let position = bar.start;
            const rest = (d: number) =>
              `<note><rest/><duration>${d}</duration><voice>${vi + 1}</voice>${durationXml(d)}</note>`;
            for (const n of notes.filter(
              (n) => n.voice === vi && n.start < bar.end && n.end > bar.start,
            )) {
              const start = Math.max(n.start, bar.start),
                finish = Math.min(n.end, bar.end),
                d = finish - start;
              if (start > position) content += rest(start - position);
              const ties =
                (n.start < bar.start ? '<tie type="stop"/>' : "") +
                (n.end > bar.end ? '<tie type="start"/>' : "");
              const notations = ties
                ? `<notations>${ties.replace(/<tie /g, "<tied ")}</notations>`
                : "";
              n.pitches.forEach((p, i) => {
                content += `<note>${i ? "<chord/>" : ""}${pitchXml(p)}<duration>${d}</duration>${ties}<voice>${vi + 1}</voice>${durationXml(d)}${notations}</note>`;
              });
              position = finish;
            }
            if (position < bar.end) content += rest(bar.end - position);
          }
          return `<measure number="${mi + 1}">${attrs}${direction}${content}</measure>`;
        })
        .join("");
      return `<part id="P${pi + 1}">${measures}</part>`;
    })
    .join("");
  const list = tracks
    .map(
      (_, i) =>
        `<score-part id="P${i + 1}"><part-name>${i === 0 ? "Right hand" : "Left hand"}</part-name></score-part>`,
    )
    .join("");
  return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${escapeXml(title)}</work-title></work><part-list>${tracks.length === 2 ? '<part-group type="start" number="1"><group-symbol>brace</group-symbol><group-barline>yes</group-barline></part-group>' : ""}${list}${tracks.length === 2 ? '<part-group type="stop" number="1"/>' : ""}</part-list>${parts}</score-partwise>`;
}
