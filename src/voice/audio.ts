// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.

/** 48 kHz to 16 kHz: average each group of three samples (a simple anti-aliased decimation). */
export function downsample48kTo16k(samples: Int16Array): Int16Array {
  const out = new Int16Array(Math.floor(samples.length / 3));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round((samples[3 * i]! + samples[3 * i + 1]! + samples[3 * i + 2]!) / 3);
  }
  return out;
}

/** The RMS level of a block of samples, as a fraction of full scale. */
export function level(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length) / 32768;
}
