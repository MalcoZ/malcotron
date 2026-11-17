import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { ENGINE } from '../../src/config';
import type { Piece, PieceFile } from '../../src/content/types';
import { validateCourse } from '../../src/course/lessons';
import type { Course } from '../../src/course/types';
import { generateExercise, generatePiece, type ExerciseSpec } from '../../src/engine/generator';
import { planSession, type SessionItem } from '../../src/engine/session';
import {
  skillAccuracies,
  skillsOfPiece,
  uniformResults,
  type NoteResult,
} from '../../src/engine/skills';
import {
  applyAttempt,
  dueSkills,
  emptyState,
  frequentConfusions,
  introduce,
  isMastered,
  parseState,
  ratingFor,
  recordPeek,
  summarise,
  updateDials,
  type EngineState,
} from '../../src/engine/state';
import { CONTENT_FILES, loadPiece, readContent } from './helpers';

const day = (n: number, hour = 10) => new Date(2026, 0, n, hour, 0, 0);
const perfect = (piece: Piece) => uniformResults(piece, 1);

function loadCourse(): Course {
  const dir = fileURLToPath(new URL('../../content/lessons', import.meta.url));
  const files = readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => ({ file: `lessons/${n}`, raw: readContent(`lessons/${n}`) }));
  const pieceDirs = ['pieces', 'phrases'].flatMap((d) =>
    readdirSync(fileURLToPath(new URL(`../../content/${d}`, import.meta.url))).map(
      (n) => `${d}/${n}`,
    ),
  );
  const pieces = new Map(
    pieceDirs.map((f) => {
      const raw = readContent(f) as PieceFile;
      return [raw.id, raw];
    }),
  );
  const result = validateCourse(readContent('curriculum.json'), files, pieces);
  expect(result.errors.map((e) => e.message)).toEqual([]);
  return result.course!;
}

describe('skills of a piece', () => {
  it('finds pitch, key, rhythm and meter skills in the waltz', () => {
    const skills = skillsOfPiece(loadPiece('phrases/p4-g-waltz.json'));
    const ids = [...skills.keys()];
    expect(ids).toContain('pos0/str4/F#4');
    expect(ids).toContain('pos0/str3/G4');
    expect(ids).toContain('key/G');
    expect(ids).toContain('rhy/q.');
    expect(ids).toContain('rhy/8');
    expect(ids).toContain('rhy/h.');
    expect(ids).toContain('meter/3-4');
    expect(ids.some((id) => id.startsWith('acc/'))).toBe(false);
    // The key skill is graded from the two F sharps.
    expect(skills.get('key/G')).toEqual(['2:0', '4:2']);
    expect(skillsOfPiece(loadPiece('phrases/p4-g-waltz.json'), true).has('piece/p4-g-waltz')).toBe(
      true,
    );
  });

  it('gives each skill its own accuracy: pitch by right notes, rhythm by timing', () => {
    const piece = loadPiece('phrases/p1-first-steps.json');
    const results: NoteResult[] = uniformResults(piece, 1).map((r, i) =>
      i === 0 ? { ...r, pitchCorrect: false, heardMidi: 62 } : i === 2 ? { ...r, timing: 0.5 } : r,
    );
    const acc = skillAccuracies(skillsOfPiece(piece), results);
    // C5 is played three times (bar 1, bar 4): one wrong.
    expect(acc.get('pos0/str2/C5')).toBeCloseTo(0.5);
    expect(acc.get('pos0/str2/D5')).toBe(1);
    // The first half note (bar 1, note 3) was a little off: half notes average below 1.
    expect(acc.get('rhy/h')).toBeCloseTo(0.75);
    expect(acc.get('rhy/q')).toBe(1);
  });

  it('spreads the misses of a self-check through the take', () => {
    const piece = loadPiece('pieces/ode-to-joy.json');
    const results = uniformResults(piece, 0.5);
    expect(results.filter((r) => r.pitchCorrect)).toHaveLength(15);
    expect(uniformResults(piece, 1).every((r) => r.pitchCorrect)).toBe(true);
  });
});

describe('ratings and mastery', () => {
  it('maps accuracy to an FSRS rating (spec section 4)', () => {
    expect(ratingFor(0.59, true)).toBe(Rating.Again);
    expect(ratingFor(0.6, true)).toBe(Rating.Hard);
    expect(ratingFor(0.89, true)).toBe(Rating.Hard);
    expect(ratingFor(0.9, true)).toBe(Rating.Good);
    expect(ratingFor(0.99, true)).toBe(Rating.Good);
    expect(ratingFor(1, true)).toBe(Rating.Easy);
    // Passed only on a retry: Hard at best.
    expect(ratingFor(1, false)).toBe(Rating.Hard);
    expect(ratingFor(0.3, false)).toBe(Rating.Again);
  });

  it('needs three good sessions on three different days', () => {
    const good = (d: string) => ({ day: d, accuracy: 0.95 });
    expect(isMastered([good('a'), good('a'), good('a')])).toBe(false);
    expect(isMastered([good('a'), good('b')])).toBe(false);
    expect(isMastered([good('a'), good('b'), { day: 'c', accuracy: 0.8 }])).toBe(false);
    expect(isMastered([good('a'), good('b'), good('c')])).toBe(true);
  });

  it('a skill goes new, learning, mastered, and back to learning on a failed review', () => {
    const state = emptyState();
    const piece = loadPiece('phrases/p1-first-steps.json');
    const id = 'pos0/str2/C5';
    applyAttempt(state, piece, perfect(piece), day(1));
    expect(state.skills[id]).toMatchObject({ status: 'learning', attempts: 1 });
    applyAttempt(state, piece, perfect(piece), day(1, 15));
    applyAttempt(state, piece, perfect(piece), day(2));
    expect(state.skills[id]!.status).toBe('learning');
    applyAttempt(state, piece, perfect(piece), day(3));
    expect(state.skills[id]!.status).toBe('mastered');
    expect(summarise(state, day(3)).mastered).toBeGreaterThan(5);
    // The review is scheduled well into the future.
    expect(new Date(state.skills[id]!.card.due).getTime()).toBeGreaterThan(day(6).getTime());
    expect(dueSkills(state, day(4))).not.toContain(id);
    expect(dueSkills(state, day(300))).toContain(id);
    // A failed review drops it back.
    applyAttempt(state, piece, uniformResults(piece, 0), day(40));
    expect(state.skills[id]!.status).toBe('learning');
  });

  it('free practice updates the stats but not the review schedule', () => {
    const state = emptyState();
    const piece = loadPiece('phrases/p1-first-steps.json');
    applyAttempt(state, piece, perfect(piece), day(1));
    const before = state.skills['pos0/str2/C5']!.card.due;
    applyAttempt(state, piece, perfect(piece), day(2), { scheduled: false });
    expect(state.skills['pos0/str2/C5']!.card.due).toBe(before);
    expect(state.skills['pos0/str2/C5']!.attempts).toBe(2);
  });

  it('counts which wrong note was played, and logs peeks without penalty', () => {
    const state = emptyState();
    const piece = loadPiece('phrases/p1-first-steps.json');
    const results = perfect(piece).map((r, i) =>
      i === 3 ? { ...r, pitchCorrect: false, heardMidi: 67 } : r,
    );
    applyAttempt(state, piece, results, day(1));
    applyAttempt(state, piece, results, day(1, 12));
    // Bar 2 starts on F5 (sounding 65); G (67) was played instead, twice.
    expect(state.confusions).toEqual({ '65>67': 2 });
    expect(frequentConfusions(state)).toEqual([{ written: 65, played: 67, count: 2 }]);
    recordPeek(state, piece, day(1));
    expect(state.skills['pos0/str1/F5']!.peeks).toBe(1);
    expect(state.skills['pos0/str1/F5']!.attempts).toBe(2);
  });

  it('introducing skills makes them "learning" without an attempt', () => {
    const state = emptyState();
    introduce(state, ['pos0/str3/G4', 'rhy/q'], day(1));
    expect(state.skills['rhy/q']).toMatchObject({ status: 'learning', attempts: 0 });
    expect(dueSkills(state, day(2))).toEqual([]);
  });

  it('survives a round trip, and starts fresh from damaged data', () => {
    const state = emptyState();
    const piece = loadPiece('phrases/p1-first-steps.json');
    applyAttempt(state, piece, perfect(piece), day(1));
    const back = parseState(JSON.stringify(state));
    expect(back).toEqual(state);
    applyAttempt(back, piece, perfect(piece), day(2)); // the restored card still schedules
    expect(back.skills['rhy/q']!.attempts).toBe(2);
    for (const text of [null, '{oops', '[]', JSON.stringify({ version: 2, skills: {} })]) {
      expect(parseState(text)).toEqual(emptyState());
    }
    const damaged = JSON.stringify({
      version: 1,
      skills: { a: { card: {} }, b: state.skills['rhy/q'] },
    });
    expect(Object.keys(parseState(damaged).skills)).toEqual(['b']);
  });
});

describe('difficulty dials', () => {
  it('steps up after three exercises above 95%, in order: tempo, length, interval, markers', () => {
    const dials = emptyState().dials;
    expect(updateDials(dials, 1)).toBeNull();
    expect(updateDials(dials, 0.97)).toBeNull();
    expect(updateDials(dials, 1)).toBe('up');
    expect(dials.tempo).toBe(ENGINE.startTempo + 8);
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) {
      const before = { ...dials };
      if (updateDials(dials, 1) === 'up') {
        seen.push(
          (['tempo', 'length', 'interval', 'markers'] as const).find(
            (k) => dials[k] !== before[k],
          )!,
        );
      }
    }
    expect(seen.slice(0, 7)).toEqual([
      'tempo',
      'length',
      'length',
      'interval',
      'interval',
      'markers',
      'markers',
    ]);
    expect(dials.tempo).toBeLessThanOrEqual(ENGINE.maxTempo);
  });

  it('steps down after two below 70%, and a mixed run does nothing', () => {
    const dials = emptyState().dials;
    expect(updateDials(dials, 0.5)).toBeNull();
    expect(updateDials(dials, 0.6)).toBe('down');
    expect(dials.tempo).toBe(ENGINE.startTempo - 8);
    for (const a of [0.9, 0.5, 0.96, 0.8, 1, 0.65, 0.9]) expect(updateDials(dials, a)).toBeNull();
    for (let i = 0; i < 20; i++) updateDials(dials, 0.1);
    expect(dials.tempo).toBeGreaterThanOrEqual(ENGINE.minTempo);
  });
});

describe('exercise generator', () => {
  const base: ExerciseSpec = {
    seed: 1,
    key: 'C',
    time: '4/4',
    bars: 4,
    pool: ['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'],
    focus: ['F5', 'A4'],
    rhythms: ['q', 'h', 'w', 'rq', 'rh'],
    interval: 0,
    tempo: 60,
  };

  it('makes the same exercise from the same seed, and different ones from different seeds', () => {
    expect(generateExercise(base)).toEqual(generateExercise({ ...base }));
    const others = new Set(
      [1, 2, 3, 4, 5].map((seed) => generateExercise({ ...base, seed }).bars.join('|')),
    );
    expect(others.size).toBeGreaterThan(3);
  });

  it('every exercise passes the content validator, across seeds, meters, keys and lengths', () => {
    const specs: Partial<ExerciseSpec>[] = [
      {},
      { time: '3/4', rhythms: ['q', 'h', 'h.'] },
      { time: '2/4', rhythms: ['q', 'h', '8'] },
      { rhythms: ['q', 'h', 'w', '8', 'r8', 'q.', 'tie', 'h.'], interval: 2, bars: 8 },
      { rhythms: ['q', '16', '8', 'h'], bars: 2 },
      { key: 'G', pool: ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C5', 'D5'], focus: ['F#4'] },
      { key: 'F', pool: ['F4', 'G4', 'A4', 'Bb4', 'C5', 'D5'], focus: ['Bb4'] },
      { key: 'Am', pool: ['A3', 'B3', 'C4', 'D4', 'E4', 'G#4', 'A4'], focus: ['G#4'], interval: 1 },
      {
        pool: ['E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4'],
        focus: ['F3'],
        rhythms: ['q'],
      },
      { pool: ['G4', 'B4'], focus: [], bars: 2 },
    ];
    let made = 0;
    for (const extra of specs) {
      for (let seed = 1; seed <= 25; seed++) {
        const spec = { ...base, ...extra, seed };
        const piece = generatePiece(spec);
        expect(piece.bars).toHaveLength(spec.bars);
        made++;
      }
    }
    expect(made).toBe(250);
  });

  it('follows the musical rules', () => {
    const chord = new Set(['C', 'E', 'G']);
    for (let seed = 1; seed <= 40; seed++) {
      const spec = { ...base, seed, interval: 2 };
      const piece = generatePiece(spec);
      const notes = piece.bars.flat().filter((n) => n.pitch && !n.tiedFromPrevious);
      const where = `seed ${seed}: ${piece.bars.map((b) => b.map((n) => n.token.text).join(' ')).join(' | ')}`;
      // Starts and ends on a chord tone of the key, and ends on a long note.
      expect(chord, where).toContain(notes[0]!.pitch!.letter);
      expect(chord, where).toContain(notes.at(-1)!.pitch!.letter);
      expect(['w', 'h'], where).toContain(notes.at(-1)!.duration.base);
      // Uses only the pool and the allowed rhythm values, and includes every focus note.
      const used = new Set(notes.map((n) => `${n.pitch!.letter}${n.pitch!.octave}`));
      for (const p of used) expect(spec.pool, where).toContain(p);
      for (const p of spec.focus) expect(used, where).toContain(p);
      // A leap of more than a 4th is followed by a step back.
      const index = (n: (typeof notes)[number]) =>
        spec.pool.indexOf(`${n.pitch!.letter}${n.pitch!.octave}`);
      for (let i = 1; i < notes.length - 2; i++) {
        const leap = index(notes[i]!) - index(notes[i - 1]!);
        // (A focus note put in afterwards may break the line; those are left out of the check.)
        const forced = [i - 1, i, i + 1].some((j) =>
          spec.focus.includes(spec.pool[index(notes[j]!)]!),
        );
        if (Math.abs(leap) >= 4 && !forced) {
          const next = index(notes[i + 1]!) - index(notes[i]!);
          expect(Math.sign(next), where).toBe(-Math.sign(leap));
          expect(Math.abs(next), where).toBe(1);
        }
      }
    }
  });

  it('at the easiest setting it moves mostly by step', () => {
    let steps = 0;
    let moves = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const spec = { ...base, seed, focus: [] };
      const notes = generatePiece(spec)
        .bars.flat()
        .filter((n) => n.pitch);
      for (let i = 1; i < notes.length - 1; i++) {
        const d = Math.abs(
          spec.pool.indexOf(`${notes[i]!.pitch!.letter}${notes[i]!.pitch!.octave}`) -
            spec.pool.indexOf(`${notes[i - 1]!.pitch!.letter}${notes[i - 1]!.pitch!.octave}`),
        );
        moves++;
        if (d <= 1) steps++;
      }
    }
    expect(steps / moves).toBeGreaterThan(0.85);
  });

  it('a confusion drill opens with the two notes side by side', () => {
    const piece = generatePiece({
      ...base,
      pair: ['F5', 'G5'],
      focus: ['F5', 'G5'],
      rhythms: ['q'],
    });
    expect(piece.bars[0]!.map((n) => n.token.text)).toEqual(['F5/q', 'G5/q', 'F5/q', 'G5/q']);
  });

  it('refuses an empty pool or an unknown key', () => {
    expect(() => generateExercise({ ...base, pool: [] })).toThrow(/no pitches/);
    expect(() => generateExercise({ ...base, key: 'H' })).toThrow(/Unknown key/);
  });
});

describe('session builder', () => {
  const pieces = CONTENT_FILES.map((f) => loadPiece(f));
  const context = { nextLesson: { id: 'p1-the-staff', title: 'Reading from the staff' }, pieces };
  const kinds = (items: SessionItem[]) =>
    items.map((i) => (i.kind === 'exercise' ? i.block : i.kind));

  it('a brand-new learner just gets the first lesson', () => {
    const plan = planSession(emptyState(), context, day(1), 7);
    expect(kinds(plan.items)).toEqual(['lesson']);
    expect(plan.minutes).toBe(ENGINE.minutesPerLesson);
  });

  it('once notes are known: warm-up, reviews, the next lesson, then a piece', () => {
    const state = emptyState();
    const steps = loadPiece('phrases/p1-first-steps.json');
    applyAttempt(state, steps, uniformResults(steps, 0.8), day(1));
    const plan = planSession(state, context, day(2), 7);
    expect(kinds(plan.items)).toEqual([
      'warm-up',
      'warm-up',
      'review',
      'review',
      'review',
      'lesson',
      'piece',
    ]);
    // First Steps is the only piece whose every note and rhythm has been met.
    expect(plan.items.at(-1)).toMatchObject({ kind: 'piece', pieceId: 'p1-first-steps' });
    expect(plan.backlogged).toBe(false);
    // Every planned exercise can be generated, and uses only known pitches.
    const knownPitches = ['C5', 'D5', 'E5', 'F5', 'B4', 'G4'];
    for (const item of plan.items) {
      if (item.kind !== 'exercise') continue;
      const piece = generatePiece(item.spec);
      for (const n of piece.bars.flat()) {
        if (n.pitch) expect(knownPitches).toContain(`${n.pitch.letter}${n.pitch.octave}`);
      }
    }
    // The same seed plans the same session.
    expect(planSession(state, context, day(2), 7)).toEqual(plan);
  });

  it('holds back new material when reviews have piled up', () => {
    const state = emptyState();
    // 60 skills, all learned long ago and now due.
    for (let i = 0; i < 60; i++) introduce(state, [`rhy/old${i}`], day(1));
    const steps = loadPiece('phrases/p1-first-steps.json');
    applyAttempt(state, steps, perfect(steps), day(1));
    for (const record of Object.values(state.skills)) {
      record.attempts = 1;
      record.card.due = day(2).toISOString();
    }
    const plan = planSession(state, context, day(30), 7);
    expect(plan.backlogged).toBe(true);
    expect(plan.dueCount).toBeGreaterThan(40);
    expect(kinds(plan.items)).not.toContain('lesson');
    // The freed time goes to reviews.
    expect(kinds(plan.items).filter((k) => k === 'review').length).toBeGreaterThan(5);
  });

  it('adds a side-by-side drill for a frequent confusion', () => {
    const state = emptyState();
    const steps = loadPiece('phrases/p1-first-steps.json');
    applyAttempt(state, steps, perfect(steps), day(1));
    state.confusions['65>64'] = 3; // F written, E played
    const plan = planSession(state, context, day(2), 7);
    const drill = plan.items.find(
      (i) => i.kind === 'exercise' && i.title.startsWith('Tell them apart'),
    );
    expect(drill).toMatchObject({ title: 'Tell them apart: F and E' });
    expect((drill as Extract<SessionItem, { kind: 'exercise' }>).spec.pair).toEqual(['F5', 'E5']);
  });
});

describe('simulated learners (spec section 10)', () => {
  const course = loadCourse();
  const chapter = course.chapters[0]!;
  const pieces = CONTENT_FILES.map((f) => loadPiece(f));

  /** Run daily sessions. Returns every generated exercise the learner was given. */
  function run(days: number, learner: (piece: Piece) => NoteResult[]) {
    const state: EngineState = emptyState();
    const done = new Set<string>();
    const given: Piece[] = [];
    const titles: string[] = [];
    let finishedOn = 0;
    for (let d = 1; d <= days; d++) {
      const now = day(d);
      const next = chapter.lessons.find((l) => !done.has(l.id));
      const plan = planSession(
        state,
        { nextLesson: next ? { id: next.id, title: next.title } : null, pieces },
        now,
        d * 1000,
      );
      for (const item of plan.items) {
        if (item.kind === 'exercise') {
          const piece = generatePiece(item.spec);
          given.push(piece);
          titles.push(item.title);
          const results = learner(piece);
          applyAttempt(state, piece, results, now);
          updateDials(state.dials, results.filter((r) => r.pitchCorrect).length / results.length);
        } else if (item.kind === 'lesson') {
          const lesson = chapter.lessons.find((l) => l.id === item.lessonId)!;
          const ids = new Set<string>();
          for (const step of lesson.steps) {
            if (!step.piece) continue;
            for (const id of skillsOfPiece(step.piece).keys()) ids.add(id);
            if (step.type === 'practice' || step.type === 'check') {
              applyAttempt(state, step.piece, learner(step.piece), now);
            }
          }
          introduce(state, [...ids], now);
          done.add(lesson.id);
          if (done.size === chapter.lessons.length && !finishedOn) finishedOn = d;
        } else {
          const piece = pieces.find((p) => p.id === item.pieceId)!;
          applyAttempt(state, piece, learner(piece), now, { includePiece: true });
        }
      }
    }
    return { state, given, titles, done, finishedOn };
  }

  const count = (given: Piece[], pitch: string) =>
    given.reduce(
      (n, p) =>
        n +
        p.bars.flat().filter((x) => x.pitch && `${x.pitch.letter}${x.pitch.octave}` === pitch)
          .length,
      0,
    );

  it('a learner who always plays G where F is written is given more F, and drills F against G', () => {
    // Chapter 1 has F on the 1st string (written F5), not F4, so that is the note missed.
    const missesF = (piece: Piece): NoteResult[] =>
      uniformResults(piece, 1).map((r) => {
        const pitch = piece.bars[r.barIndex]![r.noteIndex]!.pitch!;
        return pitch.letter === 'F' ? { ...r, pitchCorrect: false, timing: 1, heardMidi: 67 } : r;
      });
    const struggling = run(24, missesF);
    const control = run(24, perfect);
    const share = (r: ReturnType<typeof run>) => count(r.given, 'F5') / count(r.given, 'E5');
    // Compared with a learner who has no trouble, F comes up far more often relative to its neighbour.
    expect(share(struggling)).toBeGreaterThan(share(control) * 1.5);
    expect(count(struggling.given, 'F5')).toBeGreaterThan(count(control.given, 'F5'));
    expect(struggling.titles).toContain('Tell them apart: F and G');
    expect(control.titles.some((t) => t.startsWith('Tell them apart'))).toBe(false);
    // F is never mastered; the notes played right are.
    expect(struggling.state.skills['pos0/str1/F5']!.status).toBe('learning');
    expect(struggling.state.skills['pos0/str1/E5']!.status).toBe('mastered');
  });

  it('a perfect learner finishes the chapter and masters 80% of it within the set number of sessions', () => {
    const { state, done, finishedOn } = run(ENGINE.sessionsPerChapter, perfect);
    expect(done.size).toBe(chapter.lessons.length);
    expect(finishedOn).toBeLessThanOrEqual(chapter.lessons.length);
    const ids = new Set<string>();
    for (const lesson of chapter.lessons) {
      for (const step of lesson.steps) {
        if (step.piece) for (const id of skillsOfPiece(step.piece).keys()) ids.add(id);
      }
    }
    const mastered = [...ids].filter((id) => state.skills[id]?.status === 'mastered');
    expect(mastered.length / ids.size).toBeGreaterThanOrEqual(ENGINE.stageMasteredShare);
    // Tempo has been raised along the way.
    expect(state.dials.tempo).toBeGreaterThan(ENGINE.startTempo);
  });

  it('a learner who gets half the notes wrong masters next to nothing and is slowed down', () => {
    const { state } = run(10, (piece) => uniformResults(piece, 0.5));
    const records = Object.values(state.skills);
    expect(records.filter((r) => r.status === 'mastered').length / records.length).toBeLessThan(
      0.25,
    );
    expect(state.dials.tempo).toBeLessThan(ENGINE.startTempo);
  });
});
