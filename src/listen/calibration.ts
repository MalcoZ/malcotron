/**
 * Mic settings for this browser and device (spec section 5): whether the mic
 * is in use, the noise gate, the guitar's tuning offset and the timing
 * correction. Kept in localStorage and never exported.
 */
import { LISTEN, STORAGE_KEYS } from '../config';

export interface Calibration {
  /** The learner has chosen to be graded by the mic. */
  micEnabled: boolean;
  /** Level below which the mic hears only the room (RMS, 0 to 1). */
  noiseGate: number;
  /** How far the guitar is from A440, in cents (flat is negative). */
  tuningCents: number;
  /** How late this device hears a note played exactly on the click (ms). */
  latencyMs: number;
  /** Which of the three measurements have been done. */
  measured: { noise: boolean; tuning: boolean; latency: boolean };
}

export function defaultCalibration(): Calibration {
  return {
    micEnabled: false,
    noiseGate: LISTEN.defaultNoiseGate,
    tuningCents: 0,
    latencyMs: 0,
    measured: { noise: false, tuning: false, latency: false },
  };
}

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

export function parseCalibration(text: string | null): Calibration {
  const base = defaultCalibration();
  if (!text) return base;
  try {
    const data = JSON.parse(text) as Partial<Calibration> | null;
    if (!data || typeof data !== 'object') return base;
    return {
      micEnabled: data.micEnabled === true,
      noiseGate: num(data.noiseGate, base.noiseGate, 0.0005, 0.5),
      tuningCents: num(data.tuningCents, 0, -100, 100),
      latencyMs: num(data.latencyMs, 0, -100, 500),
      measured: {
        noise: data.measured?.noise === true,
        tuning: data.measured?.tuning === true,
        latency: data.measured?.latency === true,
      },
    };
  } catch {
    return base;
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export class CalibrationStore {
  private data: Calibration;
  private listeners = new Set<() => void>();

  constructor(private readonly store: Store | null) {
    let text: string | null = null;
    try {
      text = store?.getItem(STORAGE_KEYS.calibration) ?? null;
    } catch {
      // Storage blocked: settings last for this visit.
    }
    this.data = parseCalibration(text);
  }

  get value(): Readonly<Calibration> {
    return this.data;
  }

  update(change: Partial<Calibration>): void {
    this.data = {
      ...this.data,
      ...change,
      measured: { ...this.data.measured, ...change.measured },
    };
    try {
      this.store?.setItem(STORAGE_KEYS.calibration, JSON.stringify(this.data));
    } catch {
      // Keep going with in-memory settings.
    }
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Median of some numbers (0 for none). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Sounding MIDI numbers of the six open strings, 6th to 1st. */
export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64] as const;

/** Which open string a heard pitch is, if it is within a semitone of one: index 0 (6th) to 5 (1st). */
export function openStringFor(midi: number): number | null {
  const index = OPEN_STRINGS.findIndex((open) => Math.abs(midi - open) < 1);
  return index >= 0 ? index : null;
}

/** Timing correction from onsets heard against clicks: the median lateness, in ms. */
export function latencyFromOffsets(offsetsMs: readonly number[]): number | null {
  // Ignore strikes nowhere near a click, then need most of the clicks to have been played.
  const near = offsetsMs.filter((ms) => Math.abs(ms) < 300);
  return near.length >= Math.ceil(LISTEN.calibrationClicks * 0.6) ? Math.round(median(near)) : null;
}
