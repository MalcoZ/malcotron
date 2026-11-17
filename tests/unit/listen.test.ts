import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/audio/timeline';
import { LISTEN } from '../../src/config';
import { midiToFrequency } from '../../src/content/music';
import type { Piece } from '../../src/content/types';
import { feedbackFor, soundingName } from '../../src/listen/feedback';
import {
  expectedNotes,
  fitToOwnTempo,
  flipGrade,
  gradeLive,
  gradeTake,
  summarise,
  toleranceFor,
  type HeardNote,
  type TakeGrade,
} from '../../src/listen/grade';
import { analyseSamples } from '../../src/listen/pipeline';
import { hzToMidi, PitchDetector } from '../../src/listen/pitch';
import { renderTake, type SynthNote, type SynthOptions } from '../../src/listen/synth';
import { CONTENT_FILES, loadPiece } from './helpers';

import { vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

const RATE = 44100;
const LEAD = 0.5; // seconds of silence before beat 0

/** The notes a perfect player would play, as synth notes. */
function perfectTake(piece: Piece, bpm: number): SynthNote[] {
  const beat = 60 / bpm;
  return buildTimeline(piece)
    .events.filter((e) => !e.isRest && !e.tiedFromPrevious)
    .map((e) => ({
      time: LEAD + (e.startBeat.n / e.startBeat.d) * beat,
      midi: e.soundingMidi!,
      duration: (e.soundingBeats.n / e.soundingBeats.d) * beat * 0.92,
    }));
}

/** Synthesize a take, run the whole pipeline on it and grade it against the piece. */
function play(
  piece: Piece,
  bpm: number,
  change: (notes: SynthNote[]) => SynthNote[] = (n) => n,
  options: SynthOptions = {},
): { grade: TakeGrade; heard: HeardNote[] } {
  const timeline = buildTimeline(piece);
  const total = (timeline.totalBeats.n / timeline.totalBeats.d) * (60 / bpm);
  const samples = renderTake(change(perfectTake(piece, bpm)), RATE, LEAD + total + 0.5, options);
  const heard = analyseSamples(samples, RATE).map((n) => ({
    beat: ((n.onset - LEAD) * bpm) / 60,
    midi: n.midi,
    clarity: n.clarity,
    durationBeats: (n.duration * bpm) / 60,
  }));
  return { grade: gradeTake(expectedNotes(timeline), heard, bpm, toleranceFor(piece)), heard };
}

const statuses = (grade: TakeGrade) => grade.notes.map((n) => n.status);

describe('pitch detection', () => {
  it('is within 10 cents on every semitone from E2 to B5', () => {
    const detector = new PitchDetector(RATE);
    for (let midi = 40; midi <= 83; midi++) {
      const samples = renderTake([{ time: 0, midi, duration: 0.3 }], RATE, 0.3);
      const frame = samples.subarray(2000, 2000 + LISTEN.frameSize);
      const { hz, clarity } = detector.detect(frame);
      expect(hz, `MIDI ${midi}`).not.toBeNull();
      expect(Math.abs(hzToMidi(hz!) - midi) * 100, `MIDI ${midi}`).toBeLessThan(10);
      expect(clarity, `MIDI ${midi}`).toBeGreaterThan(LISTEN.clarityThreshold);
    }
  });

  it('works at 48 kHz, and measures a detuned note', () => {
    const detector = new PitchDetector(48000);
    const flat = renderTake([{ time: 0, midi: 57 - 0.3, duration: 0.3 }], 48000, 0.3);
    const { hz } = detector.detect(flat.subarray(2000, 2000 + LISTEN.frameSize));
    expect(hzToMidi(hz!)).toBeCloseTo(56.7, 1);
    expect(hzToMidi(midiToFrequency(69))).toBeCloseTo(69, 6);
  });

  it('finds no pitch in silence or noise', () => {
    const detector = new PitchDetector(RATE);
    expect(detector.detect(new Float32Array(LISTEN.frameSize)).hz).toBeNull();
    const noise = renderTake([], RATE, 0.2, { noise: 0.3 });
    const estimate = detector.detect(noise.subarray(0, LISTEN.frameSize));
    expect(estimate.clarity).toBeLessThan(LISTEN.clarityThreshold);
  });
});

describe('clean takes grade 100%', () => {
  for (const file of CONTENT_FILES) {
    for (const bpm of [60, 100, 160]) {
      it(`${file} at ${bpm} BPM`, () => {
        const piece = loadPiece(file);
        const { grade, heard } = play(piece, bpm);
        expect(heard).toHaveLength(grade.notes.length);
        expect(statuses(grade).every((s) => s === 'green')).toBe(true);
        expect(grade.extras).toEqual([]);
        expect(summarise(grade).accuracy).toBe(1);
        // Onsets are found to within 50 ms (the on-time window is 120 ms).
        for (const note of grade.notes) expect(Math.abs(note.offsetMs!)).toBeLessThan(50);
        expect(feedbackFor(grade, piece)).toBe('Every note right and on time.');
      });
    }
  }

  it('with room noise, and with strings left ringing', () => {
    const piece = loadPiece('pieces/ode-to-joy.json');
    expect(summarise(play(piece, 80, (n) => n, { noise: 0.004, seed: 7 }).grade).onTime).toBe(30);
    const ringing = play(piece, 80, (n) => n, { ring: 0.25 }).grade;
    expect(summarise(ringing).accuracy).toBe(1);
  });

  it('with the guitar a little out of tune', () => {
    const piece = loadPiece('phrases/p1-first-steps.json');
    const flat = play(piece, 80, (notes) => notes.map((n) => ({ ...n, midi: n.midi - 0.25 })));
    expect(summarise(flat.grade).accuracy).toBe(1);
  });
});

describe('a real laptop mic: quiet, with weak low fundamentals', () => {
  it('a very quiet take (automatic gain off) still grades 100%', () => {
    const piece = loadPiece('pieces/ode-to-joy.json');
    // Peaks around 1% of full scale, over a faint hiss.
    const { grade, heard } = play(piece, 80, (n) => n, { gain: 0.02, noise: 0.0001, seed: 5 });
    expect(heard).toHaveLength(30);
    expect(summarise(grade)).toMatchObject({ pitchCorrect: 30, onTime: 30 });
  });

  it('low strings with almost no fundamental are still read at the right octave', () => {
    const piece = loadPiece('phrases/p2-low-strings.json');
    const { grade } = play(piece, 70, (n) => n, { fundamental: 0.1, gain: 0.05, noise: 0.0002 });
    expect(summarise(grade).pitchCorrect).toBe(13);
    expect(grade.notes.every((n) => !n.octaveForgiven)).toBe(true);
  });

  it('every open string is heard, quiet and with a weak fundamental', () => {
    const notes = [40, 45, 50, 55, 59, 64].map((midi, i) => ({
      time: 0.5 + i * 1.2,
      midi,
      duration: 1,
    }));
    const samples = renderTake(notes, 48000, 8, { fundamental: 0.15, gain: 0.03, noise: 0.0002 });
    const heard = analyseSamples(samples, 48000);
    expect(heard.map((n) => Math.round(n.midi))).toEqual([40, 45, 50, 55, 59, 64]);
  });

  it('room hiss alone is still heard as nothing', () => {
    expect(analyseSamples(renderTake([], RATE, 4, { noise: 0.003, seed: 9 }), RATE)).toEqual([]);
    expect(analyseSamples(renderTake([], RATE, 4, { noise: 0.0002, seed: 9 }), RATE)).toEqual([]);
  });
});

describe('mistakes are graded as that mistake', () => {
  const ode = loadPiece('pieces/ode-to-joy.json');

  it('a wrong note is red, names what was played, and its neighbours stay green', () => {
    // Bar 1 is E E F G: play the F (note 3) as G, the 3rd fret instead of the 1st.
    const { grade } = play(ode, 80, (n) => n.map((x, i) => (i === 2 ? { ...x, midi: 67 } : x)));
    expect(grade.notes[2]).toMatchObject({ status: 'red', reason: 'wrong', heardMidi: 67 });
    expect(statuses(grade).filter((s) => s === 'green')).toHaveLength(29);
    expect(feedbackFor(grade, ode)).toBe(
      'Bar 1: the F was played as G. It is the 1st fret on the 1st string, not the 3rd fret.',
    );
  });

  it('a missed note is red and does not shift the notes after it', () => {
    const { grade } = play(ode, 80, (n) => n.filter((_, i) => i !== 5));
    expect(grade.notes[5]).toMatchObject({ status: 'red', reason: 'missed', heardMidi: null });
    expect(statuses(grade).filter((s) => s === 'green')).toHaveLength(29);
    expect(feedbackFor(grade, ode)).toMatch(/^Bar 2: the F was not heard\./);
  });

  it('an extra note is reported as extra and costs nothing', () => {
    const extra: SynthNote = { time: LEAD + 1.5 * 0.75, midi: 62, duration: 0.2 };
    // The note before it is cut short, as it would be on the same string.
    const { grade } = play(ode, 80, (n) => [
      n[0]!,
      { ...n[1]!, duration: 0.3 },
      extra,
      ...n.slice(2),
    ]);
    expect(statuses(grade).every((s) => s === 'green')).toBe(true);
    expect(grade.extras).toHaveLength(1);
    expect(Math.round(grade.extras[0]!.midi)).toBe(62);
  });

  it('a late note is amber, a very late one is a timing miss with the pitch credited', () => {
    const { grade } = play(ode, 80, (n) =>
      n.map((x, i) =>
        i === 4 ? { ...x, time: x.time + 0.18 } : i === 9 ? { ...x, time: x.time + 0.3 } : x,
      ),
    );
    expect(grade.notes[4]).toMatchObject({ status: 'amber', reason: 'timing', pitchCorrect: true });
    expect(grade.notes[4]!.offsetMs!).toBeGreaterThan(150);
    expect(grade.notes[9]).toMatchObject({ status: 'red', reason: 'timing', pitchCorrect: true });
    expect(summarise(grade)).toMatchObject({
      total: 30,
      pitchCorrect: 30,
      onTime: 28,
      accuracy: 1,
    });
    expect(feedbackFor(grade, ode)).toBe(
      'All the right notes. 2 notes were a little late: listen for the click and count along.',
    );
  });

  it('rushing is reported as early', () => {
    const { grade } = play(ode, 80, (n) =>
      n.map((x, i) => (i >= 20 ? { ...x, time: x.time - 0.16 } : x)),
    );
    expect(
      statuses(grade)
        .slice(20)
        .every((s) => s === 'amber'),
    ).toBe(true);
    expect(feedbackFor(grade, ode)).toMatch(/10 notes were a little early/);
  });

  it('repeated notes on one string are heard as separate notes', () => {
    const { heard } = play(ode, 160);
    // E E at the start, G G across bars 1 and 2, C C in bar 3.
    expect(heard.slice(0, 2).map((h) => Math.round(h.midi))).toEqual([64, 64]);
    expect(heard[1]!.beat - heard[0]!.beat).toBeCloseTo(1, 1);
  });

  it('playing nothing asks about the mic', () => {
    const { grade } = play(ode, 80, () => []);
    expect(statuses(grade).every((s) => s === 'red')).toBe(true);
    expect(feedbackFor(grade, ode)).toMatch(/^Most of the notes were not heard/);
  });
});

describe('the metronome click does not confuse the mic', () => {
  it('clicks on every beat create no notes and change no grades', () => {
    const piece = loadPiece('phrases/p2-low-strings.json');
    const bpm = 90;
    const clicks = Array.from({ length: 22 }, (_, i) => LEAD + ((i - 4) * 60) / bpm);
    const { grade, heard } = play(piece, bpm, (n) => n, { clicks, clickLevel: 0.6 });
    expect(heard).toHaveLength(13);
    expect(statuses(grade).every((s) => s === 'green')).toBe(true);
  });

  it('clicks alone are heard as nothing', () => {
    const clicks = Array.from({ length: 8 }, (_, i) => 0.3 + i * 0.5);
    expect(analyseSamples(renderTake([], RATE, 4.5, { clicks, clickLevel: 0.8 }), RATE)).toEqual(
      [],
    );
  });
});

describe('grading rules', () => {
  const piece = loadPiece('phrases/p1-first-steps.json');
  const expected = expectedNotes(buildTimeline(piece));
  const heardAt = (i: number, extra: Partial<HeardNote> = {}): HeardNote => ({
    beat: expected[i]!.beat,
    midi: expected[i]!.midi,
    clarity: 0.99,
    durationBeats: 1,
    ...extra,
  });
  const all = (change: (h: HeardNote, i: number) => HeardNote = (h) => h) =>
    expected.map((_, i) => change(heardAt(i), i));

  it('uses the looser tolerance in early stages and the tighter one later', () => {
    expect(toleranceFor(piece)).toEqual(LISTEN.early);
    const later = { requires: { pitchStage: 'P6', rhythmStage: 'R3' } } as const;
    expect(toleranceFor(later)).toEqual(LISTEN.later);
    // 100 ms late at 60 BPM is 0.1 beat: green early on, amber later.
    const take = all((h, i) => (i === 3 ? { ...h, beat: h.beat + 0.1 } : h));
    expect(gradeTake(expected, take, 60, LISTEN.early).notes[3]!.status).toBe('green');
    expect(gradeTake(expected, take, 60, LISTEN.later).notes[3]!.status).toBe('amber');
  });

  it('accepts a pitch within 50 cents and rejects one beyond', () => {
    const near = all((h, i) => (i === 0 ? { ...h, midi: h.midi + 0.45 } : h));
    expect(gradeTake(expected, near, 60, LISTEN.early).notes[0]!.status).toBe('green');
    const far = all((h, i) => (i === 0 ? { ...h, midi: h.midi + 0.6 } : h));
    expect(gradeTake(expected, far, 60, LISTEN.early).notes[0]!.reason).toBe('wrong');
  });

  it('forgives an octave error only when the detector was unsure', () => {
    const unsure = all((h, i) => (i === 2 ? { ...h, midi: h.midi - 12, clarity: 0.91 } : h));
    const forgiven = gradeTake(expected, unsure, 60, LISTEN.early).notes[2]!;
    expect(forgiven).toMatchObject({ status: 'green', octaveForgiven: true });
    const sure = all((h, i) => (i === 2 ? { ...h, midi: h.midi - 12, clarity: 0.99 } : h));
    expect(gradeTake(expected, sure, 60, LISTEN.early).notes[2]!.reason).toBe('wrong');
  });

  it('a restart does not turn every later note red', () => {
    // Plays the first three notes, stops, and starts again from the top two beats late.
    const take = [
      heardAt(0),
      heardAt(1),
      heardAt(2),
      ...all((h) => ({ ...h, beat: h.beat + 0.1 })),
    ];
    const grade = gradeTake(expected, take, 60, LISTEN.early);
    expect(summarise(grade).pitchCorrect).toBe(expected.length);
    expect(grade.extras).toHaveLength(3);
  });

  it('flipping a grade corrects it and records that it was flipped', () => {
    const grade = gradeTake(expected, all().slice(1), 60, LISTEN.early);
    const missed = grade.notes[0]!;
    expect(missed.status).toBe('red');
    const fixed = flipGrade(missed);
    expect(fixed).toMatchObject({ status: 'green', pitchCorrect: true, flipped: true });
    expect(flipGrade(fixed)).toMatchObject({ status: 'red', flipped: false });
  });

  it('grades a note live against the nearest written note not yet graded', () => {
    const taken = new Set<number>();
    const first = gradeLive(expected, taken, heardAt(0, { beat: 0.05 }), 60, LISTEN.early)!;
    expect(first.expected.index).toBe(expected[0]!.index);
    expect(first.status).toBe('green');
    taken.add(first.expected.index);
    const wrong = gradeLive(expected, taken, heardAt(1, { midi: 70 }), 60, LISTEN.early)!;
    expect(wrong).toMatchObject({ status: 'red', reason: 'wrong', heardMidi: 70 });
    expect(gradeLive(expected, taken, heardAt(0, { beat: 30 }), 60, LISTEN.early)).toBeNull();
  });

  it('names sounding pitches', () => {
    expect([40, 53, 54, 60, 70].map(soundingName)).toEqual(['E', 'F', 'F♯', 'C', 'B♭']);
  });
});

describe('a take with no click is graded against its own tempo', () => {
  it('finds the tempo and start of a steady take', () => {
    const piece = loadPiece('pieces/ode-to-joy.json');
    const expected = expectedNotes(buildTimeline(piece));
    const bpm = 92;
    const samples = renderTake(
      perfectTake(piece, bpm).map((n) => ({ ...n, time: n.time + 1.3 })),
      RATE,
      24,
    );
    const fitted = fitToOwnTempo(expected, analyseSamples(samples, RATE), 80);
    expect(fitted.bpm).toBeCloseTo(92, 0);
    const grade = gradeTake(expected, fitted.heard, fitted.bpm, toleranceFor(piece));
    expect(summarise(grade)).toMatchObject({ pitchCorrect: 30, onTime: 30 });
  });

  it('still grades a take with a wrong note and a missed one', () => {
    const piece = loadPiece('phrases/p4-g-waltz.json');
    const expected = expectedNotes(buildTimeline(piece));
    const notes = perfectTake(piece, 70)
      .map((n, i) => (i === 6 ? { ...n, midi: n.midi + 2 } : n))
      .filter((_, i) => i !== 12);
    const fitted = fitToOwnTempo(expected, analyseSamples(renderTake(notes, RATE, 18), RATE), 72);
    const grade = gradeTake(expected, fitted.heard, fitted.bpm, toleranceFor(piece));
    expect(grade.notes[6]!.reason).toBe('wrong');
    expect(grade.notes[12]!.reason).toBe('missed');
    expect(summarise(grade).pitchCorrect).toBe(19);
  });
});
