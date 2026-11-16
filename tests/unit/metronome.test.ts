import { describe, expect, it } from 'vitest';
import { clicksFor, countInBeats, countInNumber } from '../../src/audio/metronome';
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
    expect(clicks.slice(0, 5)).toEqual([
      { beat: -4, accent: true },
      { beat: -3, accent: false },
      { beat: -2, accent: false },
      { beat: -1, accent: false },
      { beat: 0, accent: true },
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
