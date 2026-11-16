/**
 * Guitar tones. M0 ships one voice, a sampled nylon classical guitar from the
 * FluidR3_GM soundfont (see ASSETS.md). M1 adds three more behind the same
 * interface and lazy-loads them.
 */
import * as Tone from 'tone';
import { PLAYBACK } from '../config';
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

export function createNylonGuitar(): GuitarTone {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const loaded = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const sampler = new Tone.Sampler({
    urls: sampleUrls(),
    baseUrl: `${import.meta.env.BASE_URL}samples/nylon/`,
    release: PLAYBACK.releaseSeconds,
    volume: PLAYBACK.melodyVolumeDb,
    onload: () => resolve(),
    onerror: (error) => reject(error),
  }).toDestination();

  return {
    id: 'nylon',
    label: 'Nylon classical',
    loaded,
    play(soundingMidi, seconds, audioTime) {
      sampler.triggerAttackRelease(midiToFrequency(soundingMidi), seconds, audioTime);
    },
    silence() {
      sampler.releaseAll();
    },
  };
}
