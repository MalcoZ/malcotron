/**
 * Content validator and parser. `validatePiece` collects every problem in a
 * content file; `buildPiece` returns the parsed piece or throws on the first.
 * The CLI in tools/validate-content.ts and the app's loader both use this.
 */
import { TEMPO } from '../config';
import { FingeringError, fingeringFor, type Fingering } from './fingering';
import {
  accidentalsForBar,
  barLength,
  ContentError,
  formatLocation,
  fracEq,
  fracToString,
  isSupportedKey,
  parseToken,
  parseMeter,
  SUPPORTED_KEYS,
  type ContentLocation,
  type Meter,
  type NoteToken,
} from './music';
import { computePitchStage, computeRhythmStage, stageNumber } from './stages';
import type { Piece, PieceFile, PieceNote } from './types';

export interface Issue {
  readonly location: ContentLocation;
  readonly detail: string;
  /** Location and detail together, ready to print. */
  readonly message: string;
}

export interface ValidationResult {
  readonly errors: Issue[];
  readonly warnings: Issue[];
  /** The parsed piece; present only when there are no errors. */
  readonly piece?: Piece;
  /** Lowest stages the piece needs, when they could be computed. */
  readonly computed?: { pitchStage?: string; rhythmStage?: string };
}

function issue(detail: string, location: ContentLocation): Issue {
  const where = formatLocation(location);
  return { location, detail, message: where ? `${where}: ${detail}` : detail };
}

const STRING_FIELDS = ['id', 'title', 'composer', 'source', 'key', 'time'] as const;

/**
 * Validate one content file.
 * @param raw   the parsed JSON
 * @param file  path shown in messages, for example "pieces/ode-to-joy.json"
 */
export function validatePiece(raw: unknown, file: string): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (detail: string, loc: Omit<ContentLocation, 'file'> = {}) =>
    errors.push(issue(detail, { file, ...loc }));
  const warn = (detail: string, loc: Omit<ContentLocation, 'file'> = {}) =>
    warnings.push(issue(detail, { file, ...loc }));

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    err('file must contain one JSON object');
    return { errors, warnings };
  }
  const data = raw as Partial<PieceFile>;

  // --- Shape ---------------------------------------------------------------
  for (const field of STRING_FIELDS) {
    if (typeof data[field] !== 'string' || data[field].trim() === '') {
      err(`"${field}" is missing or is not text`);
    }
  }
  if (typeof data.id === 'string') {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.id)) {
      err(`"id" must be lowercase words joined by hyphens, got "${data.id}"`);
    }
    const base = file
      .split('/')
      .pop()
      ?.replace(/\.json$/, '');
    if (base && base !== data.id) err(`"id" is "${data.id}" but the file is named "${base}.json"`);
  }
  if (!Number.isInteger(data.position) || (data.position as number) < 0) {
    err('"position" must be a whole number (0 for open position)');
  }
  if (
    typeof data.suggestedTempo !== 'number' ||
    data.suggestedTempo < TEMPO.min ||
    data.suggestedTempo > TEMPO.max
  ) {
    err(`"suggestedTempo" must be a number from ${TEMPO.min} to ${TEMPO.max}`);
  }
  const requiredPitch =
    typeof data.requires?.pitchStage === 'string'
      ? stageNumber(data.requires.pitchStage, 'P')
      : null;
  const requiredRhythm =
    typeof data.requires?.rhythmStage === 'string'
      ? stageNumber(data.requires.rhythmStage, 'R')
      : null;
  if (requiredPitch === null) err('"requires.pitchStage" must be a stage like "P1"');
  if (requiredRhythm === null) err('"requires.rhythmStage" must be a stage like "R1"');
  if (
    !Array.isArray(data.bars) ||
    data.bars.length === 0 ||
    data.bars.some((b) => typeof b !== 'string')
  ) {
    err('"bars" must be a list of at least one bar, each written as text');
  }

  let meter: Meter | null = null;
  if (typeof data.time === 'string') {
    try {
      meter = parseMeter(data.time);
    } catch (e) {
      err((e as Error).message);
    }
  }
  const keyOk = typeof data.key === 'string' && isSupportedKey(data.key);
  if (typeof data.key === 'string' && !keyOk) {
    err(`key "${data.key}" is not supported (supported: ${SUPPORTED_KEYS.join(', ')})`);
  }
  if (errors.length > 0 || !meter || !keyOk) return { errors, warnings };
  const file_ = data as PieceFile;

  // --- Tokens --------------------------------------------------------------
  const bars: NoteToken[][] = [];
  let tokensOk = true;
  for (const [b, text] of file_.bars.entries()) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      err('bar is empty', { bar: b + 1 });
      tokensOk = false;
      bars.push([]);
      continue;
    }
    const parsed: NoteToken[] = [];
    for (const word of words) {
      try {
        parsed.push(parseToken(word, { file, bar: b + 1 }));
      } catch (e) {
        if (!(e instanceof ContentError)) throw e;
        errors.push(issue(e.detail, e.location));
        tokensOk = false;
      }
    }
    bars.push(parsed);
  }
  if (!tokensOk) return { errors, warnings };

  // --- Bar lengths (pickup bars arrive with R9; rejected for now) ------------
  for (const [b, bar] of bars.entries()) {
    const total = barLength(bar);
    if (!fracEq(total, meter.barLength)) {
      err(
        `bar adds up to ${fracToString(total)} of a whole note, but ${file_.time} needs ` +
          `${fracToString(meter.barLength)} (pickup and short bars are not supported yet)`,
        { bar: b + 1 },
      );
    }
  }

  // --- Ties ----------------------------------------------------------------
  const flat = bars.flatMap((bar, b) => bar.map((token) => ({ token, bar: b + 1 })));
  const tiedFromPrevious = new Array<boolean>(flat.length).fill(false);
  for (const [i, { token, bar }] of flat.entries()) {
    if (!token.tieToNext) continue;
    const next = flat[i + 1];
    if (!next) {
      err('tie has no note to tie into (it is the last note)', { bar, token: token.text });
    } else if (next.token.pitch?.writtenMidi !== token.pitch?.writtenMidi) {
      err(`tie must lead to the same pitch, but the next note is "${next.token.text}"`, {
        bar,
        token: token.text,
      });
    } else {
      tiedFromPrevious[i + 1] = true;
    }
  }

  // --- Fingering: every pitch reachable, every override valid ----------------
  const fingerings: (Fingering | null)[] = [];
  for (const { token, bar } of flat) {
    if (!token.pitch) {
      fingerings.push(null);
      continue;
    }
    try {
      fingerings.push(
        fingeringFor(token.pitch, file_.position, file_.key, {
          stringFret: token.stringFretOverride,
          finger: token.fingerOverride,
        }),
      );
    } catch (e) {
      if (!(e instanceof FingeringError)) throw e;
      fingerings.push(null);
      err(e.message, { bar, token: token.text });
    }
  }

  // --- Stage check ---------------------------------------------------------
  const computed: { pitchStage?: string; rhythmStage?: string } = {};
  const rhythm = computeRhythmStage(bars, meter);
  if (!rhythm.ok) {
    err(rhythm.reason, { bar: rhythm.bar, token: rhythm.token });
  } else {
    computed.rhythmStage = `R${rhythm.stage}`;
    if (requiredRhythm! < rhythm.stage) {
      err(
        `"requires.rhythmStage" is R${requiredRhythm} but the rhythms used need R${rhythm.stage}`,
      );
    } else if (requiredRhythm! > rhythm.stage) {
      warn(
        `"requires.rhythmStage" is R${requiredRhythm} but the rhythms used only need R${rhythm.stage}`,
      );
    }
  }
  const pitch = computePitchStage(bars, file_.key, file_.position);
  if (!pitch.ok) {
    err(pitch.reason, { bar: pitch.bar, token: pitch.token });
  } else {
    computed.pitchStage = `P${pitch.stage}`;
    if (requiredPitch! < pitch.stage) {
      err(`"requires.pitchStage" is P${requiredPitch} but the notes used need P${pitch.stage}`);
    } else if (requiredPitch! > pitch.stage) {
      warn(
        `"requires.pitchStage" is P${requiredPitch} but the notes used only need P${pitch.stage}`,
      );
    }
  }

  if (errors.length > 0) return { errors, warnings, computed };

  // --- Build the parsed piece ------------------------------------------------
  let flatIndex = 0;
  const pieceBars: PieceNote[][] = bars.map((bar, barIndex) => {
    const start = flatIndex;
    const accidentals = accidentalsForBar(
      bar.map((token, i) => ({
        pitch: token.pitch,
        tiedFromPrevious: tiedFromPrevious[start + i],
      })),
      file_.key,
    );
    return bar.map((token, noteIndex) => {
      const i = flatIndex++;
      return {
        barIndex,
        noteIndex,
        token,
        pitch: token.pitch,
        duration: token.duration,
        fingering: fingerings[i] ?? null,
        accidental: accidentals[noteIndex] ?? null,
        tieToNext: token.tieToNext,
        tiedFromPrevious: tiedFromPrevious[i] ?? false,
      };
    });
  });

  const piece: Piece = {
    id: file_.id,
    title: file_.title,
    composer: file_.composer,
    source: file_.source,
    key: file_.key,
    time: file_.time,
    meter,
    position: file_.position,
    suggestedTempo: file_.suggestedTempo,
    requires: { ...file_.requires },
    bars: pieceBars,
    file,
  };
  return { errors, warnings, piece, computed };
}

/** Parse a content file, throwing a ContentError that lists every problem found. */
export function buildPiece(raw: unknown, file: string): Piece {
  const result = validatePiece(raw, file);
  if (!result.piece) {
    const first = result.errors[0]!;
    const more = result.errors.length > 1 ? ` (and ${result.errors.length - 1} more)` : '';
    throw new ContentError(first.detail + more, first.location);
  }
  return result.piece;
}

/** Problems that only show up across files: the same id used twice. */
export function findDuplicateIds(files: ReadonlyArray<{ file: string; raw: unknown }>): Issue[] {
  const seen = new Map<string, string>();
  const issues: Issue[] = [];
  for (const { file, raw } of files) {
    const id = (raw as Partial<PieceFile> | null)?.id;
    if (typeof id !== 'string') continue;
    const earlier = seen.get(id);
    if (earlier) issues.push(issue(`id "${id}" is already used by ${earlier}`, { file }));
    else seen.set(id, file);
  }
  return issues;
}
