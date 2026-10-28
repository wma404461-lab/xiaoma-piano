import type { Song } from "../types";
import type { Locale } from "./i18n";
export type PortraitStyle = "short" | "fringe" | "long" | "bob" | "ponytail" | "cap" | "glasses" | "curly" | "classical" | "duo" | "music";
export interface LibraryArtist { id: string; name: string; englishName?: string; kind: "Singer" | "Musician" | "Composer" | "Exercises & traditional"; portrait: PortraitStyle; }
export function canonicalArtistName(name: string): string { return name.normalize("NFKC").trim(); }
export function libraryArtist(song: Song): LibraryArtist {
 const exercise = song.category === "Exercises";
 const name = canonicalArtistName(song.composer) || "Unknown composer";
 return {id: name, name, kind: exercise ? "Exercises & traditional" : "Composer", portrait: exercise ? "music" : "classical"};
}
export function artistName(artist: LibraryArtist, _locale: Locale): string { return artist.englishName || artist.name; }
export function groupLibraryArtists(songs: Song[]): (LibraryArtist & {songs: Song[]})[] {
 const groups = new Map<string, LibraryArtist & {songs: Song[]}>();
 for (const song of songs) { const artist = libraryArtist(song); const group = groups.get(artist.id) || {...artist, songs: []}; group.songs.push(song); groups.set(artist.id, group); }
 return [...groups.values()].sort((a,b) => b.songs.length-a.songs.length || a.name.localeCompare(b.name,"en"));
}
export function displayArtist(song: Song): string { return song.composer.trim() || song.subtitle.split("·")[0].trim() || "Unknown composer"; }
