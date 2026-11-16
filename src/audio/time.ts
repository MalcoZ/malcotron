/**
 * Pure beat <-> seconds maths. One beat is one quarter note; tempo is
 * quarter-note BPM. The clock module uses these; they have no audio
 * dependencies so they can be unit-tested and reused by the mic grader in M1.
 */
import { fracToNumber, type Fraction } from '../content/music';

/** Tone.js Transport resolution: ticks per quarter note. */
export const TICKS_PER_BEAT = 192;

function toNumber(beats: number | Fraction): number {
  return typeof beats === 'number' ? beats : fracToNumber(beats);
}

export function beatsToSeconds(beats: number | Fraction, bpm: number): number {
  return (toNumber(beats) * 60) / bpm;
}

export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

/** Whole ticks for a beat position. Every duration in the content format is a whole number of ticks. */
export function beatsToTicks(beats: number | Fraction): number {
  return Math.round(toNumber(beats) * TICKS_PER_BEAT);
}

export function ticksToBeats(ticks: number): number {
  return ticks / TICKS_PER_BEAT;
}
