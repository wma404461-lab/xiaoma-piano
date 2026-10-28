import type { Song } from "../types";
import type { Locale } from "./i18n";
type NamedSong = Pick<Song, "id" | "title"> & Partial<Song>;
// Imported metadata belongs to the user; do not invent translated credits.
export function songTitle(song: NamedSong, _locale?: Locale): string { return song.englishTitle || song.title; }
export function songSubtitle(song: Song, _locale?: Locale): string { return song.subtitle; }
export function songComposer(song: Song, _locale?: Locale): string { return song.composer; }
export function localizeMusician(name: string, _locale?: Locale): string { return name; }
export function songDescription(song: Song, _locale?: Locale): string { return song.description; }
