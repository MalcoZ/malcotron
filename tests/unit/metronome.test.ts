import { describe, expect, it } from 'vitest';
import {
  clicksFor,
  countInBeats,
  countInNumber,
  pulseBeats,
  pulsePhase,
} from '../../src/audio/metronome';
import type { Timeline } from '../../src/audio/timeline';
import { beatToTransportTicks, TICKS_PER_BEAT, transportTicksToBeat } from '../../src/audio/time';
import { buildTimeline } from '../../src/audio/timeline';
import { frac } from '../../src/content/music';
import { loadPiece } from './helpers';

describe('metronome clicks', () => {
  it('4/4: a click on every beat, accented on beat 1 of each bar', () => {
    const timeline = buildTimeline(loadPiece('phrases/p1-first-steps.json'));
    const clicks = clicksFor(timeline, 0);
    expect(clicks).toHaveLength(16);
    expect(clicks.map((c) => c.beat)).toEqual([...Array(16).keys()]);
    expect(clicks.filter((c) => c.accent).map((c) => c.beat)).toEqual([0, 4, 8, 12]);
  });

  it('3/4: accents every three beats', () => {
    const timeline = buildTimeline(loadPiece('phrases/p4-g-waltz.json'));
    const clicks = clicksFor(timeline, 0);
    expect(clicks).toHaveLength(18);
    expect(clicks.filter((c) => c.accent).map((c) => c.beat)).toEqual([0, 3, 6, 9, 12, 15]);
  });

  it('a one-bar count-in adds a bar of clicks before beat 0, starting with an accent', () => {
    const timeline = buildTimeline(loadPiece('phrases/p1-first-steps.json'));
    expect(countInBeats(timeline, 1)).toBe(4);
    const clicks = clicksFor(timeline, 4);
    expect(clicks).toHaveLength(20);
    expect(clicks.slice(0, 5).map((c) => [c.beat, c.accent, c.sub])).toEqual([
      [-4, true, false],
      [-3, false, false],
      [-2, false, false],
      [-1, false, false],
      [0, true, false],
    ]);

    const waltz = buildTimeline(loadPiece('phrases/p4-g-waltz.json'));
    expect(countInBeats(waltz, 1)).toBe(3);
    expect(countInBeats(waltz, 2)).toBe(6);
    expect(
      clicksFor(waltz, 3)
        .slice(0, 4)
        .map((c) => [c.beat, c.accent]),
    ).toEqual([
      [-3, true],
      [-2, false],
      [-1, false],
      [0, true],
    ]);
  });

  it('shows 1 2 3 4 during the count-in and nothing after it', () => {
    expect([-4, -3.5, -3, -2.01, -2, -1, -0.01].map((b) => countInNumber(b, 4))).toEqual([
      1, 1, 2, 2, 3, 4, 4,
    ]);
    expect(countInNumber(0, 4)).toBeNull();
    expect(countInNumber(2.5, 4)).toBeNull();
    expect(countInNumber(-1, 0)).toBeNull();
    // Just before the audio starts the beat is a little below -leadIn.
    expect(countInNumber(-4.05, 4)).toBe(1);
  });
});

describe('subdivisions, ranges and compound meters', () => {
  const timeline = buildTimeline(loadPiece('phrases/p1-first-steps.json'));

  it('adds quieter clicks between the beats, but never in the count-in', () => {
    const eighths = clicksFor(timeline, 4, { subdivision: 2 });
    expect(eighths.filter((c) => c.beat < 0)).toHaveLength(4);
    expect(eighths.filter((c) => c.beat >= 0)).toHaveLength(32);
    expect(
      eighths
        .filter((c) => c.sub)
        .map((c) => c.beat)
        .slice(0, 3),
    ).toEqual([0.5, 1.5, 2.5]);
    expect(eighths.filter((c) => c.sub).every((c) => !c.accent)).toBe(true);
    expect(clicksFor(timeline, 0, { subdivision: 4 })).toHaveLength(64);
    const triplets = clicksFor(timeline, 0, { subdivision: 3 }).slice(0, 3);
    expect(triplets.map((c) => c.beat)).toEqual([0, 1 / 3, 2 / 3]);
  });

  it('clicks only inside a selected range, keeping the accents on bar lines', () => {
    const clicks = clicksFor(timeline, 0, { fromBeat: 4, toBeat: 12 });
    expect(clicks.map((c) => c.beat)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(clicks.filter((c) => c.accent).map((c) => c.beat)).toEqual([4, 8]);
  });

  it('uses the right pulse for each meter', () => {
    expect(pulseBeats({ beats: 4, beatUnit: 4 })).toBe(1);
    expect(pulseBeats({ beats: 3, beatUnit: 4 })).toBe(1);
    expect(pulseBeats({ beats: 2, beatUnit: 2 })).toBe(2);
    expect(pulseBeats({ beats: 3, beatUnit: 8 })).toBe(0.5);
    expect(pulseBeats({ beats: 6, beatUnit: 8 })).toBe(1.5);
    expect(pulseBeats({ beats: 9, beatUnit: 8 })).toBe(1.5);
    expect(pulseBeats({ beats: 12, beatUnit: 8 })).toBe(1.5);
  });

  it('6/8 clicks twice a bar on the dotted quarter, with a two-pulse count-in', () => {
    // No content is in 6/8 yet, so build the timeline facts by hand: two bars of three beats.
    const sixEight = {
      events: [],
      totalBeats: { n: 6, d: 1 },
      barStartBeats: [],
      beatsPerBar: { n: 3, d: 1 },
      meter: { beats: 6, beatUnit: 8 },
    } as unknown as Timeline;
    const clicks = clicksFor(sixEight, countInBeats(sixEight, 1));
    expect(clicks.map((c) => c.beat)).toEqual([-3, -1.5, 0, 1.5, 3, 4.5]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, true, false, true, false]);
    expect([-3, -1.6, -1.5, -0.1].map((b) => countInNumber(b, 3, 1.5))).toEqual([1, 1, 2, 2]);
    // Subdividing a dotted-quarter pulse in three gives the eighth notes.
    expect(clicksFor(sixEight, 0, { subdivision: 3 }).map((c) => c.beat)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5,
    ]);
  });

  it('reports how far through a pulse the beat is, for the visual metronome', () => {
    expect(pulsePhase(0, 0)).toBe(0);
    expect(pulsePhase(2.25, 0)).toBeCloseTo(0.25);
    expect(pulsePhase(-3.5, 4)).toBeCloseTo(0.5);
    expect(pulsePhase(0.75, 3, 1.5)).toBeCloseTo(0.5);
  });
});

describe('lead-in maths', () => {
  it('maps beat -leadIn to tick 0 and beat 0 to leadIn beats of ticks', () => {
    expect(beatToTransportTicks(-4, 4)).toBe(0);
    expect(beatToTransportTicks(0, 4)).toBe(4 * TICKS_PER_BEAT);
    expect(beatToTransportTicks(frac(3, 2), 4)).toBe(5.5 * TICKS_PER_BEAT);
    expect(beatToTransportTicks(2, 0)).toBe(2 * TICKS_PER_BEAT);
  });
  it('maps ticks back to beats', () => {
    expect(transportTicksToBeat(0, 4)).toBe(-4);
    expect(transportTicksToBeat(4 * TICKS_PER_BEAT, 4)).toBe(0);
    expect(transportTicksToBeat(96, 0)).toBe(0.5);
    for (const beat of [-3, -0.25, 0, 1.5, 31]) {
      expect(transportTicksToBeat(beatToTransportTicks(beat, 3), 3)).toBeCloseTo(beat, 10);
    }
  });
});
