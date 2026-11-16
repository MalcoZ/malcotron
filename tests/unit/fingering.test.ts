import { describe, expect, it } from 'vitest';
import {
  allLocations,
  fingeringFor,
  FingeringError,
  positionLabel,
  tryFingeringFor,
} from '../../src/content/fingering';
import { parsePitch } from '../../src/content/music';

type Row = [
  pitch: string,
  position: number,
  string: number,
  fret: number,
  finger: number,
  why?: string,
];

const TABLE: Row[] = [
  // Open position: frets 0 to 4, finger = fret.
  ['E3', 0, 6, 0, 0, 'lowest note, open 6th string'],
  ['F3', 0, 6, 1, 1],
  ['G3', 0, 6, 3, 3],
  ['G#3', 0, 6, 4, 4],
  ['A3', 0, 5, 0, 0, 'open string, not 6th string fret 5'],
  ['B3', 0, 5, 2, 2],
  ['C4', 0, 5, 3, 3],
  ['D4', 0, 4, 0, 0],
  ['F#4', 0, 4, 4, 4, 'acceptance spot check: the waltz F#4'],
  ['G4', 0, 3, 0, 0],
  ['A4', 0, 3, 2, 2],
  ['Bb4', 0, 3, 3, 3],
  ['B4', 0, 2, 0, 0, 'open 2nd string beats 3rd string fret 4'],
  ['C5', 0, 2, 1, 1],
  ['D5', 0, 2, 3, 3],
  ['E5', 0, 1, 0, 0],
  ['F5', 0, 1, 1, 1],
  ['G5', 0, 1, 3, 3, 'acceptance spot check: Ode to Joy G5'],
  ['G#5', 0, 1, 4, 4, 'top of open position'],
  // 2nd position: home frets 2 to 5.
  ['F#3', 2, 6, 2, 1],
  ['A3', 2, 6, 5, 4, 'no open strings above open position'],
  ['D4', 2, 5, 5, 4],
  ['E4', 2, 4, 2, 1],
  ['A4', 2, 3, 2, 1],
  ['B4', 2, 3, 4, 3, 'fretted, because open strings are out'],
  ['C#5', 2, 2, 2, 1],
  ['A5', 2, 1, 5, 4],
  ['F3', 2, 6, 1, 1, 'stretch down to fret 1, finger 1'],
  ['A#5', 2, 1, 6, 4, 'stretch up to fret 6, finger 4'],
  // 5th position: home frets 5 to 8.
  ['A3', 5, 6, 5, 1],
  ['C4', 5, 6, 8, 4],
  ['D4', 5, 5, 5, 1],
  ['G4', 5, 4, 5, 1],
  ['C5', 5, 3, 5, 1],
  ['E5', 5, 2, 5, 1],
  ['A5', 5, 1, 5, 1],
  ['C6', 5, 1, 8, 4],
  ['G#3', 5, 6, 4, 1, 'stretch down on the 6th string'],
  ['C#6', 5, 1, 9, 4, 'stretch up on the 1st string'],
  ['C#4', 5, 6, 9, 4, 'two stretches: the higher string number wins'],
  ['B4', 5, 4, 9, 4, 'two stretches again: string 4 fret 9 beats string 3 fret 4'],
  ['D#5', 5, 3, 8, 4, 'home (string 3 fret 8) beats stretch (string 2 fret 4)'],
  // 7th position: home frets 7 to 10.
  ['B3', 7, 6, 7, 1],
  ['E4', 7, 5, 7, 1],
  ['D5', 7, 3, 7, 1],
  ['G5', 7, 2, 8, 2],
  ['B5', 7, 1, 7, 1],
  ['D6', 7, 1, 10, 4],
  ['D#6', 7, 1, 11, 4, 'stretch up'],
  // 9th position: home frets 9 to 12.
  ['C#4', 9, 6, 9, 1],
  ['E4', 9, 6, 12, 4],
  ['F#4', 9, 5, 9, 1],
  ['E5', 9, 3, 9, 1],
  ['C#6', 9, 1, 9, 1],
  ['E6', 9, 1, 12, 4],
  ['F6', 9, 1, 13, 4, 'stretch up'],
  ['C4', 9, 6, 8, 1, 'stretch down'],
];

describe('fingering function', () => {
  it('has at least 30 table cases across positions 0, 2, 5, 7 and 9', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(30);
    expect(new Set(TABLE.map((r) => r[1]))).toEqual(new Set([0, 2, 5, 7, 9]));
  });

  it.each(TABLE)(
    '%s in position %i is string %i fret %i finger %i',
    (pitch, pos, string, fret, finger) => {
      expect(fingeringFor(pitch, pos, 'C')).toEqual({ string, fret, finger });
    },
  );

  it('always returns a location that produces the pitch', () => {
    for (const [pitch, pos] of TABLE) {
      const f = fingeringFor(pitch, pos);
      const match = allLocations(parsePitch(pitch).writtenMidi).some(
        (l) => l.string === f.string && l.fret === f.fret,
      );
      expect(match, `${pitch} in position ${pos}`).toBe(true);
    }
  });

  describe('unreachable notes', () => {
    it.each([
      ['A5', 0, /A5 cannot be reached in open position/],
      ['D#3', 0, /cannot be reached/],
      ['E3', 2, /E3 cannot be reached in position 2/],
      ['E3', 5, /cannot be reached/],
      ['G3', 5, /cannot be reached/],
      ['D6', 5, /cannot be reached/],
      ['A3', 7, /cannot be reached/],
      ['B3', 9, /cannot be reached/],
      ['G6', 9, /cannot be reached/],
    ] as const)('%s in position %i', (pitch, pos, pattern) => {
      expect(() => fingeringFor(pitch, pos)).toThrow(FingeringError);
      expect(() => fingeringFor(pitch, pos)).toThrow(pattern);
      expect(tryFingeringFor(pitch, pos)).toBeNull();
    });
  });

  describe('overrides', () => {
    it('string-fret override wins over the position rules', () => {
      expect(fingeringFor('B4', 0, 'C', { stringFret: { string: 3, fret: 4 } })).toEqual({
        string: 3,
        fret: 4,
        finger: 4,
      });
    });
    it('allows an open string in a higher position when the content says so', () => {
      expect(fingeringFor('E5', 5, 'C', { stringFret: { string: 1, fret: 0 } })).toEqual({
        string: 1,
        fret: 0,
        finger: 0,
      });
    });
    it('reaches a note outside the position through an override', () => {
      expect(fingeringFor('A5', 0, 'C', { stringFret: { string: 1, fret: 5 } })).toEqual({
        string: 1,
        fret: 5,
        finger: 4,
      });
    });
    it('finger override wins over the computed finger', () => {
      expect(fingeringFor('F#4', 0, 'G', { finger: 3 })).toEqual({ string: 4, fret: 4, finger: 3 });
      expect(
        fingeringFor('F#4', 0, 'G', { stringFret: { string: 4, fret: 4 }, finger: 3 }),
      ).toEqual({ string: 4, fret: 4, finger: 3 });
    });
    it.each([
      [{ stringFret: { string: 3, fret: 5 } }, /string 3 fret 5 does not produce B4/],
      [{ stringFret: { string: 7, fret: 0 } }, /string 7 does not exist/],
      [{ stringFret: { string: 6, fret: 20 } }, /fret 20 is out of range/],
      [{ finger: 0 }, /finger 0 does not fit fret 4/],
      [{ stringFret: { string: 2, fret: 0 }, finger: 2 }, /finger 2 does not fit fret 0/],
      [{ finger: 5 }, /finger 5 is not valid/],
    ])('rejects an impossible override %j', (override, pattern) => {
      const base = { stringFret: { string: 3, fret: 4 } };
      expect(() => fingeringFor('B4', 0, 'C', { ...base, ...override })).toThrow(pattern);
    });
  });

  it('rejects a bad position', () => {
    expect(() => fingeringFor('E5', -1)).toThrow(/position -1 is not valid/);
    expect(() => fingeringFor('E5', 2.5)).toThrow(/not valid/);
  });

  it('labels positions', () => {
    expect(positionLabel(0)).toBe('Open');
    expect(positionLabel(2)).toBe('Pos. II');
    expect(positionLabel(5)).toBe('Pos. V');
    expect(positionLabel(7)).toBe('Pos. VII');
    expect(positionLabel(9)).toBe('Pos. IX');
    expect(positionLabel(12)).toBe('Pos. XII');
  });
});
