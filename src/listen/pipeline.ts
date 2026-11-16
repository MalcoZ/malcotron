/** The whole listening chain for a block of recorded samples (used by tests and the harness). */
import { FrameAnalyser } from './frames';
import { Segmenter, type PlayedNote } from './segment';

export interface AnalyseOptions {
  noiseGate?: number;
  tuningOffsetCents?: number;
}

/** Samples in, played notes out, with onsets in seconds from the first sample. */
export function analyseSamples(
  samples: Float32Array,
  sampleRate: number,
  options: AnalyseOptions = {},
): PlayedNote[] {
  const analyser = new FrameAnalyser(sampleRate);
  const segmenter = new Segmenter();
  if (options.noiseGate !== undefined) {
    analyser.noiseGate = options.noiseGate;
    segmenter.setNoiseGate(options.noiseGate);
  }
  if (options.tuningOffsetCents) analyser.setTuningOffsetCents(options.tuningOffsetCents);
  const notes: PlayedNote[] = [];
  const block = 4096;
  for (let i = 0; i < samples.length; i += block) {
    const chunk = samples.subarray(i, Math.min(samples.length, i + block));
    for (const frame of analyser.push(chunk, i / sampleRate)) {
      notes.push(...segmenter.push(frame).ended);
    }
  }
  notes.push(...segmenter.flush(samples.length / sampleRate).ended);
  return notes;
}
