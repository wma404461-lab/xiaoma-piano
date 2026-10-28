export interface PitchEstimate {
  frequency: number;
  confidence: number;
  rms: number;
}

/** YIN-style monophonic estimator. Returns null for silence/unreliable frames. */
export function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
): PitchEstimate | null {
  const stride = Math.max(1, Math.floor(sampleRate / 12000));
  const length = Math.floor(samples.length / stride);
  const data = new Float32Array(length);
  let energy = 0;
  let mean = 0;
  for (let i = 0; i < length; i++) {
    data[i] = samples[i * stride];
    mean += data[i];
  }
  mean /= length;
  for (let i = 0; i < length; i++) {
    data[i] -= mean;
    energy += data[i] * data[i];
  }
  const rms = Math.sqrt(energy / length);
  if (rms < 0.008) return null;
  const rate = sampleRate / stride;
  const minTau = Math.floor(rate / 2100);
  const maxTau = Math.min(Math.floor(rate / 65), Math.floor(length / 2));
  const difference = new Float32Array(maxTau + 1);
  const half = length - maxTau;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = data[i] - data[i + tau];
      sum += d * d;
    }
    difference[tau] = sum;
  }
  let running = 0;
  const normalized = new Float32Array(maxTau + 1);
  normalized[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += difference[tau];
    normalized[tau] = running > 0 ? (difference[tau] * tau) / running : 1;
  }
  let candidate = -1;
  for (let tau = Math.max(2, minTau); tau < maxTau; tau++) {
    if (normalized[tau] < 0.12) {
      while (tau + 1 < maxTau && normalized[tau + 1] < normalized[tau]) tau++;
      candidate = tau;
      break;
    }
  }
  if (candidate < 0) return null;
  const confidence = 1 - normalized[candidate];
  if (confidence < 0.88) return null;
  const a = normalized[candidate - 1],
    b = normalized[candidate],
    c = normalized[candidate + 1];
  const divisor = 2 * (2 * b - c - a);
  const refined =
    candidate + (Math.abs(divisor) > 1e-9 ? (c - a) / divisor : 0);
  const frequency = rate / refined;
  if (!Number.isFinite(frequency) || frequency < 65 || frequency > 2100)
    return null;
  return { frequency, confidence, rms };
}
