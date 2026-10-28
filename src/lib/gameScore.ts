export interface GameScore {
  points: number;
  combo: number;
  bestCombo: number;
}
export const emptyGameScore = (): GameScore => ({
  points: 0,
  combo: 0,
  bestCombo: 0,
});
export const comboMultiplier = (combo: number) =>
  Math.min(5, 1 + Math.floor(combo / 10));
export function awardHit(score: GameScore, timingBeats?: number) {
  const distance = Math.abs(timingBeats ?? 0);
  const judgement =
    timingBeats === undefined
      ? "Correct"
      : distance <= 0.12
        ? "Perfect"
        : distance <= 0.26
          ? "Accurate"
          : "Hit";
  const base =
    timingBeats === undefined
      ? 100
      : distance <= 0.12
        ? 300
        : distance <= 0.26
          ? 200
          : 100;
  const combo = score.combo + 1,
    multiplier = comboMultiplier(combo),
    earned = base * multiplier;
  return {
    score: {
      points: score.points + earned,
      combo,
      bestCombo: Math.max(score.bestCombo, combo),
    },
    earned,
    judgement,
    multiplier,
  };
}
