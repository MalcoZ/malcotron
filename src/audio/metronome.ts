/**
 * Metronome: which beats get a click. Pure, so it can be unit-tested; the
 * player schedules the result on the clock and tones.ts makes the sound.
 */
import { fracToNumber } from '../content/music';
import type { Timeline } from './timeline';

export interface Click {
  /** Beat position (quarter notes); negative during the count-in. */
  readonly beat: number;
  /** True on the first pulse of a bar. */
  readonly accent: boolean;
  /** True for a subdivision between pulses (quieter). */
  readonly sub: boolean;
}

export type Subdivision = 1 | 2 | 3 | 4;

/**
 * Length of one metronome pulse in quarter-note beats. Simple meters click on
 * the bottom number of the time signature; compound meters (6/8, 9/8, 12/8)
 * click on the dotted quarter.
 */
export function pulseBeats(meter: { beats: number; beatUnit: number }): number {
  if (meter.beatUnit === 8 && meter.beats % 3 === 0 && meter.beats > 3) return 1.5;
  return 4 / meter.beatUnit;
}

/** Beats of count-in for a number of bars of this piece. */
export function countInBeats(timeline: Timeline, bars: number): number {
  return fracToNumber(timeline.beatsPerBar) * bars;
}

export interface ClickOptions {
  /** Clicks per pulse: 1 none extra, 2 eighths, 3 triplets, 4 sixteenths (of a quarter pulse). */
  subdivision?: Subdivision;
  /** Only click from this beat to that one (default: count-in start to the end of the piece). */
  fromBeat?: number;
  toBeat?: number;
}

/**
 * One click per pulse from the start of the count-in to the end of the piece,
 * accented on the first pulse of every bar, with optional subdivisions. The
 * count-in itself is never subdivided.
 */
export function clicksFor(
  timeline: Timeline,
  leadInBeats: number,
  options: ClickOptions = {},
): Click[] {
  const perBar = fracToNumber(timeline.beatsPerBar);
  const pulse = pulseBeats(timeline.meter);
  const from = options.fromBeat ?? 0 - leadInBeats;
  const to = options.toBeat ?? fracToNumber(timeline.totalBeats);
  const subdivision = options.subdivision ?? 1;
  const clicks: Click[] = [];
  const pulsesPerBar = Math.max(1, Math.round(perBar / pulse));
  const leadPulses = Math.round(leadInBeats / pulse);
  const first = Math.ceil((from + leadInBeats) / pulse - 1e-9) + 0; // + 0 turns -0 into 0
  for (let i = first; ; i++) {
    const beat = i * pulse - leadInBeats;
    if (beat >= to - 1e-9) break;
    const inBar = (((i - leadPulses) % pulsesPerBar) + pulsesPerBar) % pulsesPerBar;
    clicks.push({ beat, accent: inBar === 0, sub: false });
    if (beat >= 0) {
      for (let k = 1; k < subdivision; k++) {
        const at = beat + (k * pulse) / subdivision;
        if (at < to - 1e-9) clicks.push({ beat: at, accent: false, sub: true });
      }
    }
  }
  return clicks;
}

/** The number to show during a count-in ("1 2 3 4"), or null once the music has started. */
export function countInNumber(beat: number, leadInBeats: number, pulse = 1): number | null {
  if (beat >= 0 || leadInBeats <= 0) return null;
  const pulses = Math.round(leadInBeats / pulse);
  return Math.min(pulses, Math.max(1, Math.floor((beat + leadInBeats) / pulse) + 1));
}

/** How far through the current pulse a beat is, 0 to 1 (for the visual metronome). */
export function pulsePhase(beat: number, leadInBeats: number, pulse = 1): number {
  const x = (beat + leadInBeats) / pulse;
  return x - Math.floor(x);
}
