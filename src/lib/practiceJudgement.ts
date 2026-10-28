import type { ExpectedEvent, Song } from "../types";

/** Advancing one group does not paint its unplayed chord tones green. */
export function eventHitStatuses(
  song: Song,
  event: ExpectedEvent,
  played: number,
) {
  const measure = song.measures[event.measure];
  const notes = [...(measure?.right ?? []), ...(measure?.left ?? [])];
  const statuses: Record<string, string> = {};
  for (const id of event.noteIds) {
    const pitches =
      notes.find((note) => note.id === id)?.pitches ?? event.pitches;
    statuses[id] = pitches.includes(played) ? "correct" : "wrong";
    for (const pitch of pitches)
      statuses[`${id}:${pitch}`] = pitch === played ? "correct" : "wrong";
  }
  return statuses;
}

export function pitchStatus(
  statuses: Record<string, string>,
  id: string,
  pitch?: number,
) {
  return (
    (pitch === undefined ? undefined : statuses[`${id}:${pitch}`]) ??
    statuses[id]
  );
}
