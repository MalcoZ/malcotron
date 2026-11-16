/**
 * A plain plucked-string synthesizer. It stands in for a guitar in tests and
 * for the "simulated learner" used by the end-to-end tests; it is never heard.
 */
import { midiToFrequency } from '../content/music';

export interface SynthNote {
  /** Seconds from the start of the take. */
  time: number;
  /** Sounding MIDI pitch; fractions detune it. */
  midi: number;
  /** Seconds the note is held before it is damped. */
  duration: number;
  /** Loudness, 0 to 1 (default 0.5). */
  level?: number;
}

export interface SynthOptions {
  /** Let each note ring on under the next, as open strings do, at this level (0 to 1). */
  ring?: number;
  /** White noise level added to the whole take (0 to 1). */
  noise?: number;
  /** Times of metronome clicks to mix in (seconds), as short high noise bursts. */
  clicks?: number[];
  clickLevel?: number;
  /** Seed for the noise, so takes are repeatable. */
  seed?: number;
}

function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/** Render a take to mono samples. */
export function renderTake(
  notes: readonly SynthNote[],
  sampleRate: number,
  seconds: number,
  options: SynthOptions = {},
): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const rand = random(options.seed ?? 1);
  for (const note of notes) {
    const hz = midiToFrequency(note.midi);
    const level = note.level ?? 0.5;
    const start = Math.round(note.time * sampleRate);
    const held = Math.round(note.duration * sampleRate);
    const ring = options.ring ?? 0;
    const length = Math.min(
      out.length - start,
      ring > 0 ? Math.round(2.5 * sampleRate) : held + 400,
    );
    const partials = Math.max(1, Math.min(8, Math.floor(sampleRate / 2.2 / hz)));
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let x = 0;
      for (let k = 1; k <= partials; k++) {
        // Higher partials start weaker and die away faster, like a plucked string.
        x += (Math.sin(2 * Math.PI * k * hz * t + k) / k) * Math.exp(-t * (1.2 + 0.9 * k));
      }
      const attack = Math.min(1, i / (0.003 * sampleRate));
      // Damped when the note ends, unless it is left to ring.
      const after = i - held;
      const damp = after <= 0 ? 1 : ring > 0 ? ring : Math.max(0, 1 - after / 400);
      if (start + i >= 0) out[start + i]! += x * level * attack * damp;
    }
  }
  if (options.noise) {
    for (let i = 0; i < out.length; i++) out[i]! += rand() * 2 * options.noise;
  }
  for (const time of options.clicks ?? []) {
    const start = Math.round(time * sampleRate);
    const length = Math.round(0.03 * sampleRate);
    let previous = 0;
    for (let i = 0; i < length && start + i < out.length; i++) {
      // Differenced noise is strongly high-passed, like the app's click.
      const white = rand();
      const high = white - previous;
      previous = white;
      if (start + i >= 0)
        out[start + i]! += high * (options.clickLevel ?? 0.5) * Math.exp(-i / (0.008 * sampleRate));
    }
  }
  return out;
}
