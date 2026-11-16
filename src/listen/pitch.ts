/**
 * Pitch detection: the McLeod Pitch Method (normalised square difference),
 * written here rather than taken from a library so the browser, the AudioWorklet
 * path and the Node test harness all run exactly the same code.
 */
import { LISTEN } from '../config';

export interface PitchEstimate {
  /** Frequency in Hz, or null when the frame has no clear pitch. */
  hz: number | null;
  /** How periodic the frame is, 0 to 1. */
  clarity: number;
}

export function hzToMidi(hz: number, a4 = 440): number {
  return 69 + 12 * Math.log2(hz / a4);
}

/** Reusable detector for one frame size and sample rate. */
export class PitchDetector {
  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly nsdf: Float32Array;

  constructor(
    private readonly sampleRate: number,
    private readonly frameSize: number = LISTEN.frameSize,
  ) {
    this.minLag = Math.max(2, Math.floor(sampleRate / LISTEN.maxHz));
    this.maxLag = Math.min(frameSize - 2, Math.ceil(sampleRate / LISTEN.minHz));
    this.nsdf = new Float32Array(this.maxLag + 2);
  }

  detect(frame: Float32Array): PitchEstimate {
    const n = this.frameSize;
    const { nsdf, maxLag, minLag } = this;
    // Normalised square difference: 2 * autocorrelation / summed energy, in [-1, 1].
    for (let lag = 0; lag <= maxLag + 1 && lag < n; lag++) {
      let acf = 0;
      let energy = 0;
      for (let i = 0; i + lag < n; i++) {
        const a = frame[i]!;
        const b = frame[i + lag]!;
        acf += a * b;
        energy += a * a + b * b;
      }
      nsdf[lag] = energy > 0 ? (2 * acf) / energy : 0;
    }

    // Key maxima: the highest point of each positive lobe after the first zero crossing.
    const peaks: number[] = [];
    let lag = 1;
    while (lag <= maxLag && nsdf[lag]! > 0) lag++; // leave the lobe around lag 0
    let best = -1;
    for (; lag <= maxLag; lag++) {
      const v = nsdf[lag]!;
      if (v > 0) {
        if (best < 0 || v > nsdf[best]!) best = lag;
      } else if (best >= 0) {
        if (best >= minLag) peaks.push(best);
        best = -1;
      }
    }
    if (best >= minLag) peaks.push(best);
    if (peaks.length === 0) return { hz: null, clarity: 0 };

    const highest = Math.max(...peaks.map((p) => nsdf[p]!));
    // The first peak close to the highest is the fundamental; later ones are its multiples.
    const chosen = peaks.find((p) => nsdf[p]! >= LISTEN.peakPickRatio * highest)!;
    // Parabolic interpolation around the peak for a sub-sample period.
    const y0 = nsdf[chosen - 1]!;
    const y1 = nsdf[chosen]!;
    const y2 = nsdf[chosen + 1]!;
    const denom = y0 - 2 * y1 + y2;
    const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
    const period = chosen + shift;
    const clarity = Math.min(1, y1 - (denom * shift * shift) / 2);
    return { hz: this.sampleRate / period, clarity };
  }
}
