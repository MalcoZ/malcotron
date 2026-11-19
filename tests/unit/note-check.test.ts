import { describe, expect, it } from 'vitest';
import { FrameAnalyser, type Frame } from '../../src/listen/frames';
import {
  CHECK_TARGETS,
  describeTarget,
  diagnose,
  judge,
  noteWithOctave,
  report,
  verdictFor,
  type CheckResult,
} from '../../src/listen/note-check';
import { renderTake } from '../../src/listen/synth';

const RATE = 48000;

/** Synthesize one plucked note and run it through the real analyser. */
function framesFor(midi: number, gain = 1): Frame[] {
  const samples = renderTake([{ time: 0.1, midi, duration: 1 }], RATE, 1.2, { gain });
  const analyser = new FrameAnalyser(RATE);
  const frames: Frame[] = [];
  for (let i = 0; i + 512 <= samples.length; i += 512) {
    frames.push(...analyser.push(samples.subarray(i, i + 512), i / RATE));
  }
  // What the check looks at: the first 0.6 s after the attack.
  return frames.filter((f) => f.time >= 0.1 && f.time < 0.7);
}

describe('note check', () => {
  it('covers every string, low to high, named by string and fret', () => {
    expect(new Set(CHECK_TARGETS.map((t) => t.string))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(CHECK_TARGETS.map((t) => t.midi)).toEqual([40, 43, 45, 48, 52, 55, 57, 60, 64, 67]);
    expect(describeTarget(CHECK_TARGETS[0]!)).toBe('6th string, open (E)');
    expect(describeTarget(CHECK_TARGETS[3]!)).toBe('5th string, fret 3 (C)');
    expect(noteWithOctave(40)).toBe('E2');
    expect(noteWithOctave(60)).toBe('C4');
  });

  it('hears each of the ten notes right on a synthesized guitar', () => {
    for (const t of CHECK_TARGETS) {
      const result = judge(t, framesFor(t.midi));
      expect(result.verdict, describeTarget(t)).toBe('right');
      expect(result.voiced).toBeGreaterThan(result.frames / 2);
    }
  });

  it('names octave slips, overtones and wrong notes', () => {
    expect(verdictFor(45, 45.3)).toBe('right');
    expect(verdictFor(45, 57)).toBe('octave');
    expect(verdictFor(40, 64)).toBe('octave');
    expect(verdictFor(40, 59)).toBe('harmonic');
    expect(verdictFor(45, 47)).toBe('wrong');
    expect(verdictFor(45, null)).toBe('nothing');
    // A note played as a different one is judged on what was heard.
    expect(judge(CHECK_TARGETS[2]!, framesFor(47)).verdict).toBe('wrong');
  });

  it('diagnoses a steady shift, octave trouble on low strings, and silence', () => {
    const fake = (i: number, heard: number | null): CheckResult => ({
      ...judge(CHECK_TARGETS[i]!, []),
      heard,
      verdict: verdictFor(CHECK_TARGETS[i]!.midi, heard),
      frames: 10,
      voiced: heard === null ? 0 : 10,
    });
    const shifted = CHECK_TARGETS.map((t, i) => fake(i, t.midi + 2));
    expect(diagnose(shifted).join(' ')).toContain('all 2 semitones high');
    const octaves = CHECK_TARGETS.map((t, i) => fake(i, t.string >= 4 ? t.midi + 12 : t.midi));
    expect(diagnose(octaves).join(' ')).toContain('mostly on the low strings');
    expect(diagnose([fake(0, null)])[0]).toContain('Nothing was heard');

    const text = report(octaves, {
      sampleRate: 48000,
      gate: 0.01,
      tuningCents: -5,
      userAgent: 'test',
    });
    expect(text).toContain('Sample rate 48000 Hz');
    expect(text).toContain('6th string fret 0: wanted E2, heard E3');
    expect(text.split('\n').filter((l) => l.includes('wanted'))).toHaveLength(10);
  });
});
