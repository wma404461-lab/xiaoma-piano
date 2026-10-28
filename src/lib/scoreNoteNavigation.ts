type NoteClick = {
  detail?: number;
  button?: number;
  clientX?: number;
  clientY?: number;
  defaultPrevented?: boolean;
};

/** Use click pairs for touch as well as mouse; keyboard activation stays single. */
export function createScoreNoteNavigator(
  onSelect: (measure: number, beat: number) => void,
  onPlayFrom?: (measure: number, beat: number) => void,
  now: () => number = () => performance.now(),
) {
  let previous: { id: string; time: number; x: number; y: number } | null =
    null;
  return {
    reset() {
      previous = null;
    },
    click(
      measure: number,
      beat: number,
      noteId: string,
      event: NoteClick = {},
    ) {
      if (
        event.defaultPrevented ||
        (event.button !== undefined && event.button !== 0)
      )
        return;
      if (!onPlayFrom || event.detail === 0) {
        previous = null;
        onSelect(measure, beat);
        return;
      }
      const time = now(),
        x = event.clientX ?? 0,
        y = event.clientY ?? 0;
      const double =
        previous &&
        previous.id === noteId &&
        time >= previous.time &&
        time - previous.time <= 350 &&
        Math.hypot(x - previous.x, y - previous.y) <= 24;
      previous = double ? null : { id: noteId, time, x, y };
      if (double) onPlayFrom(measure, beat);
      else onSelect(measure, beat);
    },
  };
}
