import "../data/componentMessages";
import { translate } from "./i18n";
import { numberedKeyLabel } from "./music";
import { numberedBlackKeyGuide } from "./numbered";

export function scoreKeyLabel(key: string) {
  return numberedKeyLabel(key).replace(
    /([A-G][♯♭#b]*) minor$/,
    (_, tonic: string) =>
      translate("{key} minor", undefined, { key: tonic.trim() }),
  );
}

export function scoreBlackKeyGuide(key: string) {
  const guide = numberedBlackKeyGuide(key);
  return translate(guide)
    .replace("Black keys in this key: ", translate("Black keys in this key: "))
    .replace(" (included in the key signature)", translate(" (included in the key signature)"));
}

export function updateMessage(message: string): string {
  for (const prefix of ["Update check failed: ", "Update not completed: ", "Rollback not completed: "])
    if (message.startsWith(prefix))
      return translate(`${prefix}{error}`, undefined, {
        error: updateMessage(message.slice(prefix.length)),
      });
  const server = /^Update server returned (\d+)\.$/.exec(message);
  return server
    ? translate("The update server returned {status}.", undefined, { status: server[1] })
    : translate(message);
}
