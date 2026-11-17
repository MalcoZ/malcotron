/**
 * Alignment and grading (spec section 5, steps 4 and 5): match what was heard
 * to what was written, then mark each written note green, amber or red.
 */
import { LISTEN } from '../config';
import type { NoteEvent, Timeline } from '../audio/timeline';
import { fracToNumber } from '../content/music';
import { stageNumber } from '../content/stages';
import type { Piece } from '../content/types';

/** A written note the learner should strike. */
export interface ExpectedNote {
  /** Index in the timeline's events. */
  index: number;
  barIndex: number;
  noteIndex: number;
  beat: number;
  /** Sounding MIDI number. */
  midi: number;
}

/** A note the mic heard, placed on the beat grid. */
export interface HeardNote {
  beat: number;
  /** Sounding pitch, fractional MIDI. */
  midi: number;
  clarity: number;
  durationBeats: number;
}

export type GradeStatus = 'green' | 'amber' | 'red';
export type GradeReason = 'ok' | 'timing' | 'wrong' | 'missed';

export interface NoteGrade {
  expected: ExpectedNote;
  status: GradeStatus;
  reason: GradeReason;
  /** The right pitch was played (whatever the timing). */
  pitchCorrect: boolean;
  /** What was heard for this note, rounded to a MIDI number; null if nothing. */
  heardMidi: number | null;
  /** Late (positive) or early (negative), in milliseconds; null if nothing was heard. */
  offsetMs: number | null;
  /** The pitch was an octave out but counted, because the detector was unsure. */
  octaveForgiven: boolean;
  /** The learner corrected this grade by hand. */
  flipped: boolean;
  /** The heard note matched to this one, if any. */
  heard: HeardNote | null;
}

export interface TakeGrade {
  notes: NoteGrade[];
  /** Heard notes that matched nothing written. */
  extras: HeardNote[];
  /** The even lateness removed from every note before timing was graded (ms). */
  biasMs: number;
}

export interface Tolerance {
  greenMs: number;
  amberMs: number;
}

/** The timing tolerance for a piece: looser in the early stages (spec section 5). */
export function toleranceFor(piece: Pick<Piece, 'requires'>): Tolerance {
  const p = stageNumber(piece.requires.pitchStage, 'P') ?? 1;
  const r = stageNumber(piece.requires.rhythmStage, 'R') ?? 1;
  return p >= LISTEN.laterFromPitchStage || r >= LISTEN.laterFromRhythmStage
    ? LISTEN.later
    : LISTEN.early;
}

export function expectedNotes(timeline: Timeline): ExpectedNote[] {
  return timeline.events
    .filter((e: NoteEvent) => !e.isRest && !e.tiedFromPrevious)
    .map((e) => ({
      index: e.index,
      barIndex: e.barIndex,
      noteIndex: e.noteIndex,
      beat: fracToNumber(e.startBeat),
      midi: e.soundingMidi!,
    }));
}

type PitchMatch = 'exact' | 'octave' | 'no';

export function pitchMatch(
  expectedMidi: number,
  heard: Pick<HeardNote, 'midi' | 'clarity'>,
): PitchMatch {
  const tolerance = LISTEN.pitchCents / 100;
  const diff = heard.midi - expectedMidi;
  if (Math.abs(diff) <= tolerance) return 'exact';
  if (
    LISTEN.forgiveOctave &&
    heard.clarity < LISTEN.octaveMaxClarity &&
    Math.abs(Math.abs(diff) - 12) <= tolerance
  ) {
    return 'octave';
  }
  return 'no';
}

/**
 * Sequence alignment (Needleman-Wunsch) of written and heard notes, scoring
 * both pitch and timing, so a missed or extra note does not push every later
 * note into error. Returns, for each written note, the index of the heard
 * note matched to it, or null.
 * @param timeWeight 0 ignores timing (used before the tempo is known)
 */
export function align(
  expected: readonly ExpectedNote[],
  heard: readonly HeardNote[],
  timeWeight = 1,
): (number | null)[] {
  const A = LISTEN.align;
  const n = expected.length;
  const m = heard.length;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 pair, 2 missed, 3 extra
  for (let i = 1; i <= n; i++) {
    score[i]![0] = i * A.missed;
    move[i]![0] = 2;
  }
  for (let j = 1; j <= m; j++) {
    score[0]![j] = j * A.extra;
    move[0]![j] = 3;
  }
  const pair = (e: ExpectedNote, h: HeardNote): number => {
    const pitch = pitchMatch(e.midi, h) === 'no' ? A.mismatch : A.match;
    const time = Math.min(A.maxTimePenalty, Math.abs(h.beat - e.beat) * A.perBeatOff) * timeWeight;
    return pitch - time;
  };
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const p = score[i - 1]![j - 1]! + pair(expected[i - 1]!, heard[j - 1]!);
      const miss = score[i - 1]![j]! + A.missed;
      const extra = score[i]![j - 1]! + A.extra;
      const best = Math.max(p, miss, extra);
      score[i]![j] = best;
      move[i]![j] = best === p ? 1 : best === miss ? 2 : 3;
    }
  }
  const matched: (number | null)[] = new Array<number | null>(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = move[i]![j]!;
    if (step === 1) matched[--i] = --j;
    else if (step === 2) i--;
    else j--;
  }
  return matched;
}

function gradeOne(
  expected: ExpectedNote,
  heard: HeardNote | undefined,
  bpm: number,
  tolerance: Tolerance,
  biasMs = 0,
): NoteGrade {
  if (!heard) {
    return {
      expected,
      status: 'red',
      reason: 'missed',
      pitchCorrect: false,
      heardMidi: null,
      offsetMs: null,
      octaveForgiven: false,
      flipped: false,
      heard: null,
    };
  }
  const match = pitchMatch(expected.midi, heard);
  const offsetMs = ((heard.beat - expected.beat) * 60000) / bpm - biasMs;
  const base = {
    expected,
    heardMidi: Math.round(heard.midi),
    offsetMs,
    octaveForgiven: match === 'octave',
    flipped: false,
    heard,
  };
  if (match === 'no') return { ...base, status: 'red', reason: 'wrong', pitchCorrect: false };
  const late = Math.abs(offsetMs);
  if (late <= tolerance.greenMs)
    return { ...base, status: 'green', reason: 'ok', pitchCorrect: true };
  if (late <= tolerance.amberMs) {
    return { ...base, status: 'amber', reason: 'timing', pitchCorrect: true };
  }
  // A timing miss: the pitch is still credited (spec section 5).
  return { ...base, status: 'red', reason: 'timing', pitchCorrect: true };
}

/**
 * The even lateness of a set of offsets: their median, limited to what an
 * audio path could plausibly add. Needs a few notes to mean anything.
 */
export function timingBias(offsetsMs: readonly number[]): number {
  if (offsetsMs.length < LISTEN.liveBiasAfterNotes) return 0;
  const sorted = [...offsetsMs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.max(-LISTEN.maxBiasMs, Math.min(LISTEN.maxBiasMs, median));
}

/**
 * Grade a whole take. Heard notes must already be on the beat grid.
 *
 * Timing is judged after removing the take's own even lateness: a player who
 * is the same amount late on every note is hearing the delay of their
 * speakers, mic and browser, not playing badly. What is graded is whether
 * each note sits where the others say the beat is.
 */
export function gradeTake(
  expected: readonly ExpectedNote[],
  heard: readonly HeardNote[],
  bpm: number,
  tolerance: Tolerance,
): TakeGrade {
  const matched = align(expected, heard);
  const used = new Set(matched.filter((j): j is number => j !== null));
  const pair = (i: number) => {
    const j = matched[i];
    return j === null || j === undefined ? undefined : heard[j];
  };
  const raw = expected.map((e, i) => gradeOne(e, pair(i), bpm, tolerance));
  const biasMs = timingBias(raw.filter((g) => g.pitchCorrect).map((g) => g.offsetMs!));
  return {
    notes:
      biasMs === 0 ? raw : expected.map((e, i) => gradeOne(e, pair(i), bpm, tolerance, biasMs)),
    extras: heard.filter((_, j) => !used.has(j)),
    biasMs,
  };
}

/**
 * Grade one heard note as it arrives, for live colouring: pair it with the
 * nearest ungraded written note of that time. The final grade comes from
 * gradeTake when the take ends.
 */
export function gradeLive(
  expected: readonly ExpectedNote[],
  taken: ReadonlySet<number>,
  heard: HeardNote,
  bpm: number,
  tolerance: Tolerance,
  biasMs = 0,
): NoteGrade | null {
  // Where the note would be on the grid without the audio path's delay.
  const at = heard.beat - (biasMs * bpm) / 60000;
  let best: ExpectedNote | null = null;
  for (const e of expected) {
    if (taken.has(e.index)) continue;
    const distance = Math.abs(e.beat - at);
    if (distance > LISTEN.liveWindowBeats) continue;
    if (!best || distance < Math.abs(best.beat - at)) best = e;
  }
  return best ? gradeOne(best, heard, bpm, tolerance, biasMs) : null;
}

/** The learner says the mic got one note wrong: swap its grade (spec section 5). */
export function flipGrade(grade: NoteGrade): NoteGrade {
  const nowRight = grade.status === 'red';
  return {
    ...grade,
    status: nowRight ? 'green' : 'red',
    reason: nowRight ? 'ok' : 'missed',
    pitchCorrect: nowRight,
    flipped: !grade.flipped,
  };
}

export interface TakeSummary {
  total: number;
  /** Right pitch, whatever the timing. This is the accuracy used for mastery. */
  pitchCorrect: number;
  onTime: number;
  accuracy: number;
}

export function summarise(grade: TakeGrade): TakeSummary {
  const total = grade.notes.length;
  const pitchCorrect = grade.notes.filter((n) => n.pitchCorrect).length;
  return {
    total,
    pitchCorrect,
    onTime: grade.notes.filter((n) => n.status === 'green').length,
    accuracy: total ? pitchCorrect / total : 1,
  };
}

/**
 * For a take with no click: fit the player's own steady tempo. Returns heard
 * notes on the beat grid, and the tempo found. Needs at least two notes that
 * match in pitch; otherwise assumes the given tempo from the first note.
 */
export function fitToOwnTempo(
  expected: readonly ExpectedNote[],
  played: ReadonlyArray<{ onset: number; duration: number; midi: number; clarity: number }>,
  fallbackBpm: number,
): { heard: HeardNote[]; bpm: number } {
  // Order alone first (timing unknown), then a least-squares line through the matches.
  const rough: HeardNote[] = played.map((p, i) => ({
    beat: i,
    midi: p.midi,
    clarity: p.clarity,
    durationBeats: 0,
  }));
  const matched = align(expected, rough, 0);
  const pairs: [number, number][] = [];
  matched.forEach((j, i) => {
    if (j !== null && pitchMatch(expected[i]!.midi, rough[j]!) !== 'no') {
      pairs.push([expected[i]!.beat, played[j]!.onset]);
    }
  });
  let secondsPerBeat = 60 / fallbackBpm;
  let start = (played[0]?.onset ?? 0) - (expected[0]?.beat ?? 0) * secondsPerBeat;
  const spread = pairs.length ? pairs.at(-1)![0] - pairs[0]![0] : 0;
  if (pairs.length >= 2 && spread > 0) {
    const meanX = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
    const meanY = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
    const sxx = pairs.reduce((s, p) => s + (p[0] - meanX) ** 2, 0);
    const sxy = pairs.reduce((s, p) => s + (p[0] - meanX) * (p[1] - meanY), 0);
    if (sxy > 0) {
      secondsPerBeat = sxy / sxx;
      start = meanY - secondsPerBeat * meanX;
    }
  }
  return {
    bpm: 60 / secondsPerBeat,
    heard: played.map((p) => ({
      beat: (p.onset - start) / secondsPerBeat,
      midi: p.midi,
      clarity: p.clarity,
      durationBeats: p.duration / secondsPerBeat,
    })),
  };
}

/**
 * The notes to play back for "Hear what I played": what the learner played
 * for each written note, where they played it, plus any extra note that was
 * clearly a note. Stray blips the mic picked up (a string squeak, a harmonic
 * as a note dies away) are left out, so the playback sounds like the take.
 */
export function replayNotes(
  grade: TakeGrade,
  bpm: number,
): { beat: number; midi: number; durationBeats: number }[] {
  const shift = (grade.biasMs * bpm) / 60000;
  const minBeats = (LISTEN.replayMinMs * bpm) / 60000;
  const notes = grade.notes
    .filter((g) => g.heard !== null)
    .map((g) => ({
      beat: g.heard!.beat - shift,
      // A right note is played at its written pitch (never an octave slip of the detector).
      midi: g.pitchCorrect ? g.expected.midi : Math.round(g.heard!.midi),
    }));
  for (const extra of grade.extras) {
    if (extra.clarity >= LISTEN.replayMinClarity && extra.durationBeats >= minBeats) {
      notes.push({ beat: extra.beat - shift, midi: Math.round(extra.midi) });
    }
  }
  notes.sort((a, b) => a.beat - b.beat);
  // Each note lasts until the next one, like a single line on a guitar.
  return notes.map((n, i) => ({
    ...n,
    durationBeats: Math.max(0.25, Math.min(4, (notes[i + 1]?.beat ?? n.beat + 2) - n.beat)),
  }));
}
