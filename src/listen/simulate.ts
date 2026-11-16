/**
 * A simulated learner, for end-to-end tests and demos: when a Your turn pass
 * starts, it "plays" the piece into a SimulatedMic as synthesized audio, in
 * time with the clock, with whatever mistakes it is told to make. The audio
 * goes through the same pipeline as a real mic.
 */
import type { Timeline } from '../audio/timeline';
import { fracToNumber } from '../content/music';
import type { SimulatedMic } from './mic';
import { renderTake, type SynthNote } from './synth';

export interface SimulatedMistakes {
  /** Indices (among the struck notes, from 0) to play two semitones sharp. */
  wrong?: number[];
  /** Indices to leave out. */
  missed?: number[];
  /** Play everything this many milliseconds late (negative for early). */
  lateMs?: number;
}

export interface SimClock {
  /** Audio time at which the current run started. */
  readonly startedAtAudioTime: number;
  readonly audioTime: number;
  readonly leadIn: number;
  readonly tempo: number;
  readonly state: 'stopped' | 'running';
}

/** Feed notes placed on the beat grid into the mic, in time with the clock. Returns a stop function. */
export function simulateNotes(
  mic: SimulatedMic,
  clock: SimClock,
  played: ReadonlyArray<{ beat: number; midi: number; durationBeats: number }>,
  lateMs = 0,
): () => void {
  const rate = mic.sampleRate;
  const beat = 60 / clock.tempo;
  const lead = clock.leadIn * beat;
  const notes: SynthNote[] = played.map((n) => ({
    time: lead + n.beat * beat + lateMs / 1000,
    midi: n.midi,
    duration: n.durationBeats * beat * 0.9,
  }));
  const last = Math.max(0, ...notes.map((n) => n.time + n.duration));
  const samples = renderTake(notes, rate, last + 0.4, { noise: 0.002, seed: 3 });
  const start = clock.startedAtAudioTime;
  let fed = 0;
  let frame = 0;
  const pump = () => {
    // Deliver everything "played" up to the present moment on the audio clock.
    const upTo = Math.min(samples.length, Math.floor((clock.audioTime - start) * rate));
    while (fed + 512 <= upTo) {
      mic.feed(samples.subarray(fed, fed + 512), start + fed / rate);
      fed += 512;
    }
    if (clock.state === 'running' && fed + 512 <= samples.length)
      frame = requestAnimationFrame(pump);
  };
  frame = requestAnimationFrame(pump);
  return () => cancelAnimationFrame(frame);
}

/** Start feeding one take of a piece into the mic. Returns a function that stops it. */
export function simulateTake(
  mic: SimulatedMic,
  clock: SimClock,
  timeline: Timeline,
  mistakes: SimulatedMistakes = {},
): () => void {
  const played = timeline.events
    .filter((e) => !e.isRest && !e.tiedFromPrevious)
    .flatMap((e, i) => {
      if (mistakes.missed?.includes(i)) return [];
      return [
        {
          beat: fracToNumber(e.startBeat),
          midi: e.soundingMidi! + (mistakes.wrong?.includes(i) ? 2 : 0),
          durationBeats: fracToNumber(e.soundingBeats),
        },
      ];
    });
  return simulateNotes(mic, clock, played, mistakes.lateMs ?? 0);
}
