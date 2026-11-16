/**
 * Metronome: which beats get a click. Pure, so it can be unit-tested; the
 * player schedules the result on the clock and tones.ts makes the sound.
 */
import { fracToNumber } from '../content/music';
import type { Timeline } from './timeline';

export interface Click {
  /** Beat position; negative during the count-in. */
  readonly beat: number;
  /** True on the first beat of a bar. */
  readonly accent: boolean;
}

/** Beats of count-in for a number of bars of this piece. */
export function countInBeats(timeline: Timeline, bars: number): number {
  return fracToNumber(timeline.beatsPerBar) * bars;
}

/**
 * One click per beat from the start of the count-in to the end of the piece,
 * accented on the first beat of every bar.
 */
export function clicksFor(timeline: Timeline, leadInBeats: number): Click[] {
  const perBar = fracToNumber(timeline.beatsPerBar);
  const total = fracToNumber(timeline.totalBeats);
  const clicks: Click[] = [];
  for (let beat = 0 - leadInBeats; beat < total; beat++) {
    const inBar = ((beat % perBar) + perBar) % perBar;
    clicks.push({ beat, accent: inBar === 0 });
  }
  return clicks;
}

/** The number to show during a count-in ("1 2 3 4"), or null once the music has started. */
export function countInNumber(beat: number, leadInBeats: number): number | null {
  if (beat >= 0 || leadInBeats <= 0) return null;
  return Math.min(leadInBeats, Math.max(1, Math.floor(beat + leadInBeats) + 1));
}
