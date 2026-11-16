import { describe, expect, it } from 'vitest';
import {
  beatsToSeconds,
  beatsToTicks,
  secondsToBeats,
  ticksToBeats,
  TICKS_PER_BEAT,
} from '../../src/audio/time';
import { buildTimeline, eventIndexAtBeat, soundingEvents } from '../../src/audio/timeline';
import { frac, fracToNumber, fracToString } from '../../src/content/music';
import { buildPiece } from '../../src/content/validate';
import { CONTENT_FILES, loadPiece, makeRaw } from './helpers';

const beats = (xs: readonly { n: number; d: number }[]) => xs.map(fracToString);

describe('timeline for each content file', () => {
  it('Ode to Joy: 30 notes over 32 beats, quarters and two halves', () => {
    const t = buildTimeline(loadPiece('pieces/ode-to-joy.json'));
    expect(t.events).toHaveLength(30);
    expect(fracToString(t.totalBeats)).toBe('32');
    expect(beats(t.barStartBeats)).toEqual(['0', '4', '8', '12', '16', '20', '24', '28']);
    expect(beats(t.events.slice(0, 5).map((e) => e.startBeat))).toEqual(['0', '1', '2', '3', '4']);
    // Bar 4: E5/q D5/q D5/h
    const bar4 = t.events.filter((e) => e.barIndex === 3);
    expect(beats(bar4.map((e) => e.startBeat))).toEqual(['12', '13', '14']);
    expect(beats(bar4.map((e) => e.durationBeats))).toEqual(['1', '1', '2']);
    // Written E5 E5 F5 G5 sounds an octave lower: E4 E4 F4 G4.
    expect(t.events.slice(0, 4).map((e) => e.soundingMidi)).toEqual([64, 64, 65, 67]);
    expect(t.events.at(-1)).toMatchObject({ barIndex: 7, noteIndex: 2, soundingMidi: 60 });
    expect(fracToString(t.events.at(-1)!.startBeat)).toBe('30');
    expect(t.events.every((e) => !e.isRest && !e.tiedFromPrevious)).toBe(true);
  });

  it('First Steps: ends on a whole note', () => {
    const t = buildTimeline(loadPiece('phrases/p1-first-steps.json'));
    expect(t.events).toHaveLength(11);
    expect(fracToString(t.totalBeats)).toBe('16');
    expect(beats(t.events.map((e) => e.startBeat))).toEqual([
      '0',
      '1',
      '2',
      '4',
      '5',
      '6',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
    expect(beats(t.events.map((e) => e.durationBeats))).toEqual([
      '1',
      '1',
      '2',
      '1',
      '1',
      '2',
      '1',
      '1',
      '1',
      '1',
      '4',
    ]);
    expect(t.events.map((e) => e.soundingMidi)).toEqual([
      60, 62, 64, 65, 64, 62, 64, 62, 59, 55, 60,
    ]);
  });

  it('Down Low: low strings sound E2 at the bottom', () => {
    const t = buildTimeline(loadPiece('phrases/p2-low-strings.json'));
    expect(t.events).toHaveLength(13);
    expect(fracToString(t.totalBeats)).toBe('16');
    expect(t.events.map((e) => e.soundingMidi)).toEqual([
      48, 47, 45, 43, 41, 40, 41, 43, 45, 47, 48, 50, 48,
    ]);
    expect(Math.min(...t.events.map((e) => e.soundingMidi!))).toBe(40);
  });

  it('Little Waltz in G: 3/4 with eighths and dotted values', () => {
    const t = buildTimeline(loadPiece('phrases/p4-g-waltz.json'));
    expect(t.events).toHaveLength(21);
    expect(fracToString(t.totalBeats)).toBe('18');
    expect(fracToString(t.beatsPerBar)).toBe('3');
    expect(beats(t.barStartBeats)).toEqual(['0', '3', '6', '9', '12', '15']);
    // Bar 1: G4/q B4/8 A4/8 B4/q
    expect(beats(t.events.slice(0, 4).map((e) => e.startBeat))).toEqual(['0', '1', '3/2', '2']);
    // Bar 3: five eighths and a quarter
    const bar3 = t.events.filter((e) => e.barIndex === 2);
    expect(beats(bar3.map((e) => e.startBeat))).toEqual(['6', '13/2', '7', '15/2', '8']);
    expect(bar3[0]!.soundingMidi).toBe(54); // written F#4 sounds F#3
    // Bar 4: D5/q. C5/8 A4/q
    const bar4 = t.events.filter((e) => e.barIndex === 3);
    expect(beats(bar4.map((e) => e.startBeat))).toEqual(['9', '21/2', '11']);
    expect(beats(bar4.map((e) => e.durationBeats))).toEqual(['3/2', '1/2', '1']);
    // Bar 6: G4/h.
    expect(fracToString(t.events.at(-1)!.durationBeats)).toBe('3');
  });

  it.each(CONTENT_FILES)('%s: events are back to back and cover the whole piece', (file) => {
    const piece = loadPiece(file);
    const t = buildTimeline(piece);
    expect(t.events).toHaveLength(piece.bars.flat().length);
    let cursor = 0;
    for (const [i, e] of t.events.entries()) {
      expect(e.index).toBe(i);
      expect(fracToNumber(e.startBeat)).toBe(cursor);
      cursor += fracToNumber(e.durationBeats);
      // No ties or rests in the M0 content, so each note sounds for its written length.
      expect(e.soundingBeats).toEqual(e.durationBeats);
      // Every start is a whole number of clock ticks.
      expect(Number.isInteger(fracToNumber(e.startBeat) * TICKS_PER_BEAT)).toBe(true);
    }
    expect(cursor).toBe(fracToNumber(t.totalBeats));
  });
});

describe('ties and rests', () => {
  const timeline = (bars: string[], extra = {}) =>
    buildTimeline(buildPiece(makeRaw(bars, extra), 'test-piece.json'));

  it('a tied note sounds once for the combined length', () => {
    const t = timeline(['C5/h G4/q G4/q_', 'G4/h_ G4/q A4/q']);
    expect(beats(t.events.map((e) => e.startBeat))).toEqual(['0', '2', '3', '4', '6', '7']);
    expect(t.events.map((e) => e.tiedFromPrevious)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
    // The third G4 is struck once and rings through the two notes tied to it: 1 + 2 + 1 beats.
    expect(beats(t.events.map((e) => e.soundingBeats))).toEqual(['2', '1', '4', '0', '0', '1']);
    // Each written note keeps its own place and written length.
    expect(beats(t.events.map((e) => e.durationBeats))).toEqual(['2', '1', '1', '2', '1', '1']);
    expect(soundingEvents(t).map((e) => e.index)).toEqual([0, 1, 2, 5]);
  });

  it('rests make no sound but keep their place', () => {
    const t = timeline(['C5/q r/q D5/q r/q', 'r/h E5/h']);
    expect(t.events.map((e) => e.isRest)).toEqual([false, true, false, true, true, false]);
    expect(t.events.map((e) => e.soundingMidi)).toEqual([60, null, 62, null, null, 64]);
    expect(beats(t.events.map((e) => e.startBeat))).toEqual(['0', '1', '2', '3', '4', '6']);
    expect(beats(t.events.map((e) => e.soundingBeats))).toEqual(['1', '0', '1', '0', '0', '2']);
    expect(soundingEvents(t)).toHaveLength(3);
  });

  it('handles sixteenths exactly', () => {
    const t = timeline(['C5/16 D5/16 E5/16 F5/16 G5/q G5/h']);
    expect(beats(t.events.map((e) => e.startBeat))).toEqual(['0', '1/4', '1/2', '3/4', '1', '2']);
  });
});

describe('finding the event under a beat', () => {
  const starts = [0, 1, 1.5, 2];
  it.each([
    [-0.1, -1],
    [0, 0],
    [0.99, 0],
    [1, 1],
    [1.49, 1],
    [1.5, 2],
    [2.9, 3],
    [3, -1],
    [10, -1],
  ])('beat %f is event %i', (beat, index) => {
    expect(eventIndexAtBeat(starts, 3, beat)).toBe(index);
  });
});

describe('beat and seconds conversion', () => {
  it.each([
    [1, 60, 1],
    [4, 60, 4],
    [1, 120, 0.5],
    [32, 80, 24],
    [1, 30, 2],
    [1, 220, 60 / 220],
    [18, 72, 15],
    [0.5, 90, 1 / 3],
  ])('%f beats at %i BPM is %f seconds', (b, bpm, seconds) => {
    expect(beatsToSeconds(b, bpm)).toBeCloseTo(seconds, 10);
    expect(secondsToBeats(seconds, bpm)).toBeCloseTo(b, 10);
  });

  it('accepts exact fractions', () => {
    expect(beatsToSeconds(frac(3, 2), 90)).toBeCloseTo(1, 10);
  });

  it('round-trips at the ends of the tempo range', () => {
    for (const bpm of [30, 80, 220]) {
      for (const b of [0, 0.25, 1, 7.5, 32]) {
        expect(secondsToBeats(beatsToSeconds(b, bpm), bpm)).toBeCloseTo(b, 10);
      }
    }
  });

  it('converts beats to whole clock ticks', () => {
    expect(beatsToTicks(1)).toBe(TICKS_PER_BEAT);
    expect(beatsToTicks(frac(1, 4))).toBe(48);
    expect(beatsToTicks(frac(1, 3))).toBe(64);
    expect(ticksToBeats(96)).toBe(0.5);
  });
});
