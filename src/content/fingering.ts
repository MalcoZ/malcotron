/**
 * Fingering function: written pitch + position -> string, fret and finger.
 *
 * Rules (M0 brief, task 4):
 *  - Open position (0): frets 0 to 4, finger = fret; an open string wins over
 *    the same pitch fretted on the next lower string.
 *  - Position N >= 1: home frets N to N+3 (finger = fret - N + 1), with
 *    stretches to N-1 (finger 1) and N+4 (finger 4). Home beats stretch; ties
 *    go to the higher string number (the lower-pitched string). No open
 *    strings unless the content overrides.
 *  - Content overrides (`@string-fret`, `~finger`) always win.
 */
import { FINGERING } from '../config';
import { parsePitch, pitchToString, type Pitch, type StringFret } from './music';

export interface Fingering {
  /** Guitar string, 1 (high E) to 6 (low E). */
  readonly string: number;
  readonly fret: number;
  /** 0 = open string, 1 to 4 = fretting-hand finger. */
  readonly finger: number;
}

export interface FingeringOverride {
  readonly stringFret?: StringFret | null;
  readonly finger?: number | null;
}

/** Written MIDI number of each open string in standard tuning, by string number. */
export const OPEN_STRING_WRITTEN_MIDI: Readonly<Record<number, number>> = {
  6: parsePitch('E3').writtenMidi,
  5: parsePitch('A3').writtenMidi,
  4: parsePitch('D4').writtenMidi,
  3: parsePitch('G4').writtenMidi,
  2: parsePitch('B4').writtenMidi,
  1: parsePitch('E5').writtenMidi,
};

const STRINGS = [1, 2, 3, 4, 5, 6] as const;

export class FingeringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FingeringError';
  }
}

export function positionName(position: number): string {
  if (position === 0) return 'open position';
  return `position ${position}`;
}

/** Finger used for a fret within a position, clamped to the hand (1 to 4). */
function fingerForFret(fret: number, position: number): number {
  if (fret === 0) return 0;
  if (position === 0) return Math.min(4, fret);
  return Math.max(1, Math.min(4, fret - position + 1));
}

/** Every string/fret that produces the written MIDI pitch on a 19-fret neck. */
export function allLocations(midi: number): StringFret[] {
  const out: StringFret[] = [];
  for (const string of STRINGS) {
    const fret = midi - OPEN_STRING_WRITTEN_MIDI[string]!;
    if (fret >= 0 && fret <= FINGERING.maxFret) out.push({ string, fret });
  }
  return out;
}

function chooseInPosition(midi: number, position: number): StringFret | null {
  const locations = allLocations(midi);
  if (position === 0) {
    // Lowest fret first, so an open string beats the 4th fret of the string below.
    const inRange = locations.filter((l) => l.fret <= FINGERING.openPositionMaxFret);
    inRange.sort((a, b) => a.fret - b.fret);
    return inRange[0] ?? null;
  }
  const fretted = locations.filter((l) => l.fret >= 1);
  const byHigherString = (a: StringFret, b: StringFret) => b.string - a.string;
  const home = fretted
    .filter((l) => l.fret >= position && l.fret <= position + FINGERING.homeSpan - 1)
    .sort(byHigherString);
  if (home[0]) return home[0];
  const stretch = fretted
    .filter((l) => l.fret === position - 1 || l.fret === position + FINGERING.homeSpan)
    .sort(byHigherString);
  return stretch[0] ?? null;
}

/**
 * Check a `@string-fret` override is physically possible and makes the pitch.
 * Returns an error message, or null when the override is fine.
 */
export function checkStringFretOverride(pitch: Pitch, override: StringFret): string | null {
  const open = OPEN_STRING_WRITTEN_MIDI[override.string];
  if (open === undefined) return `string ${override.string} does not exist (strings are 1 to 6)`;
  if (override.fret < 0 || override.fret > FINGERING.maxFret) {
    return `fret ${override.fret} is out of range (0 to ${FINGERING.maxFret})`;
  }
  if (open + override.fret !== pitch.writtenMidi) {
    return `string ${override.string} fret ${override.fret} does not produce ${pitchToString(pitch)}`;
  }
  return null;
}

/**
 * Where to play a written pitch in a position.
 *
 * `_key` is accepted so callers do not have to change when key-aware fingering
 * arrives; the M0 rules depend only on pitch and position.
 *
 * Throws FingeringError when the pitch cannot be reached in the position (and
 * no override says where to play it), or when an override is impossible.
 */
export function fingeringFor(
  pitch: Pitch | string,
  position: number,
  _key?: string,
  override: FingeringOverride = {},
): Fingering {
  const p = typeof pitch === 'string' ? parsePitch(pitch) : pitch;
  if (!Number.isInteger(position) || position < 0 || position > FINGERING.maxPosition) {
    throw new FingeringError(`position ${position} is not valid (0 to ${FINGERING.maxPosition})`);
  }

  let location: StringFret | null;
  if (override.stringFret) {
    const problem = checkStringFretOverride(p, override.stringFret);
    if (problem) throw new FingeringError(problem);
    location = override.stringFret;
  } else {
    location = chooseInPosition(p.writtenMidi, position);
    if (!location) {
      throw new FingeringError(
        `${pitchToString(p)} cannot be reached in ${positionName(position)}`,
      );
    }
  }

  let finger = fingerForFret(location.fret, position);
  if (override.finger !== null && override.finger !== undefined) {
    if (!Number.isInteger(override.finger) || override.finger < 0 || override.finger > 4) {
      throw new FingeringError(`finger ${override.finger} is not valid (0 to 4)`);
    }
    if ((override.finger === 0) !== (location.fret === 0)) {
      throw new FingeringError(
        `finger ${override.finger} does not fit fret ${location.fret} (finger 0 means an open string)`,
      );
    }
    finger = override.finger;
  }

  return { string: location.string, fret: location.fret, finger };
}

/** Like fingeringFor, but returns null instead of throwing. */
export function tryFingeringFor(
  pitch: Pitch | string,
  position: number,
  key?: string,
  override: FingeringOverride = {},
): Fingering | null {
  try {
    return fingeringFor(pitch, position, key, override);
  } catch {
    return null;
  }
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function roman(n: number): string {
  if (n >= 1 && n <= 12) return ROMAN[n]!;
  const tens = Math.floor(n / 10);
  return 'X'.repeat(tens) + (ROMAN[n % 10] ?? '');
}

/** Label drawn above the staff: "Open" or "Pos. V". */
export function positionLabel(position: number): string {
  return position === 0 ? 'Open' : `Pos. ${roman(position)}`;
}
