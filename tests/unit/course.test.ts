import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COURSE } from '../../src/config';
import type { PieceFile } from '../../src/content/types';
import {
  countWords,
  noteName,
  parseInline,
  validateCourse,
  validateLesson,
} from '../../src/course/lessons';
import type { Course } from '../../src/course/types';
import { parsePitch } from '../../src/content/music';
import { parseRoute, routePath } from '../../src/ui/router';
import { readContent, readJson } from './helpers';

const contentDir = (dir: string) => fileURLToPath(new URL(`../../content/${dir}`, import.meta.url));

/** Every piece and phrase under /content, by id. */
const pieces = new Map<string, PieceFile>(
  ['pieces', 'phrases'].flatMap((dir) =>
    readdirSync(contentDir(dir))
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const raw = readContent(`${dir}/${name}`) as PieceFile;
        return [raw.id, raw] as const;
      }),
  ),
);

function lessonFiles(): { file: string; raw: unknown }[] {
  const dir = fileURLToPath(new URL('../../content/lessons', import.meta.url));
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ file: `lessons/${name}`, raw: readContent(`lessons/${name}`) }));
}

function loadCourse(): Course {
  const result = validateCourse(readContent('curriculum.json'), lessonFiles(), pieces);
  expect(result.errors.map((e) => e.message)).toEqual([]);
  return result.course!;
}

const messages = (issues: readonly { message: string }[]) => issues.map((i) => i.message);

describe('Chapter 1', () => {
  const full = loadCourse();
  // Chapter 1 on its own: the checks below were written for it.
  const course = { ...full, chapters: [full.chapters[0]!], lessons: full.chapters[0]!.lessons };

  it('is a chapter of about ten lessons, covering P1 and R1, and is followed by more chapters', () => {
    expect(full.chapters.length).toBeGreaterThan(1);
    expect(course.chapters[0]!.stages).toEqual(['P1', 'R1']);
    expect(course.lessons.length).toBeGreaterThanOrEqual(9);
    expect(course.lessons.length).toBeLessThanOrEqual(12);
    expect(course.lessons[0]!.id).toBe('p1-the-staff');
    expect(course.lessons.at(-1)!.id).toBe('piece-ode-to-joy');
  });

  it('every step is short, and every lesson explains before it asks and ends with a check', () => {
    for (const lesson of course.lessons) {
      expect(lesson.steps.at(-1)!.type, lesson.id).toBe('check');
      expect(['explain', 'example'], lesson.id).toContain(lesson.steps[0]!.type);
      for (const step of lesson.steps) {
        expect(countWords(step.text), `${lesson.id} step ${step.index + 1}`).toBeLessThanOrEqual(
          COURSE.maxWordsPerStep,
        );
        if (step.type !== 'explain') expect(step.piece, lesson.id).not.toBeNull();
      }
    }
  });

  it('no lesson uses a note before a lesson has taught it', () => {
    // The pitches each lesson may use: everything introduced so far (lesson 1 shows
    // four notes with tab as an illustration and teaches none).
    const introduces: Record<string, string[]> = {
      'p1-open-strings': ['G4', 'B4', 'E5'],
      'p1-string-1': ['F5', 'G5'],
      'p1-string-2': ['C5', 'D5'],
      'p1-string-3': ['A4'],
    };
    const known = new Set<string>();
    for (const lesson of course.lessons.slice(1)) {
      for (const pitch of introduces[lesson.id] ?? []) known.add(pitch);
      for (const step of lesson.steps) {
        for (const note of step.piece?.bars.flat() ?? []) {
          if (note.pitch) {
            expect(known, `${lesson.id} step ${step.index + 1}`).toContain(
              `${note.pitch.letter}${note.pitch.octave}`,
            );
          }
        }
      }
    }
    expect(known.size).toBe(8);
  });

  it('no lesson uses a rhythm before a lesson has taught it', () => {
    // Quarter notes are used informally in lesson 2 ("one note per click") and
    // explained in lesson 3; half and whole notes arrive in lesson 4, rests in lesson 8.
    const order = course.lessons.map((l) => l.id);
    const from = (id: string) => order.indexOf(id);
    for (const [i, lesson] of course.lessons.entries()) {
      for (const step of lesson.steps) {
        for (const note of step.piece?.bars.flat() ?? []) {
          const where = `${lesson.id} step ${step.index + 1}`;
          if (note.duration.base !== 'q' && i > 0) {
            expect(i, where).toBeGreaterThanOrEqual(from('r1-long-notes'));
          }
          if (note.pitch === null) expect(i, where).toBeGreaterThanOrEqual(from('r1-rests'));
        }
      }
    }
  });

  it('resolves labels and step defaults', () => {
    const open = course.lessons.find((l) => l.id === 'p1-open-strings')!;
    expect([...open.steps[0]!.labels.values()]).toEqual(['G', 'B', 'E', 'B']);
    expect(open.steps[1]!.labels.get('0:1')).toBe('middle line');
    expect(open.steps[0]!.showTab).toBe(true);
    expect(open.steps[2]!.showTab).toBe(false);
    expect(open.steps[2]!.fingering).toBe('all');
    expect(open.steps.at(-1)!.fingering).toBe('first-of-bar');
    expect(open.steps[2]!.tempo).toBe(60);
  });

  it('takes bars out of a piece for a step', () => {
    const ode = course.lessons.find((l) => l.id === 'piece-ode-to-joy')!;
    expect(ode.steps[0]!.piece).toBeNull();
    expect(ode.steps[2]!.piece!.bars).toHaveLength(4);
    expect(ode.steps[3]!.piece!.bars[3]!.map((n) => n.token.text)).toEqual([
      'D5/q',
      'C5/q',
      'C5/h',
    ]);
    expect(ode.steps[4]!.piece!.bars).toHaveLength(8);
    expect(ode.steps[4]!.tempo).toBe(66);
  });
});

describe('broken lesson fixtures are rejected with a useful message', () => {
  const check = (name: string) =>
    messages(
      validateLesson(readJson(`tests/fixtures/lessons/${name}.json`), `${name}.json`, pieces)
        .errors,
    );

  it('unknown piece', () => {
    expect(check('broken-unknown-piece')).toEqual([
      'broken-unknown-piece.json: step 2: piece "no-such-piece" does not exist in /content',
    ]);
  });
  it('stage too high', () => {
    expect(check('broken-stage-too-high')).toContain(
      'broken-stage-too-high.json: step 2: the rhythms need R3 but the lesson only requires R1',
    );
  });
  it('text too long', () => {
    expect(check('broken-text-too-long')).toEqual([
      'broken-text-too-long.json: step 1: text is 61 words; the limit is 60 (split the step)',
    ]);
  });
  it('practice before any explanation', () => {
    expect(check('broken-practice-first')).toEqual([
      'broken-practice-first.json: step 1: a practice step comes before any explain or example step',
    ]);
  });
  it('label on a missing note, and no check at the end', () => {
    expect(check('broken-bad-label')).toEqual([
      'broken-bad-label.json: step 1: label "here" points at bar 1, note 3, which does not exist',
      'broken-bad-label.json: the last step must be a check',
    ]);
  });
});

describe('lesson and curriculum rules', () => {
  const C = { key: 'C', time: '4/4', position: 0 };
  const explain = { type: 'explain', text: ['Why.'], score: { ...C, bars: ['B4/w'] } };
  const checkStep = { type: 'check', text: ['Play.'], score: { ...C, bars: ['B4/w'] } };
  const lesson = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
    id: 'test-lesson',
    title: 'Test',
    summary: 'Test.',
    requires: { pitchStage: 'P1', rhythmStage: 'R1' },
    // The synthetic lessons here teach nothing, so the interleaving rule is not what is being tested.
    bootstrap: true,
    steps,
    ...extra,
  });
  const run = (steps: unknown[], extra = {}) =>
    messages(validateLesson(lesson(steps, extra), 'lessons/test-lesson.json', pieces).errors);

  it('accepts a minimal lesson', () => {
    expect(run([explain, checkStep])).toEqual([]);
  });
  it('allows a text-only explain step, but not a text-only check', () => {
    expect(run([{ type: 'explain', text: ['Hello.'] }, checkStep])).toEqual([]);
    expect(run([explain, { type: 'check', text: ['Play.'] }])[0]).toMatch(
      /needs a "score" or a "piece"/,
    );
  });
  it('reports score errors with the step and bar', () => {
    const bad = { ...checkStep, score: { ...C, bars: ['B4/q B4/q'] } };
    expect(run([explain, bad])[0]).toMatch(
      /^lessons\/test-lesson\.json: step 2: bar 1: bar adds up to 1\/2/,
    );
  });
  it('limits the length of inline scores', () => {
    const long = { ...explain, score: { ...C, bars: Array(5).fill('B4/w') } };
    expect(run([long, checkStep])[0]).toMatch(/score has 5 bars; a explain step may have 4/);
    const nine = { ...checkStep, score: { ...C, bars: Array(9).fill('B4/w') } };
    expect(run([explain, nine])[0]).toMatch(/score has 9 bars/);
  });
  it('checks text, labels, fingering, tempo and bar ranges', () => {
    expect(run([{ ...explain, text: [] }, checkStep])[0]).toMatch(
      /"text" must be 1 to 3 paragraphs/,
    );
    expect(run([{ ...explain, text: ['An **unclosed marker.'] }, checkStep])[0]).toMatch(
      /unclosed/,
    );
    const label = { ...explain, labels: [{ bar: 1, note: 1, text: 'much too long a label' }] };
    expect(run([label, checkStep])[0]).toMatch(/longer than 14 characters/);
    expect(run([{ ...explain, fingering: 'some' }, checkStep])[0]).toMatch(/"fingering" must be/);
    expect(run([{ ...explain, tempo: 10 }, checkStep])[0]).toMatch(/"tempo" must be/);
    const range = { type: 'check', text: ['Play.'], piece: 'ode-to-joy', bars: [5, 9] };
    expect(run([explain, range])[0]).toMatch(/"bars" must be \[first, last\] within 1 to 8/);
    expect(run([explain, { ...checkStep, piece: 'ode-to-joy' }])[0]).toMatch(/not both/);
  });
  it('checks the file shape', () => {
    expect(run([explain, checkStep], { id: 'other' })[0]).toMatch(/file is named/);
    expect(run([])[0]).toMatch(/"steps" must be a list/);
    expect(run([explain, checkStep], { requires: {} })).toHaveLength(2);
  });

  const good = { file: 'lessons/test-lesson.json', raw: lesson([explain, checkStep]) };
  const curriculum = (lessons: string[], stages = ['P1', 'R1']) => ({
    chapters: [{ id: 'c1', title: 'One', summary: 'One.', stages, lessons }],
  });
  const course = (cur: unknown, files = [good]) =>
    messages(validateCourse(cur, files, pieces).errors);

  it('accepts a curriculum that lists every lesson once', () => {
    expect(course(curriculum(['test-lesson']))).toEqual([]);
  });
  it('rejects unlisted, missing and repeated lessons', () => {
    expect(course(curriculum(['other']))).toEqual([
      'curriculum.json: chapter "c1" lists lesson "other", which has no file in /content/lessons',
      'curriculum.json: lesson "test-lesson" is not listed in any chapter',
    ]);
    expect(course(curriculum(['test-lesson', 'test-lesson']))[0]).toMatch(/listed twice/);
    expect(course({ chapters: [] })[0]).toMatch(/"chapters" must be a list/);
  });
  it('rejects a lesson beyond its chapter', () => {
    const higher = {
      file: 'lessons/test-lesson.json',
      raw: lesson([explain, checkStep], { requires: { pitchStage: 'P2', rhythmStage: 'R1' } }),
    };
    expect(course(curriculum(['test-lesson']), [higher])[0]).toMatch(
      /requires P2 and R1, beyond chapter "c1"'s stages \(P1, R1\)/,
    );
  });
});

describe('text helpers', () => {
  it('counts words without markup or loose punctuation', () => {
    expect(countWords(['Press **Next** to carry on.'])).toBe(5);
    expect(countWords(['One two', 'three - four'])).toBe(4);
    expect(countWords(['Count **1 2 3 4** aloud.'])).toBe(6);
  });
  it('splits bold runs', () => {
    expect(parseInline('The **staff** has five lines.')).toEqual([
      { text: 'The ', bold: false },
      { text: 'staff', bold: true },
      { text: ' has five lines.', bold: false },
    ]);
    expect(parseInline('plain')).toEqual([{ text: 'plain', bold: false }]);
  });
  it('names notes the way a learner reads them', () => {
    expect(noteName(parsePitch('F#4'))).toBe('F♯');
    expect(noteName(parsePitch('Bb3'))).toBe('B♭');
    expect(noteName(parsePitch('C5'))).toBe('C');
  });
});

describe('routes', () => {
  it.each([
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/nowhere', { name: 'home' }],
    ['#/lesson/p1-open-strings/3', { name: 'lesson', id: 'p1-open-strings', step: 2 }],
    ['#/lesson/p1-open-strings', { name: 'lesson', id: 'p1-open-strings', step: 0 }],
    ['#/lesson/p1-open-strings/zero', { name: 'lesson', id: 'p1-open-strings', step: 0 }],
    ['#/lesson/p1-open-strings/done', { name: 'lesson-done', id: 'p1-open-strings' }],
    ['#/piece/ode-to-joy', { name: 'piece', id: 'ode-to-joy' }],
    ['#/piece', { name: 'home' }],
  ])('%j', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });
  it('round-trips', () => {
    for (const hash of ['#/', '#/lesson/a-b/3', '#/lesson/a-b/done', '#/piece/x']) {
      expect(`#${routePath(parseRoute(hash))}`).toBe(hash);
    }
  });
});
