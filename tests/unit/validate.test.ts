import { describe, expect, it } from 'vitest';
import { parseBar, parseMeter } from '../../src/content/music';
import { computePitchStage, computeRhythmStage } from '../../src/content/stages';
import { buildPiece, findDuplicateIds, validatePiece } from '../../src/content/validate';
import { CONTENT_FILES, makeRaw, readContent, readJson } from './helpers';

const messages = (issues: readonly { message: string }[]) => issues.map((i) => i.message);

describe('content files', () => {
  it.each(CONTENT_FILES)('%s validates with no errors or warnings', (file) => {
    const result = validatePiece(readContent(file), file);
    expect(messages(result.errors)).toEqual([]);
    expect(messages(result.warnings)).toEqual([]);
    expect(result.piece).toBeDefined();
  });

  it.each([
    ['pieces/ode-to-joy.json', 'P1', 'R1', 8],
    ['phrases/p1-first-steps.json', 'P1', 'R1', 4],
    ['phrases/p2-low-strings.json', 'P2', 'R1', 4],
    ['phrases/p4-g-waltz.json', 'P4', 'R4', 6],
  ])('%s needs %s and %s and has %i bars', (file, pitchStage, rhythmStage, bars) => {
    const result = validatePiece(readContent(file), file);
    expect(result.computed).toEqual({ pitchStage, rhythmStage });
    expect(result.piece?.requires).toEqual({ pitchStage, rhythmStage });
    expect(result.piece?.bars).toHaveLength(bars);
  });

  it('gives every note a fingering that follows the rules (acceptance spot checks)', () => {
    const find = (file: string, pitch: string) =>
      buildPiece(readContent(file), file)
        .bars.flat()
        .find((n) => n.token.text.startsWith(pitch))?.fingering;
    expect(find('pieces/ode-to-joy.json', 'G5')).toEqual({ string: 1, fret: 3, finger: 3 });
    expect(find('phrases/p2-low-strings.json', 'E3')).toEqual({ string: 6, fret: 0, finger: 0 });
    expect(find('phrases/p4-g-waltz.json', 'F#4')).toEqual({ string: 4, fret: 4, finger: 4 });
  });

  it('draws no accidentals in the waltz: F# comes from the key signature', () => {
    const piece = buildPiece(readContent('phrases/p4-g-waltz.json'), 'phrases/p4-g-waltz.json');
    expect(piece.bars.flat().every((n) => n.accidental === null)).toBe(true);
  });
});

describe('broken fixtures are rejected with a useful message', () => {
  const check = (name: string) => validatePiece(readJson(`tests/fixtures/${name}`), name);

  it('wrong bar length', () => {
    const result = check('broken-bar-length.json');
    expect(result.piece).toBeUndefined();
    expect(messages(result.errors)).toEqual([
      'broken-bar-length.json, bar 2: bar adds up to 5/4 of a whole note, but 4/4 needs 1 ' +
        '(pickup and short bars are not supported yet)',
    ]);
  });

  it('unreachable pitch', () => {
    const result = check('broken-unreachable-pitch.json');
    expect(result.piece).toBeUndefined();
    expect(messages(result.errors)).toContain(
      'broken-unreachable-pitch.json, bar 1, token "A5/q": A5 cannot be reached in open position',
    );
  });

  it('requires too low', () => {
    const result = check('broken-requires-too-low.json');
    expect(result.piece).toBeUndefined();
    expect(messages(result.errors)).toEqual([
      'broken-requires-too-low.json: "requires.rhythmStage" is R1 but the rhythms used need R3',
      'broken-requires-too-low.json: "requires.pitchStage" is P1 but the notes used need P3',
    ]);
  });

  it('buildPiece throws for each', () => {
    for (const name of [
      'broken-bar-length.json',
      'broken-unreachable-pitch.json',
      'broken-requires-too-low.json',
    ]) {
      expect(() => buildPiece(readJson(`tests/fixtures/${name}`), name)).toThrow(name);
    }
  });
});

describe('validator rules', () => {
  const run = (bars: string[], overrides: Record<string, unknown> = {}) =>
    validatePiece(makeRaw(bars, overrides), 'test-piece.json');

  it('warns when requires is higher than needed', () => {
    const result = run(['C5/q D5/q E5/h'], { requires: { pitchStage: 'P3', rhythmStage: 'R2' } });
    expect(messages(result.errors)).toEqual([]);
    expect(messages(result.warnings)).toEqual([
      'test-piece.json: "requires.rhythmStage" is R2 but the rhythms used only need R1',
      'test-piece.json: "requires.pitchStage" is P3 but the notes used only need P1',
    ]);
    expect(result.piece).toBeDefined();
  });

  it('reports every bad token with its bar', () => {
    const result = run(['C5/q D5/z E5/h', 'H4/w']);
    expect(messages(result.errors)).toHaveLength(2);
    expect(result.errors[0]!.location).toMatchObject({ bar: 1, token: 'D5/z' });
    expect(result.errors[1]!.location).toMatchObject({ bar: 2, token: 'H4/w' });
  });

  it('rejects short bars (pickups come later)', () => {
    expect(messages(run(['G4/q', 'C5/w']).errors)[0]).toMatch(/bar 1: bar adds up to 1\/4/);
  });

  it('checks string-fret overrides are physically valid', () => {
    expect(messages(run(['B4/w@3-5']).errors)[0]).toMatch(/string 3 fret 5 does not produce B4/);
    expect(messages(run(['B4/w@3-4']).errors)).toEqual([]);
  });

  it('lets an override reach outside the position, but the stage check still applies', () => {
    const result = run(['A5/w@1-5']);
    expect(messages(result.errors)).toEqual([
      'test-piece.json, bar 1, token "A5/w@1-5": stage not supported yet: A5 is outside the open-position range E3 to G5',
    ]);
  });

  it('checks ties lead to the same pitch', () => {
    expect(messages(run(['G4/h_ G4/h']).errors)).toEqual([]);
    expect(messages(run(['G4/h_ A4/h']).errors)[0]).toMatch(/tie must lead to the same pitch/);
    expect(messages(run(['G4/h G4/h_']).errors)[0]).toMatch(/tie has no note to tie into/);
    expect(messages(run(['G4/h_ r/h']).errors)[0]).toMatch(/tie must lead to the same pitch/);
  });

  it('marks tied notes across a barline', () => {
    const piece = run(['C5/h. G4/q_', 'G4/h r/h']).piece!;
    expect(piece.bars[0]![1]).toMatchObject({ tieToNext: true, tiedFromPrevious: false });
    expect(piece.bars[1]![0]).toMatchObject({ tieToNext: false, tiedFromPrevious: true });
  });

  it('rejects unsupported stages', () => {
    const stage = /stage not supported yet/;
    expect(messages(run(['C5/8t D5/8t E5/8t G4/h.']).errors)[0]).toMatch(stage);
    expect(messages(run(['C5/q. D5/q.'], { time: '6/8' }).errors)[0]).toMatch(stage);
    expect(messages(run(['C5/8. D5/16 E5/h.']).errors)[0]).toMatch(stage);
    expect(messages(run(['A4/w'], { position: 5 }).errors)[0]).toMatch(stage);
    expect(messages(run(['Bb4/w'], { key: 'Bb' }).errors)[0]).toMatch(stage);
  });

  it('checks the file shape', () => {
    expect(messages(validatePiece([], 'x.json').errors)[0]).toMatch(/one JSON object/);
    const result = validatePiece({ id: 'Bad Id', bars: [] }, 'x.json');
    const all = messages(result.errors).join('\n');
    expect(all).toMatch(/"title" is missing/);
    expect(all).toMatch(/"id" must be lowercase/);
    expect(all).toMatch(/"bars" must be a list/);
    expect(all).toMatch(/"requires.pitchStage"/);
    expect(messages(run(['C5/w'], { key: 'H' }).errors)[0]).toMatch(/key "H" is not supported/);
    expect(messages(run(['C5/w'], { suggestedTempo: 500 }).errors)[0]).toMatch(/suggestedTempo/);
    expect(messages(run(['C5/w'], { id: 'other' }).errors)[0]).toMatch(/file is named/);
  });

  it('finds duplicate ids across files', () => {
    const raw = makeRaw(['C5/w']);
    const issues = findDuplicateIds([
      { file: 'a.json', raw },
      { file: 'b.json', raw },
    ]);
    expect(messages(issues)).toEqual(['b.json: id "test-piece" is already used by a.json']);
  });
});

describe('stage computation', () => {
  const rhythm = (bars: string[], time = '4/4') =>
    computeRhythmStage(
      bars.map((b) => parseBar(b)),
      parseMeter(time),
    );
  const pitch = (bars: string[], key = 'C', position = 0) =>
    computePitchStage(
      bars.map((b) => parseBar(b)),
      key,
      position,
    );

  it.each([
    [['C5/w', 'C5/h r/h', 'C5/q r/q C5/h'], '4/4', 1],
    [['C5/h. r/q'], '4/4', 2],
    [['C5/h r/q'], '3/4', 2],
    [['C5/q C5/q'], '2/4', 2],
    [['C5/8 C5/8 r/8 C5/8 C5/h'], '4/4', 3],
    [['C5/q. C5/8 C5/h'], '4/4', 4],
    [['C5/h_ C5/h'], '4/4', 4],
    [['C5/16 C5/16 C5/16 C5/16 C5/h.'], '4/4', 5],
  ])('rhythm %j in %s needs R%i', (bars, time, stage) => {
    expect(rhythm(bars, time)).toEqual({ ok: true, stage });
  });

  it.each([
    [['C5/8t C5/8t C5/8t C5/h.'], '4/4'],
    [['C5/8. C5/16 C5/h.'], '4/4'],
    [['C5/q. C5/q.'], '6/8'],
    [['C5/w C5/q'], '5/4'],
  ])('rhythm %j in %s is not supported yet', (bars, time) => {
    expect(rhythm(bars, time)).toMatchObject({ ok: false });
  });

  it.each([
    [['G4/q A4/q B4/q G5/q'], 'C', 1],
    [['r/w'], 'C', 1],
    [['E3/q F4/q C4/h'], 'C', 2],
    [['E3/q G5/q C4/h'], 'C', 3],
    [['F4/q G4/h.'], 'C', 3],
    [['F#4/q G4/h.'], 'G', 4],
    [['Bb4/q A4/h.'], 'F', 4],
    [['F#4/q E4/h.'], 'Em', 4],
    [['Bb3/q D4/h.'], 'Dm', 4],
    [['F#4/q G4/h.'], 'C', 5],
    [['F4/q G4/h.'], 'G', 5],
    [['F#4/q C#5/h.'], 'D', 5],
    [['A3/q C4/h.'], 'Am', 5],
  ])('pitches %j in %s need P%i', (bars, key, stage) => {
    expect(pitch(bars, key)).toEqual({ ok: true, stage });
  });

  it('other positions and keys are not supported yet', () => {
    expect(pitch(['A4/w'], 'C', 5)).toMatchObject({ ok: false });
    expect(pitch(['A4/w'], 'A')).toMatchObject({ ok: false });
    expect(pitch(['Eb4/w'], 'Eb')).toMatchObject({ ok: false });
  });
});
