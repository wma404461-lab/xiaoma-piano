export type Hand = "right" | "left";
export type Hands = Hand | "both";
export type Notation = "staff" | "numbered" | "beginner" | "hybrid" | "waterfall";
export type PracticeMode = "wait" | "rhythm" | "listen" | "game";
export type InputSource = "keyboard" | "microphone" | "midi";
export type Page =
  | "home"
  | "library"
  | "scores"
  | "practice"
  | "progress";
export interface SpelledPitch {
  step: string;
  alter: number;
  octave: number;
}

export interface ScoreNote {
  spellings?: Record<number, SpelledPitch>;
  key?: string;
  id: string;
  pitches: number[];
  beats: number;
  beat: number;
  measure: number;
  hand: Hand;
  attackPitches?: number[];
  playDurations?: Record<number, number>;
  tuplet?: string;
}
export interface Measure {
  key?: string;
  right: ScoreNote[];
  left: ScoreNote[];
  duration?: number;
  signature?: string;
}
export interface TempoPoint {
  /** Absolute position in quarter-note beats. BPM also uses quarter notes. */
  beat: number;
  bpm: number;
}
export interface Song {
  tempoIsReference?: boolean;
  tempoMap?: TempoPoint[];
  notationVersion?: number;
  id: string;
  title: string;
  englishTitle?: string;
  subtitle: string;
  composer: string;
  category:
    "Familiar melodies" | "Classical starters" | "Exercises" | "Popular" | "Classical" | "My scores";
  level: 1 | 2 | 3;
  defaultPracticeTempo?: number;
  tempo: number;
  meter: number;
  key: string;
  color: string;
  motif: string;
  description: string;
  skills: string[];
  measures: Measure[];
  signature?: string;
  xml?: string;
  scoreAsset?: string;
  scoreSha256?: string;
  measureCount?: number;
  durationSeconds?: number;
  onlineUrl?: string;
  sourceVerified?: boolean;
  sourceUrl?: string;
  sourceLabel?: string;
  pdfUrl?: string;
  license?: string;
  contributor?: string;
  scoreNotice?: string;
  editionLabel?: string;
  originalScoreUrl?: string;
}
export interface ExpectedEvent {
  id: string;
  beat: number;
  beats: number;
  measure: number;
  pitches: number[];
  durations: Record<number, number>;
  noteIds: string[];
  localBeat?: number;
}
export interface Mistake {
  measure: number;
  expected: number[];
  played: number;
  kind: "wrong" | "missed";
}
export interface PracticeRecord {
  gameDifficulty?: "easy" | "standard" | "challenge";
  gameIntensity?: number;
  gameRulesVersion?: number;
  rounds?: number;
  points?: number;
  bestCombo?: number;
  id: string;
  songId: string;
  title: string;
  date: string;
  activeSeconds: number;
  correct: number;
  wrong: number;
  missed: number;
  completed: boolean;
  tempo: number;
  mode: PracticeMode;
  source: InputSource;
  hands: Hands;
  fromMeasure: number;
  toMeasure: number;
  mistakes: Mistake[];
}
export interface UserData {
  version: 1;
  favorites: string[];
  recentSongId: string;
  recentSongIds: string[];
  records: PracticeRecord[];
  notation: Notation;
  dailyGoal: number;
}
