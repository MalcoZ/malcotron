/**
 * Note check: the learner plays ten known notes, named by string and fret, and
 * the app shows what it heard for each. It separates "the listener hears the
 * wrong pitch" from "the learner read the staff wrong", and its report (text,
 * plus optionally the audio) is what to send when listening misbehaves.
 */
import type { Frame } from './frames';

export interface CheckTarget {
  /** Guitar string, 1 (high E) to 6 (low E). */
  string: number;
  fret: number;
  /** Sounding pitch as a MIDI number. */
  midi: number;
}

const OPEN = [64, 59, 55, 50, 45, 40]; // strings 1 to 6, sounding

function target(string: number, fret: number): CheckTarget {
  return { string, fret, midi: OPEN[string - 1]! + fret };
}

/** Low to high, every string, open and fretted. */
export const CHECK_TARGETS: readonly CheckTarget[] = [
  target(6, 0),
  target(6, 3),
  target(5, 0),
  target(5, 3),
  target(4, 2),
  target(3, 0),
  target(3, 2),
  target(2, 1),
  target(1, 0),
  target(1, 3),
];

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Note name with its octave, in sounding pitch (middle C is C4). */
export function noteWithOctave(midi: number): string {
  const m = Math.round(midi);
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function ordinalString(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

export function describeTarget(t: CheckTarget): string {
  const name = NAMES[t.midi % 12]!;
  return `${ordinalString(t.string)} string, ${t.fret === 0 ? 'open' : `fret ${t.fret}`} (${name})`;
}

export type Verdict = 'right' | 'octave' | 'harmonic' | 'wrong' | 'nothing';

export interface CheckResult {
  target: CheckTarget;
  /** Median pitch of the clear frames of the note, fractional MIDI; null if none. */
  heard: number | null;
  verdict: Verdict;
  /** Share of the note's clear frames on each rounded pitch, largest first. */
  spread: { midi: number; share: number }[];
  /** Mean clarity of the frames that had a pitch. */
  clarity: number;
  /** Loudest frame level (RMS). */
  peak: number;
  /** Frames looked at, and how many of them had a clear pitch. */
  frames: number;
  voiced: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function verdictFor(targetMidi: number, heard: number | null): Verdict {
  if (heard === null) return 'nothing';
  const diff = heard - targetMidi;
  if (Math.abs(diff) < 0.5) return 'right';
  const near = (n: number) => Math.abs(diff - n) < 0.5;
  if (near(12) || near(-12) || near(24) || near(-24)) return 'octave';
  // The 3rd and 5th harmonics: an octave and a fifth, two octaves and a third.
  if (near(19) || near(28)) return 'harmonic';
  return 'wrong';
}

/** Judge one played note from the frames heard while it sounded. */
export function judge(t: CheckTarget, frames: readonly Frame[]): CheckResult {
  const voiced = frames.filter((f) => f.midi !== null);
  const pitches = voiced.map((f) => f.midi!);
  const heard = pitches.length ? median(pitches) : null;
  const counts = new Map<number, number>();
  for (const p of pitches) counts.set(Math.round(p), (counts.get(Math.round(p)) ?? 0) + 1);
  const spread = [...counts.entries()]
    .map(([midi, n]) => ({ midi, share: n / pitches.length }))
    .sort((a, b) => b.share - a.share);
  return {
    target: t,
    heard,
    verdict: verdictFor(t.midi, heard),
    spread,
    clarity: voiced.length ? voiced.reduce((s, f) => s + f.clarity, 0) / voiced.length : 0,
    peak: frames.reduce((m, f) => Math.max(m, f.level), 0),
    frames: frames.length,
    voiced: voiced.length,
  };
}

/** Plain sentences on what went wrong, if anything, across the whole check. */
export function diagnose(results: readonly CheckResult[]): string[] {
  const done = results.filter((r) => r.verdict !== 'nothing');
  if (done.length === 0) return ['Nothing was heard. Check the mic is on and the level moves.'];
  const lines: string[] = [];
  const right = done.filter((r) => r.verdict === 'right').length;
  lines.push(`${right} of ${done.length} notes were heard as played.`);
  const octave = done.filter((r) => r.verdict === 'octave' || r.verdict === 'harmonic');
  if (octave.length) {
    const low = octave.filter((r) => r.target.string >= 4).length;
    lines.push(
      `${octave.length} heard in the wrong octave (or as an overtone)` +
        (low >= octave.length / 2 ? ', mostly on the low strings.' : '.') +
        ' The listener is locking onto an overtone instead of the note itself.',
    );
  }
  const wrong = done.filter((r) => r.verdict === 'wrong');
  if (wrong.length) {
    const offsets = wrong.map((r) => Math.round(r.heard! - r.target.midi));
    const same = offsets.every((o) => o === offsets[0]);
    if (same && wrong.length >= 3) {
      const n = offsets[0]!;
      lines.push(
        `${wrong.length} were all ${Math.abs(n)} semitone${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'high' : 'low'}. ` +
          'A steady shift like that points at the guitar’s tuning or the audio settings, not at your playing.',
      );
    } else {
      lines.push(`${wrong.length} heard as a different note.`);
    }
  }
  const quiet = done.filter((r) => r.voiced < r.frames / 3);
  if (quiet.length) {
    lines.push(
      `${quiet.length} had a clear pitch for less than a third of the time: too quiet, or noisy.`,
    );
  }
  return lines;
}

/** A text report to copy and send. */
export function report(
  results: readonly CheckResult[],
  info: { sampleRate: number; gate: number; tuningCents: number; userAgent: string },
): string {
  const lines = [
    'Malcotron note check',
    `Sample rate ${info.sampleRate} Hz · gate ${(info.gate * 100).toFixed(2)}% · tuning ${info.tuningCents.toFixed(0)} cents`,
    info.userAgent,
    '',
  ];
  for (const r of results) {
    const t = r.target;
    const heard =
      r.heard === null
        ? 'nothing'
        : `${noteWithOctave(r.heard)} (${(440 * Math.pow(2, (r.heard - 69) / 12)).toFixed(1)} Hz, ${r.heard.toFixed(2)})`;
    const spread = r.spread
      .slice(0, 3)
      .map((s) => `${noteWithOctave(s.midi)} ${Math.round(s.share * 100)}%`)
      .join(', ');
    lines.push(
      `${ordinalString(t.string)} string fret ${t.fret}: wanted ${noteWithOctave(t.midi)}, heard ${heard} → ${r.verdict}` +
        ` | clear ${r.voiced}/${r.frames} frames, clarity ${r.clarity.toFixed(2)}, peak ${(r.peak * 100).toFixed(1)}%` +
        (spread ? ` | ${spread}` : ''),
    );
  }
  lines.push('', ...diagnose(results));
  return lines.join('\n');
}
