/**
 * Exercise generator (spec section 7): short original exercises built from the
 * pitches and rhythm values the learner knows, leaning towards the ones to
 * practise. Seeded, so any exercise can be made again from its spec.
 */
import { isInKey, keyFifths, parsePitch, type Pitch } from '../content/music';
import type { Piece, PieceFile } from '../content/types';
import { buildPiece } from '../content/validate';

export interface ExerciseSpec {
  seed: number;
  key: string;
  time: string;
  bars: number;
  /** Written pitches that may be used, for example ["G4", "A4", "B4"]. */
  pool: string[];
  /** Pitches that must appear, and are favoured throughout. */
  focus: string[];
  /** Rhythm values that may be used: q h w h. 8 q. 16, rests rq rh r8, and tie. */
  rhythms: string[];
  /** Rhythm values to favour. */
  focusRhythms?: string[];
  /** 0 mostly steps, 1 skips as well, 2 leaps as well. */
  interval: number;
  /** Two pitches to set side by side (a confusion drill). */
  pair?: [string, string];
  tempo: number;
  title?: string;
}

/** A small seeded random number generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[], weight: (item: T) => number): T {
  const weights = items.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (const [i, item] of items.entries()) {
    roll -= weights[i]!;
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!;
}

/** A rhythm cell: durations that belong together, in sixteenths. */
interface Cell {
  kind: string;
  units: number;
  /** Duration codes; `r` prefix for a rest, `_` suffix for a tie into the next note. */
  parts: string[];
}

const CELLS: Cell[] = [
  { kind: 'w', units: 16, parts: ['w'] },
  { kind: 'h.', units: 12, parts: ['h.'] },
  { kind: 'h', units: 8, parts: ['h'] },
  { kind: 'q', units: 4, parts: ['q'] },
  { kind: '8', units: 4, parts: ['8', '8'] },
  { kind: 'q.', units: 8, parts: ['q.', '8'] },
  { kind: '16', units: 4, parts: ['16', '16', '16', '16'] },
  { kind: 'rq', units: 4, parts: ['rq'] },
  { kind: 'rh', units: 8, parts: ['rh'] },
  { kind: 'r8', units: 4, parts: ['r8', '8'] },
  { kind: 'tie', units: 12, parts: ['h_', 'q'] },
];

function barUnits(time: string): number {
  const [beats, unit] = time.split('/').map(Number);
  return (beats! * 16) / unit!;
}

/** One bar of rhythm, as duration codes. The last bar ends on the longest value that fits. */
function rhythmBar(
  random: () => number,
  spec: ExerciseSpec,
  first: boolean,
  last: boolean,
): string[] {
  const total = barUnits(spec.time);
  const allowed = CELLS.filter((c) => spec.rhythms.includes(c.kind) && c.units <= total);
  const notes = allowed.filter((c) => !c.kind.startsWith('r'));
  const long = [...notes].filter((c) => c.parts.length === 1).sort((a, b) => b.units - a.units);
  const parts: string[] = [];
  let used = 0;
  let rests = 0;
  // Leave room at the end of the last bar for a long note.
  const ending = last ? (long.find((c) => c.units <= total) ?? long.at(-1)) : undefined;
  const fill = total - (ending?.units ?? 0);
  while (used < fill) {
    const room = fill - used;
    const options = allowed.filter(
      (c) =>
        c.units <= room &&
        // Values longer than a beat start on a beat; half notes on the half bar where there is one.
        (c.units < 8 || used % 4 === 0) &&
        (c.kind !== 'w' || used === 0) &&
        // No rest to open the piece, at most one a bar, and none straight before the ending.
        !(
          c.kind.startsWith('r') &&
          ((first && used === 0) || rests > 0 || (last && used + c.units >= fill))
        ),
    );
    if (options.length === 0) {
      // Nothing fits the gap: fall back to quarters, then eighth pairs.
      parts.push(room >= 4 ? 'q' : '8');
      used += room >= 4 ? 4 : 2;
      continue;
    }
    const cell = pick(random, options, (c) => {
      const favoured = spec.focusRhythms?.includes(c.kind) ? 4 : 1;
      const size = c.kind === 'q' ? 3 : c.kind.startsWith('r') ? 0.6 : c.units >= 12 ? 0.5 : 1.5;
      return favoured * size;
    });
    if (cell.kind.startsWith('r')) rests++;
    parts.push(...cell.parts);
    used += cell.units;
  }
  if (ending) parts.push(...ending.parts);
  return parts;
}

function chordTones(pool: Pitch[], key: string): number[] {
  const minor = key.endsWith('m');
  const tonic = parsePitch(`${key.replace(/m$/, '')}4`).writtenMidi % 12;
  const tones = [0, minor ? 3 : 4, 7].map((x) => (tonic + x) % 12);
  const found = pool
    .map((p, i) => (tones.includes(p.writtenMidi % 12) ? i : -1))
    .filter((i) => i >= 0);
  return found.length ? found : [Math.floor(pool.length / 2)];
}

/** Build the exercise as a content file. Throws if the spec cannot make one. */
export function generateExercise(spec: ExerciseSpec): PieceFile {
  keyFifths(spec.key); // throws on an unknown key
  const random = seededRandom(spec.seed);
  const pool = [...new Set(spec.pool)]
    .map((text) => parsePitch(text))
    .sort((a, b) => a.writtenMidi - b.writtenMidi);
  if (pool.length === 0) throw new Error('The exercise has no pitches to use');
  const name = (p: Pitch) =>
    `${p.letter}${p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''}${p.octave}`;
  const indexOf = (text: string) => pool.findIndex((p) => name(p) === text);
  const focus = spec.focus.map(indexOf).filter((i) => i >= 0);
  const tones = chordTones(pool, spec.key);

  // --- Rhythm: duration codes for every bar ---
  const bars = Array.from({ length: spec.bars }, (_, b) =>
    rhythmBar(random, spec, b === 0, b === spec.bars - 1),
  );

  // --- Pitches: a walk through the pool, mostly by step, leaning on the focus notes ---
  const slots = bars.flat().filter((d) => !d.startsWith('r')).length;
  const line: number[] = [];
  const middle = (pool.length - 1) / 2;
  let at = [...tones].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0]!;
  let stepBack = 0;
  const pair = spec.pair?.map(indexOf).filter((i) => i >= 0) ?? [];
  for (let i = 0; i < slots; i++) {
    if (pair.length === 2 && i < Math.min(8, slots - 1)) {
      // A confusion drill opens by setting the two notes side by side.
      at = pair[i % 2]!;
    } else if (i > 0) {
      const moves = stepBack !== 0 ? [stepBack] : [-4, -3, -2, -1, 0, 1, 2, 3, 4];
      const options = moves.filter((m) => at + m >= 0 && at + m < pool.length);
      const move = pick(random, options.length ? options : [0], (m) => {
        const size = Math.abs(m);
        const base =
          size === 0
            ? 0.8
            : size === 1
              ? 6
              : size === 2
                ? spec.interval >= 1
                  ? 3
                  : 0.4
                : spec.interval >= 2
                  ? 1.2
                  : 0;
        return base * (focus.includes(at + m) ? 3 : 1) + 0.0001;
      });
      // A leap is followed by a step back the other way (spec section 7).
      stepBack = Math.abs(move) >= 3 ? -Math.sign(move) : 0;
      if (stepBack !== 0 && (at + move + stepBack < 0 || at + move + stepBack >= pool.length))
        stepBack = 0;
      at += move;
    }
    line.push(at);
  }
  // End on a chord tone of the key, the nearest one to where the line was heading.
  if (slots > 1) {
    const before = line[slots - 2]!;
    line[slots - 1] = [...tones].sort((a, b) => Math.abs(a - before) - Math.abs(b - before))[0]!;
  }
  // Every focus note must appear: put any that is missing in place of a note that is not one.
  for (const wanted of focus) {
    if (line.includes(wanted)) continue;
    const free = line
      .map((_, i) => i)
      .filter((i) => i > 0 && i < slots - 1 && !focus.includes(line[i]!));
    if (free.length === 0) break;
    line[free[Math.floor(random() * free.length)]!] = wanted;
  }

  // --- Tokens ---
  let slot = 0;
  let tiedFrom: number | null = null;
  const text = bars.map((bar) =>
    bar
      .map((code) => {
        if (code.startsWith('r')) return `r/${code.slice(1)}`;
        const tie = code.endsWith('_');
        // A tied note repeats the pitch it is tied from.
        const index: number = tiedFrom ?? line[slot]!;
        if (tiedFrom !== null) line[slot] = index;
        slot++;
        tiedFrom = tie ? index : null;
        return `${name(pool[index]!)}/${tie ? code.slice(0, -1) : code}${tie ? '_' : ''}`;
      })
      .join(' '),
  );

  return {
    id: `gen-${spec.seed}`,
    title: spec.title ?? 'Exercise',
    composer: 'Malcotron',
    source: `Generated exercise, seed ${spec.seed}`,
    key: spec.key,
    time: spec.time,
    position: 0,
    suggestedTempo: spec.tempo,
    // Generated material is checked against the widest stages M3 covers; what it needs is computed.
    requires: { pitchStage: 'P5', rhythmStage: 'R5' },
    bars: text,
  };
}

/** Generate and parse an exercise. It goes through the same validator as hand-written content. */
export function generatePiece(spec: ExerciseSpec): Piece {
  return buildPiece(generateExercise(spec), `gen-${spec.seed}.json`);
}

/** The pitches of a pool that belong to a key (plus any named as exceptions). */
export function poolForKey(
  pool: readonly string[],
  key: string,
  alsoAllow: readonly string[] = [],
): string[] {
  return pool.filter((text) => alsoAllow.includes(text) || isInKey(parsePitch(text), key));
}
