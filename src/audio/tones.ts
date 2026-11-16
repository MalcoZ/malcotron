/**
 * Guitar tones: four sampled voices from the FluidR3_GM soundfont (see
 * ASSETS.md). Only the chosen one is loaded.
 */
import * as Tone from 'tone';
import { METRONOME, PLAYBACK, TONES, type ToneId } from '../config';
import { midiToFrequency } from '../content/music';

export interface GuitarTone {
  readonly id: string;
  readonly label: string;
  /** Resolves when every sample has loaded and decoded. */
  readonly loaded: Promise<void>;
  /** Strike a note at an audio-context time and let it ring for `seconds`. */
  play(soundingMidi: number, seconds: number, audioTime: number): void;
  /** Silence everything that is ringing. */
  silence(): void;
}

/** One sample per semitone, sounding E2 to B5: all a guitar in standard tuning needs. */
function sampleUrls(): Record<number, string> {
  const urls: Record<number, string> = {};
  for (let midi = PLAYBACK.sampleMidiMin; midi <= PLAYBACK.sampleMidiMax; midi++) {
    urls[midi] = `${midi}.mp3`;
  }
  return urls;
}

/** A sampled guitar voice. Its samples start loading when it is created. */
export function createGuitar(id: ToneId): GuitarTone {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const loaded = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const sampler = new Tone.Sampler({
    urls: sampleUrls(),
    baseUrl: `${import.meta.env.BASE_URL}samples/${id}/`,
    release: PLAYBACK.releaseSeconds,
    volume: PLAYBACK.melodyVolumeDb,
    onload: () => resolve(),
    onerror: (error) => reject(error),
  }).toDestination();

  return {
    id,
    label: TONES.find((t) => t.id === id)!.label,
    loaded,
    play(soundingMidi, seconds, audioTime) {
      sampler.triggerAttackRelease(midiToFrequency(soundingMidi), seconds, audioTime);
    },
    silence() {
      sampler.releaseAll();
    },
  };
}

export interface ClickSound {
  /** Sound one click at an audio-context time: accent loudest, subdivisions quietest. */
  play(kind: 'accent' | 'beat' | 'sub', audioTime: number): void;
}

/**
 * The metronome click: a very short burst of high-passed noise, so it is high
 * and has no pitch a guitar could be confused with (spec section 5).
 */
export function createClick(): ClickSound {
  const filter = new Tone.Filter(METRONOME.highpassHz, 'highpass').toDestination();
  const synth = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: METRONOME.decaySeconds, sustain: 0, release: 0.01 },
  }).connect(filter);
  return {
    play(kind, audioTime) {
      const db =
        kind === 'accent'
          ? METRONOME.accentDb
          : kind === 'beat'
            ? METRONOME.beatDb
            : METRONOME.subDb;
      synth.volume.setValueAtTime(db, audioTime);
      synth.triggerAttackRelease(METRONOME.decaySeconds, audioTime);
    },
  };
}
