/**
 * Music core: fractions, pitches, keys, durations and the note-token parser.
 *
 * Everything here is pure and has no browser dependencies, so the validator
 * (tools/), the renderer, the playback timeline and later the listening
 * pipeline can all share it.
 */

// ---------------------------------------------------------------------------
// Exact fractions (durations are fractions of a whole note, never floats)
// ---------------------------------------------------------------------------

export interface Fraction {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export function frac(n: number, d = 1): Fraction {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) {
    throw new Error(`Invalid fraction ${n}/${d}`);
  }
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

export const ZERO: Fraction = frac(0);

export function fracAdd(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function fracSub(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function fracMul(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.n, a.d * b.d);
}

export function fracEq(a: Fraction, b: Fraction): boolean {
  return a.n === b.n && a.d === b.d;
}

export function fracCompare(a: Fraction, b: Fraction): number {
  return a.n * b.d - b.n * a.d;
}

export function fracToNumber(a: Fraction): number {
  return a.n / a.d;
}

export function fracToString(a: Fraction): string {
  return a.d === 1 ? `${a.n}` : `${a.n}/${a.d}`;
}

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
/** Semitone alteration of a letter: -1 flat, 0 natural, +1 sharp. */
export type Alter = -1 | 0 | 1;

export interface Pitch {
  readonly letter: Letter;
  readonly alter: Alter;
  /** Octave as written on the staff (scientific pitch notation, C4 = middle C). */
  readonly octave: number;
  /** MIDI number of the written pitch (C4 = 60). */
  readonly writtenMidi: number;
  /** MIDI number of the sounding pitch (guitar sounds an octave below written). */
  readonly soundingMidi: number;
}

/** Guitar notation uses the treble clef with an 8 below: sounding = written - 12. */
export const WRITTEN_TO_SOUNDING_SEMITONES = -12;

const LETTER_SEMITONES: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PITCH_RE = /^([A-G])(#|b)?(-?\d+)$/;

export function parsePitch(text: string): Pitch {
  const m = PITCH_RE.exec(text);
  if (!m) {
    throw new Error(
      `"${text}" is not a pitch (expected a letter A-G, optional # or b, and an octave, like F#4)`,
    );
  }
  const letter = m[1] as Letter;
  const alter: Alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  const writtenMidi = (octave + 1) * 12 + LETTER_SEMITONES[letter] + alter;
  return {
    letter,
    alter,
    octave,
    writtenMidi,
    soundingMidi: writtenMidi + WRITTEN_TO_SOUNDING_SEMITONES,
  };
}

export function pitchToString(p: Pick<Pitch, 'letter' | 'alter' | 'octave'>): string {
  return `${p.letter}${p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''}${p.octave}`;
}

/** Written pitch string to written MIDI number (C4 = 60). */
export function writtenMidi(text: string): number {
  return parsePitch(text).writtenMidi;
}

/** Written pitch string to sounding MIDI number (an octave lower). */
export function soundingMidi(text: string): number {
  return parsePitch(text).soundingMidi;
}

export function midiToFrequency(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export type KeySignature = Readonly<Record<Letter, Alter>>;

const SHARP_ORDER: Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Number of sharps (positive) or flats (negative) for each supported key. */
const KEY_FIFTHS: Record<string, number> = {
  C: 0,
  Am: 0,
  G: 1,
  Em: 1,
  D: 2,
  Bm: 2,
  A: 3,
  'F#m': 3,
  E: 4,
  'C#m': 4,
  F: -1,
  Dm: -1,
  Bb: -2,
  Gm: -2,
  Eb: -3,
  Cm: -3,
};

export const SUPPORTED_KEYS: readonly string[] = Object.keys(KEY_FIFTHS);

export function isSupportedKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEY_FIFTHS, key);
}

/** Sharps (positive) or flats (negative) in the key signature. */
export function keyFifths(key: string): number {
  const fifths = KEY_FIFTHS[key];
  if (fifths === undefined) {
    throw new Error(`Unknown key "${key}" (supported: ${SUPPORTED_KEYS.join(', ')})`);
  }
  return fifths;
}

/** The alteration the key signature gives each letter. */
export function keySignature(key: string): KeySignature {
  const fifths = keyFifths(key);
  const sig: Record<Letter, Alter> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (let i = 0; i < Math.abs(fifths); i++) {
    if (fifths > 0) sig[SHARP_ORDER[i]!] = 1;
    else sig[FLAT_ORDER[i]!] = -1;
  }
  return sig;
}

/** True when the key signature already gives this pitch its alteration. */
export function isInKey(pitch: Pick<Pitch, 'letter' | 'alter'>, key: string): boolean {
  return keySignature(key)[pitch.letter] === pitch.alter;
}

export type AccidentalSymbol = '#' | 'b' | 'n';

/**
 * Decide which notes in one bar need a drawn accidental.
 *
 * An accidental is drawn only when the note's alteration differs from what is
 * currently in force for that staff position: the key signature, or an earlier
 * accidental on the same letter and octave in the same bar. Rests are passed
 * as null. A note tied from the previous note never repeats its accidental.
 */
export function accidentalsForBar(
  notes: ReadonlyArray<{ pitch: Pitch | null; tiedFromPrevious?: boolean }>,
  key: string,
): (AccidentalSymbol | null)[] {
  const sig = keySignature(key);
  const inForce = new Map<string, Alter>();
  return notes.map(({ pitch, tiedFromPrevious }) => {
    if (!pitch) return null;
    const slot = `${pitch.letter}${pitch.octave}`;
    const current = inForce.get(slot) ?? sig[pitch.letter];
    if (tiedFromPrevious) {
      inForce.set(slot, pitch.alter);
      return null;
    }
    if (current === pitch.alter) return null;
    inForce.set(slot, pitch.alter);
    return pitch.alter === 1 ? '#' : pitch.alter === -1 ? 'b' : 'n';
  });
}

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

export interface Meter {
  readonly beats: number;
  readonly beatUnit: number;
  /** Length of one bar as a fraction of a whole note. */
  readonly barLength: Fraction;
}

export function parseMeter(text: string): Meter {
  const m = /^(\d+)\/(\d+)$/.exec(text);
  const beats = m ? Number(m[1]) : 0;
  const beatUnit = m ? Number(m[2]) : 0;
  if (!m || beats < 1 || ![1, 2, 4, 8, 16].includes(beatUnit)) {
    throw new Error(`"${text}" is not a time signature (expected something like 4/4 or 6/8)`);
  }
  return { beats, beatUnit, barLength: frac(beats, beatUnit) };
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

export type DurationBase = 'w' | 'h' | 'q' | '8' | '16';

export interface Duration {
  readonly base: DurationBase;
  readonly dotted: boolean;
  readonly triplet: boolean;
  /** Length as an exact fraction of a whole note. */
  readonly length: Fraction;
}

const BASE_LENGTH: Record<DurationBase, Fraction> = {
  w: frac(1),
  h: frac(1, 2),
  q: frac(1, 4),
  '8': frac(1, 8),
  '16': frac(1, 16),
};

export function makeDuration(base: DurationBase, dotted = false, triplet = false): Duration {
  let length = BASE_LENGTH[base];
  if (dotted) length = fracMul(length, frac(3, 2));
  if (triplet) length = fracMul(length, frac(2, 3));
  return { base, dotted, triplet, length };
}

/** One quarter note is one beat everywhere in the app (tempo is quarter-note BPM). */
export function wholeNotesToBeats(length: Fraction): Fraction {
  return fracMul(length, frac(4));
}

// ---------------------------------------------------------------------------
// Note tokens
// ---------------------------------------------------------------------------

export interface StringFret {
  /** Guitar string, 1 (high E) to 6 (low E). */
  readonly string: number;
  readonly fret: number;
}

export interface NoteToken {
  /** The token exactly as written in the content file. */
  readonly text: string;
  /** null for a rest. */
  readonly pitch: Pitch | null;
  readonly duration: Duration;
  /** True when this note is tied into the next note. */
  readonly tieToNext: boolean;
  /** `@string-fret` override, if given. */
  readonly stringFretOverride: StringFret | null;
  /** `~finger` override (0 = open string, 1 to 4), if given. */
  readonly fingerOverride: number | null;
}

/** Where a problem in a content file is, for error messages. */
export interface ContentLocation {
  file?: string;
  /** 1-based bar number. */
  bar?: number;
  token?: string;
}

export function formatLocation(loc: ContentLocation): string {
  const parts: string[] = [];
  if (loc.file) parts.push(loc.file);
  if (loc.bar !== undefined) parts.push(`bar ${loc.bar}`);
  if (loc.token !== undefined) parts.push(`token "${loc.token}"`);
  return parts.join(', ');
}

export class ContentError extends Error {
  readonly location: ContentLocation;
  readonly detail: string;

  constructor(detail: string, location: ContentLocation = {}) {
    const where = formatLocation(location);
    super(where ? `${where}: ${detail}` : detail);
    this.name = 'ContentError';
    this.detail = detail;
    this.location = location;
  }
}

/**
 * Token grammar: `pitch/duration[_][@string-fret][~finger]`
 *   pitch     A-G, optional # or b, octave (written pitch); or `r` for a rest
 *   duration  w h q 8 16, optional `.` (dotted), optional `t` (triplet)
 *   _         tie into the next note
 *   @s-f      string (1-6) and fret override
 *   ~n        finger override (0-4)
 * Examples: `E5/q`, `r/q`, `G4/h_`, `F#4/8@4-4~3`
 */
const TOKEN_RE = /^([^/@~_]+)\/(w|h|q|8|16)(\.)?(t)?(_)?(?:@(\d+)-(\d+))?(?:~(\d+))?$/;

export function parseToken(text: string, location: ContentLocation = {}): NoteToken {
  const loc = { ...location, token: text };
  const m = TOKEN_RE.exec(text);
  if (!m) {
    throw new ContentError(
      'cannot be read as a note; expected pitch/duration[_][@string-fret][~finger], ' +
        'for example E5/q, r/h, G4/h_ or F#4/8@4-4~3 (durations: w h q 8 16, "." dotted, "t" triplet)',
      loc,
    );
  }
  const [, pitchText, base, dot, triplet, tie, strText, fretText, fingerText] = m;

  let pitch: Pitch | null = null;
  if (pitchText !== 'r') {
    try {
      pitch = parsePitch(pitchText!);
    } catch (err) {
      throw new ContentError((err as Error).message, loc);
    }
  }

  const isRest = pitch === null;
  if (isRest && tie) throw new ContentError('a rest cannot be tied', loc);
  if (isRest && (strText !== undefined || fingerText !== undefined)) {
    throw new ContentError('a rest cannot have a string, fret or finger', loc);
  }

  let stringFretOverride: StringFret | null = null;
  if (strText !== undefined && fretText !== undefined) {
    stringFretOverride = { string: Number(strText), fret: Number(fretText) };
  }
  const fingerOverride = fingerText !== undefined ? Number(fingerText) : null;
  if (fingerOverride !== null && fingerOverride > 4) {
    throw new ContentError(
      `finger ${fingerOverride} is not valid (use 0 for open, or 1 to 4)`,
      loc,
    );
  }

  return {
    text,
    pitch,
    duration: makeDuration(base as DurationBase, dot !== undefined, triplet !== undefined),
    tieToNext: tie !== undefined,
    stringFretOverride,
    fingerOverride,
  };
}

/** Parse one bar string ("E5/q E5/q F5/q G5/q") into tokens. */
export function parseBar(text: string, location: ContentLocation = {}): NoteToken[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new ContentError('bar is empty', location);
  return tokens.map((t) => parseToken(t, location));
}

/** Total written length of a bar (ties do not change it). */
export function barLength(tokens: readonly NoteToken[]): Fraction {
  return tokens.reduce((sum, t) => fracAdd(sum, t.duration.length), ZERO);
}
