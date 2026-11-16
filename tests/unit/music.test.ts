import { describe, expect, it } from 'vitest';
import {
  accidentalsForBar,
  barLength,
  ContentError,
  frac,
  fracAdd,
  fracEq,
  fracMul,
  fracToString,
  isInKey,
  keySignature,
  makeDuration,
  midiToFrequency,
  parseBar,
  parseMeter,
  parsePitch,
  parseToken,
  pitchToString,
  soundingMidi,
  wholeNotesToBeats,
  writtenMidi,
} from '../../src/content/music';

describe('fractions', () => {
  it('normalises and adds exactly', () => {
    expect(frac(2, 4)).toEqual({ n: 1, d: 2 });
    expect(fracAdd(frac(1, 3), frac(1, 6))).toEqual({ n: 1, d: 2 });
    expect(fracMul(frac(3, 8), frac(2, 3))).toEqual({ n: 1, d: 4 });
    expect(fracToString(frac(5, 4))).toBe('5/4');
    expect(fracToString(frac(4, 4))).toBe('1');
  });
  it('three triplet eighths make exactly one quarter', () => {
    const t = makeDuration('8', false, true).length;
    expect(fracEq(fracAdd(fracAdd(t, t), t), frac(1, 4))).toBe(true);
  });
  it('rejects a zero denominator', () => {
    expect(() => frac(1, 0)).toThrow();
  });
});

describe('pitch parsing and MIDI', () => {
  it.each([
    ['C4', 60],
    ['F#4', 66],
    ['Bb3', 58],
    ['E5', 76],
    ['E3', 52],
    ['A4', 69],
    ['Cb4', 59],
    ['B#3', 60],
    ['G5', 79],
    ['A6', 93],
  ])('%s is written MIDI %i', (text, midi) => {
    expect(writtenMidi(text)).toBe(midi);
  });

  it('sounds an octave below written (guitar treble clef 8vb)', () => {
    expect(soundingMidi('E3')).toBe(40); // low E string sounds E2
    expect(soundingMidi('E5')).toBe(64); // high E string sounds E4
    expect(soundingMidi('A4')).toBe(57);
    const p = parsePitch('F#4');
    expect(p.writtenMidi - p.soundingMidi).toBe(12);
  });

  it('keeps letter, alteration and octave', () => {
    expect(parsePitch('Bb3')).toMatchObject({ letter: 'B', alter: -1, octave: 3 });
    expect(pitchToString(parsePitch('F#4'))).toBe('F#4');
  });

  it.each(['H4', 'c4', 'C', 'C##4', '4C', 'F♯4', ''])('rejects %j', (text) => {
    expect(() => parsePitch(text)).toThrow(/not a pitch/);
  });

  it('converts MIDI to frequency', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(midiToFrequency(57)).toBeCloseTo(220);
    expect(midiToFrequency(40)).toBeCloseTo(82.41, 2);
  });
});

describe('keys', () => {
  it.each([
    ['C', {}],
    ['G', { F: 1 }],
    ['D', { F: 1, C: 1 }],
    ['A', { F: 1, C: 1, G: 1 }],
    ['E', { F: 1, C: 1, G: 1, D: 1 }],
    ['F', { B: -1 }],
    ['Bb', { B: -1, E: -1 }],
    ['Eb', { B: -1, E: -1, A: -1 }],
    ['Am', {}],
    ['Em', { F: 1 }],
    ['Bm', { F: 1, C: 1 }],
    ['F#m', { F: 1, C: 1, G: 1 }],
    ['C#m', { F: 1, C: 1, G: 1, D: 1 }],
    ['Dm', { B: -1 }],
    ['Gm', { B: -1, E: -1 }],
    ['Cm', { B: -1, E: -1, A: -1 }],
  ])('%s has the right key signature', (key, altered) => {
    const natural = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    expect(keySignature(key)).toEqual({ ...natural, ...altered });
  });

  it('rejects unknown keys', () => {
    expect(() => keySignature('H')).toThrow(/Unknown key/);
  });

  it('knows which pitches the key covers', () => {
    expect(isInKey(parsePitch('F#4'), 'G')).toBe(true);
    expect(isInKey(parsePitch('F4'), 'G')).toBe(false);
    expect(isInKey(parsePitch('Bb3'), 'F')).toBe(true);
  });
});

describe('accidental display', () => {
  const show = (bar: string, key: string) =>
    accidentalsForBar(
      parseBar(bar).map((t) => ({ pitch: t.pitch })),
      key,
    );

  it('hides accidentals the key signature already covers', () => {
    expect(show('F#4/q G4/q A4/q B4/q', 'G')).toEqual([null, null, null, null]);
    expect(show('Bb4/q A4/q G4/q F4/q', 'F')).toEqual([null, null, null, null]);
  });
  it('draws an accidental outside the key', () => {
    expect(show('F#4/q G4/q A4/q Bb4/q', 'C')).toEqual(['#', null, null, 'b']);
  });
  it('draws a natural against the key signature', () => {
    expect(show('F4/q G4/h.', 'G')).toEqual(['n', null]);
  });
  it('does not repeat an accidental later in the same bar', () => {
    expect(show('F#4/q G4/q F#4/q A4/q', 'C')).toEqual(['#', null, null, null]);
  });
  it('cancels an earlier accidental in the same bar', () => {
    expect(show('F#4/q F4/q F#4/q F#4/q', 'C')).toEqual(['#', 'n', '#', null]);
    expect(show('F4/q F#4/q F#4/q F4/q', 'G')).toEqual(['n', '#', null, 'n']);
  });
  it('treats each octave separately', () => {
    expect(show('F#4/q F#5/q F5/q F4/q', 'C')).toEqual(['#', '#', 'n', 'n']);
  });
  it('skips rests and tied continuations', () => {
    expect(show('r/q F#4/q r/q F#4/q', 'C')).toEqual([null, '#', null, null]);
    const tied = accidentalsForBar(
      [{ pitch: parsePitch('F#4'), tiedFromPrevious: true }, { pitch: parsePitch('F#4') }],
      'C',
    );
    expect(tied).toEqual([null, null]);
  });
});

describe('durations', () => {
  it.each([
    ['w', false, false, '1'],
    ['h', false, false, '1/2'],
    ['q', false, false, '1/4'],
    ['8', false, false, '1/8'],
    ['16', false, false, '1/16'],
    ['h', true, false, '3/4'],
    ['q', true, false, '3/8'],
    ['8', true, false, '3/16'],
    ['8', false, true, '1/12'],
    ['q', false, true, '1/6'],
  ] as const)('%s dotted=%s triplet=%s is %s of a whole note', (base, dot, triplet, expected) => {
    expect(fracToString(makeDuration(base, dot, triplet).length)).toBe(expected);
  });

  it('measures bars exactly, and ties do not change the total', () => {
    expect(fracToString(barLength(parseBar('D5/q. C5/8 A4/q')))).toBe('3/4');
    expect(fracToString(barLength(parseBar('G4/h_ G4/8 A4/8 B4/q')))).toBe('1');
    expect(fracToString(barLength(parseBar('C5/16 D5/16 E5/16 F5/16 G5/q')))).toBe('1/2');
  });

  it('converts to beats (quarter notes)', () => {
    expect(wholeNotesToBeats(frac(3, 8))).toEqual({ n: 3, d: 2 });
  });

  it('parses meters', () => {
    expect(parseMeter('3/4')).toMatchObject({ beats: 3, beatUnit: 4, barLength: { n: 3, d: 4 } });
    expect(parseMeter('6/8').barLength).toEqual({ n: 3, d: 4 });
    expect(() => parseMeter('4/5')).toThrow(/not a time signature/);
    expect(() => parseMeter('waltz')).toThrow(/not a time signature/);
  });
});

describe('token parser', () => {
  it('parses a plain note', () => {
    const t = parseToken('E5/q');
    expect(t.pitch?.writtenMidi).toBe(76);
    expect(t.duration.base).toBe('q');
    expect(t.tieToNext).toBe(false);
    expect(t.stringFretOverride).toBeNull();
    expect(t.fingerOverride).toBeNull();
  });
  it('parses overrides', () => {
    const t = parseToken('F#4/8@4-4~3');
    expect(t.pitch?.writtenMidi).toBe(66);
    expect(t.duration.base).toBe('8');
    expect(t.stringFretOverride).toEqual({ string: 4, fret: 4 });
    expect(t.fingerOverride).toBe(3);
  });
  it('parses a finger override on its own', () => {
    expect(parseToken('A4/q~1')).toMatchObject({ stringFretOverride: null, fingerOverride: 1 });
  });
  it('parses rests, ties, dots and triplets', () => {
    expect(parseToken('r/q').pitch).toBeNull();
    expect(parseToken('G4/h_').tieToNext).toBe(true);
    expect(parseToken('D5/q.').duration).toMatchObject({ base: 'q', dotted: true });
    expect(parseToken('D5/8t').duration).toMatchObject({ base: '8', triplet: true });
    expect(parseToken('G4/q._@3-0').tieToNext).toBe(true);
  });

  it.each([
    ['E5', /cannot be read/],
    ['E5/x', /cannot be read/],
    ['E5/32', /cannot be read/],
    ['H5/q', /not a pitch/],
    ['e5/q', /not a pitch/],
    ['r/q_', /rest cannot be tied/],
    ['r/q~1', /rest cannot have/],
    ['E5/q~5', /finger 5 is not valid/],
    ['E5/q@1', /cannot be read/],
    ['E5/q~1@1-0', /cannot be read/],
  ])('rejects %s', (text, pattern) => {
    expect(() => parseToken(text)).toThrow(pattern);
  });

  it('reports file, bar and token', () => {
    let caught: unknown;
    try {
      parseBar('E5/q E5/z', { file: 'pieces/x.json', bar: 3 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContentError);
    const err = caught as ContentError;
    expect(err.location).toEqual({ file: 'pieces/x.json', bar: 3, token: 'E5/z' });
    expect(err.message).toMatch(/^pieces\/x\.json, bar 3, token "E5\/z": /);
  });

  it('rejects an empty bar', () => {
    expect(() => parseBar('   ', { bar: 2 })).toThrow(/bar 2: bar is empty/);
  });
});
