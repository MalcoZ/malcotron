/**
 * Stage check: work out the lowest pitch and rhythm stages a piece needs
 * (M0 brief, task 5). M0 covers P1 to P5 (open position) and R1 to R5.
 */
import {
  isInKey,
  parsePitch,
  pitchToString,
  type Meter,
  type NoteToken,
  type Pitch,
} from './music';

export const NOT_SUPPORTED_YET = 'stage not supported yet';

export type StageResult =
  { ok: true; stage: number } | { ok: false; reason: string; bar?: number; token?: string };

export function stageNumber(stage: string, track: 'P' | 'R'): number | null {
  const m = new RegExp(`^${track}(\\d+)$`).exec(stage);
  return m ? Number(m[1]) : null;
}

/** Lowest rhythm stage (as a number, 1 = R1) that covers every duration and the meter. */
export function computeRhythmStage(
  bars: readonly (readonly NoteToken[])[],
  meter: Meter,
): StageResult {
  const time = `${meter.beats}/${meter.beatUnit}`;
  let stage: number;
  if (time === '4/4') stage = 1;
  else if (time === '2/4' || time === '3/4') stage = 2;
  else
    return {
      ok: false,
      reason: `${NOT_SUPPORTED_YET}: meter ${time} (M0 covers 2/4, 3/4 and 4/4)`,
    };

  for (const [b, bar] of bars.entries()) {
    for (const token of bar) {
      const { base, dotted, triplet } = token.duration;
      const fail = (what: string): StageResult => ({
        ok: false,
        reason: `${NOT_SUPPORTED_YET}: ${what} (M0 covers R1 to R5)`,
        bar: b + 1,
        token: token.text,
      });
      if (triplet) return fail('triplets');
      let need: number;
      if (base === 'w' || base === 'h' || base === 'q') {
        if (!dotted) need = 1;
        else if (base === 'h') need = 2;
        else if (base === 'q') need = 4;
        else return fail('dotted whole notes');
      } else if (base === '8') {
        if (dotted) return fail('dotted eighth notes');
        need = 3;
      } else {
        if (dotted) return fail('dotted sixteenth notes');
        need = 5;
      }
      if (token.tieToNext) need = Math.max(need, 4);
      stage = Math.max(stage, need);
    }
  }
  return { ok: true, stage };
}

const G4 = parsePitch('G4').writtenMidi;
const G5 = parsePitch('G5').writtenMidi;
const E3 = parsePitch('E3').writtenMidi;
const F4 = parsePitch('F4').writtenMidi;

/** Lowest pitch stage (as a number, 1 = P1) that covers the key, range and accidentals. */
export function computePitchStage(
  bars: readonly (readonly NoteToken[])[],
  key: string,
  position: number,
): StageResult {
  if (position !== 0) {
    return {
      ok: false,
      reason: `${NOT_SUPPORTED_YET}: position ${position} (M0 covers open position only)`,
    };
  }
  const pitches: { pitch: Pitch; bar: number; token: string }[] = [];
  for (const [b, bar] of bars.entries()) {
    for (const token of bar) {
      if (token.pitch) pitches.push({ pitch: token.pitch, bar: b + 1, token: token.text });
    }
  }
  const outsideKey = pitches.find((p) => !isInKey(p.pitch, key));

  if (key === 'C' && !outsideKey) {
    const midis = pitches.map((p) => p.pitch.writtenMidi);
    const within = (lo: number, hi: number) => midis.every((m) => m >= lo && m <= hi);
    if (within(G4, G5)) return { ok: true, stage: 1 };
    if (within(E3, F4)) return { ok: true, stage: 2 };
    if (within(E3, G5)) return { ok: true, stage: 3 };
    const stray = pitches.find((p) => p.pitch.writtenMidi < E3 || p.pitch.writtenMidi > G5)!;
    return {
      ok: false,
      reason: `${NOT_SUPPORTED_YET}: ${pitchToString(stray.pitch)} is outside the open-position range E3 to G5`,
      bar: stray.bar,
      token: stray.token,
    };
  }
  if (['G', 'F', 'Em', 'Dm'].includes(key) && !outsideKey) return { ok: true, stage: 4 };
  if (['C', 'G', 'F', 'Em', 'Dm', 'D', 'Am'].includes(key)) return { ok: true, stage: 5 };
  return {
    ok: false,
    reason: `${NOT_SUPPORTED_YET}: key ${key} (M0 covers C, G, F, D, Am, Em and Dm)`,
  };
}
