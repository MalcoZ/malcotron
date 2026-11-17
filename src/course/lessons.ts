/**
 * Lesson and curriculum validation and parsing (spec section 7, M1 brief task 1).
 * Pure: the CLI in tools/ and the app's loader both use it.
 */
import { COURSE, TEMPO, type FingeringLevel } from '../config';
import { formatLocation, pitchToString, type ContentLocation, type Pitch } from '../content/music';
import { stageNumber } from '../content/stages';
import type { Piece, PieceFile } from '../content/types';
import { validatePiece, type Issue } from '../content/validate';
import { rhythmKinds } from '../engine/skills';
import type {
  Chapter,
  Course,
  CurriculumFile,
  Lesson,
  LessonFile,
  NoteLabel,
  Step,
  StepType,
} from './types';

const STEP_TYPES: readonly StepType[] = ['explain', 'example', 'practice', 'check'];
const FINGERING_LEVELS: readonly FingeringLevel[] = ['all', 'first-of-bar', 'none'];

function issue(detail: string, location: ContentLocation): Issue {
  const where = formatLocation(location);
  return { location, detail, message: where ? `${where}: ${detail}` : detail };
}

/** Words a learner reads: markup removed, split on spaces. */
export function countWords(paragraphs: readonly string[]): number {
  return paragraphs
    .join(' ')
    .replace(/\*\*/g, '')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Split text into plain and bold runs. `**bold**` is the only markup. */
export function parseInline(text: string): { text: string; bold: boolean }[] {
  return text
    .split('**')
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter((run) => run.text !== '');
}

/** Letter name as a learner reads it: F♯, B♭, C. */
export function noteName(pitch: Pick<Pitch, 'letter' | 'alter'>): string {
  return pitch.letter + (pitch.alter === 1 ? '♯' : pitch.alter === -1 ? '♭' : '');
}

export function labelKey(barIndex: number, noteIndex: number): string {
  return `${barIndex}:${noteIndex}`;
}

/** Take bars [first, last] (counted from 1) out of a piece file. */
function sliceBars(raw: PieceFile, range: [number, number] | undefined): PieceFile {
  if (!range) return raw;
  return { ...raw, bars: raw.bars.slice(range[0] - 1, range[1]) };
}

export interface LessonValidation {
  readonly errors: Issue[];
  readonly lesson?: Lesson;
}

/**
 * Validate one lesson file.
 * @param pieces  raw piece and phrase files by id, for steps that refer to one
 */
export function validateLesson(
  raw: unknown,
  file: string,
  pieces: ReadonlyMap<string, PieceFile>,
): LessonValidation {
  const errors: Issue[] = [];
  const err = (detail: string, step?: number) =>
    errors.push(issue(step === undefined ? detail : `step ${step + 1}: ${detail}`, { file }));

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    err('file must contain one JSON object');
    return { errors };
  }
  const data = raw as Partial<LessonFile>;
  for (const field of ['id', 'title', 'summary'] as const) {
    if (typeof data[field] !== 'string' || data[field].trim() === '') {
      err(`"${field}" is missing or is not text`);
    }
  }
  const base = file
    .split('/')
    .pop()
    ?.replace(/\.json$/, '');
  if (typeof data.id === 'string' && base !== data.id) {
    err(`"id" is "${data.id}" but the file is named "${base}.json"`);
  }
  const needPitch =
    typeof data.requires?.pitchStage === 'string'
      ? stageNumber(data.requires.pitchStage, 'P')
      : null;
  const needRhythm =
    typeof data.requires?.rhythmStage === 'string'
      ? stageNumber(data.requires.rhythmStage, 'R')
      : null;
  if (needPitch === null) err('"requires.pitchStage" must be a stage like "P1"');
  if (needRhythm === null) err('"requires.rhythmStage" must be a stage like "R1"');
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    err('"steps" must be a list of at least one step');
  }
  if (errors.length > 0) return { errors };
  const lessonFile = data as LessonFile;

  const steps: Step[] = [];
  let explained = false;
  for (const [i, step] of lessonFile.steps.entries()) {
    const before = errors.length;
    if (!STEP_TYPES.includes(step.type)) {
      err(`"type" must be one of ${STEP_TYPES.join(', ')}`, i);
      continue;
    }
    if (step.type === 'explain' || step.type === 'example') explained = true;
    else if (!explained) {
      err(`a ${step.type} step comes before any explain or example step`, i);
      explained = true; // report it once per lesson
    }

    // --- Text ---
    const text = step.text;
    if (
      !Array.isArray(text) ||
      text.length < 1 ||
      text.length > COURSE.maxParagraphsPerStep ||
      text.some((t) => typeof t !== 'string' || t.trim() === '')
    ) {
      err(`"text" must be 1 to ${COURSE.maxParagraphsPerStep} paragraphs`, i);
    } else {
      const words = countWords(text);
      if (words > COURSE.maxWordsPerStep) {
        err(`text is ${words} words; the limit is ${COURSE.maxWordsPerStep} (split the step)`, i);
      }
      if (text.some((t) => (t.match(/\*\*/g)?.length ?? 0) % 2 === 1)) {
        err('text has an unclosed ** (bold) marker', i);
      }
    }

    // --- Score ---
    let pieceRaw: PieceFile | null = null;
    if (step.score && step.piece) err('give either "score" or "piece", not both', i);
    else if (step.piece !== undefined) {
      const found = pieces.get(step.piece);
      if (!found) err(`piece "${step.piece}" does not exist in /content`, i);
      else pieceRaw = found;
    } else if (step.score) {
      pieceRaw = {
        id: `${lessonFile.id}-step-${i + 1}`,
        title: step.title ?? lessonFile.title,
        composer: 'Malcotron',
        source: `Exercise from the lesson "${lessonFile.title}"`,
        suggestedTempo: COURSE.defaultStepTempo,
        requires: lessonFile.requires,
        ...step.score,
      };
    } else if (step.type !== 'explain') {
      err(`a ${step.type} step needs a "score" or a "piece"`, i);
    }

    if (step.bars !== undefined && pieceRaw) {
      const [first, last] = Array.isArray(step.bars) ? step.bars : [NaN, NaN];
      const total = Array.isArray(pieceRaw.bars) ? pieceRaw.bars.length : 0;
      if (
        !Number.isInteger(first) ||
        !Number.isInteger(last) ||
        first < 1 ||
        last < first ||
        last > total
      ) {
        err(`"bars" must be [first, last] within 1 to ${total}`, i);
      } else {
        pieceRaw = { ...sliceBars(pieceRaw, step.bars), id: `${lessonFile.id}-step-${i + 1}` };
      }
    }

    let piece: Piece | null = null;
    if (pieceRaw && errors.length === before) {
      // A referenced piece keeps its own `requires`; the lesson's must cover it.
      const result = validatePiece(pieceRaw, `${pieceRaw.id}.json`);
      for (const e of result.errors) {
        const where = e.location.bar ? `bar ${e.location.bar}: ` : '';
        const token = e.location.token ? `"${e.location.token}": ` : '';
        err(`${where}${token}${e.detail}`, i);
      }
      piece = result.piece ?? null;
      if (result.computed) {
        const p = stageNumber(result.computed.pitchStage ?? '', 'P');
        const r = stageNumber(result.computed.rhythmStage ?? '', 'R');
        if (p !== null && p > needPitch!) {
          err(`the notes need P${p} but the lesson only requires P${needPitch}`, i);
        }
        if (r !== null && r > needRhythm!) {
          err(`the rhythms need R${r} but the lesson only requires R${needRhythm}`, i);
        }
      }
      if (piece && !step.piece) {
        const limit =
          step.type === 'explain' || step.type === 'example'
            ? COURSE.maxBarsExplain
            : COURSE.maxBarsPractice;
        if (piece.bars.length > limit) {
          err(`score has ${piece.bars.length} bars; a ${step.type} step may have ${limit}`, i);
        }
      }
    }

    // --- Labels ---
    const labels = new Map<string, string>();
    if (step.labels === 'names') {
      if (!piece && errors.length === before) err('"labels" needs a score', i);
      for (const note of piece?.bars.flat() ?? []) {
        if (note.pitch && !note.tiedFromPrevious) {
          labels.set(labelKey(note.barIndex, note.noteIndex), noteName(note.pitch));
        }
      }
    } else if (Array.isArray(step.labels)) {
      for (const label of step.labels as NoteLabel[]) {
        const exists = piece?.bars[label.bar - 1]?.[label.note - 1];
        if (typeof label.text !== 'string' || label.text.trim() === '') {
          err('a label has no text', i);
        } else if (label.text.length > COURSE.maxLabelLength) {
          err(`label "${label.text}" is longer than ${COURSE.maxLabelLength} characters`, i);
        } else if (piece && !exists) {
          err(
            `label "${label.text}" points at bar ${label.bar}, note ${label.note}, which does not exist`,
            i,
          );
        } else if (piece) {
          labels.set(labelKey(label.bar - 1, label.note - 1), label.text);
        }
      }
    } else if (step.labels !== undefined && step.labels !== 'none') {
      err('"labels" must be "names", "none" or a list of { bar, note, text }', i);
    }

    if (step.fingering !== undefined && !FINGERING_LEVELS.includes(step.fingering)) {
      err(`"fingering" must be one of ${FINGERING_LEVELS.join(', ')}`, i);
    }
    if (step.tempo !== undefined && !(step.tempo >= TEMPO.min && step.tempo <= TEMPO.max)) {
      err(`"tempo" must be from ${TEMPO.min} to ${TEMPO.max}`, i);
    }

    steps.push({
      index: i,
      type: step.type,
      title: step.title ?? null,
      text: Array.isArray(text) ? text : [],
      piece,
      labels,
      showTab: step.showTab ?? step.type === 'example',
      fingering: step.fingering ?? (step.type === 'check' ? 'first-of-bar' : 'all'),
      tempo: step.tempo ?? piece?.suggestedTempo ?? COURSE.defaultStepTempo,
    });
  }

  if (lessonFile.steps.at(-1)?.type !== 'check') err('the last step must be a check');
  if (errors.length > 0) return { errors };
  return {
    errors,
    lesson: {
      id: lessonFile.id,
      title: lessonFile.title,
      summary: lessonFile.summary,
      requires: { ...lessonFile.requires },
      introduces: {
        pitches: lessonFile.introduces?.pitches ?? [],
        rhythms: lessonFile.introduces?.rhythms ?? [],
        meters: lessonFile.introduces?.meters ?? [],
        keys: lessonFile.introduces?.keys ?? [],
      },
      bootstrap: lessonFile.bootstrap === true,
      steps,
      file,
    },
  };
}

export interface CourseValidation {
  readonly errors: Issue[];
  readonly course?: Course;
}

/**
 * Validate the curriculum and every lesson together.
 * @param lessonFiles  raw lesson files with their paths under /content
 */
export function validateCourse(
  curriculumRaw: unknown,
  lessonFiles: ReadonlyArray<{ file: string; raw: unknown }>,
  pieces: ReadonlyMap<string, PieceFile>,
): CourseValidation {
  const errors: Issue[] = [];
  const file = 'curriculum.json';
  const err = (detail: string) => errors.push(issue(detail, { file }));

  const lessons = new Map<string, Lesson>();
  for (const { file: lessonPath, raw } of lessonFiles) {
    const result = validateLesson(raw, lessonPath, pieces);
    errors.push(...result.errors);
    if (result.lesson) lessons.set(result.lesson.id, result.lesson);
  }

  const data = curriculumRaw as Partial<CurriculumFile> | null;
  if (!data || !Array.isArray(data.chapters) || data.chapters.length === 0) {
    err('"chapters" must be a list of at least one chapter');
    return { errors };
  }

  const listed = new Map<string, string>();
  const chapters: Chapter[] = [];
  for (const chapter of data.chapters) {
    const name = typeof chapter.id === 'string' ? `chapter "${chapter.id}"` : 'a chapter';
    for (const field of ['id', 'title', 'summary'] as const) {
      if (typeof chapter[field] !== 'string' || chapter[field].trim() === '') {
        err(`${name}: "${field}" is missing or is not text`);
      }
    }
    const stages = Array.isArray(chapter.stages) ? chapter.stages : [];
    const maxStage = (track: 'P' | 'R') =>
      Math.max(0, ...stages.map((s) => stageNumber(String(s), track) ?? 0));
    if (stages.length === 0) err(`${name}: "stages" must list at least one stage`);
    if (!Array.isArray(chapter.lessons) || chapter.lessons.length === 0) {
      err(`${name}: "lessons" must list at least one lesson`);
      continue;
    }
    const chapterLessons: Lesson[] = [];
    for (const id of chapter.lessons) {
      const earlier = listed.get(id);
      if (earlier) err(`lesson "${id}" is listed twice (in ${earlier} and ${name})`);
      listed.set(id, name);
      const lesson = lessons.get(id);
      if (!lesson) {
        if (!lessonFiles.some((l) => l.file.endsWith(`/${id}.json`))) {
          err(`${name} lists lesson "${id}", which has no file in /content/lessons`);
        }
        continue;
      }
      const p = stageNumber(lesson.requires.pitchStage, 'P')!;
      const r = stageNumber(lesson.requires.rhythmStage, 'R')!;
      if (p > maxStage('P') || r > maxStage('R')) {
        err(
          `lesson "${id}" requires ${lesson.requires.pitchStage} and ${lesson.requires.rhythmStage}, ` +
            `beyond ${name}'s stages (${stages.join(', ')})`,
        );
      }
      chapterLessons.push(lesson);
    }
    chapters.push({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      stages,
      lessons: chapterLessons,
    });
  }
  for (const id of lessons.keys()) {
    if (!listed.has(id)) err(`lesson "${id}" is not listed in any chapter`);
  }
  errors.push(...checkInterleaving(chapters.flatMap((c) => c.lessons)));

  if (errors.length > 0) return { errors };
  return { errors, course: { chapters, lessons: chapters.flatMap((c) => c.lessons) } };
}

/** What a lesson's scores actually use. */
function usedBy(lesson: Lesson) {
  const used = {
    pitches: new Set<string>(),
    rhythms: new Set<string>(),
    meters: new Set<string>(),
    keys: new Set<string>(),
  };
  for (const step of lesson.steps) {
    if (!step.piece) continue;
    used.meters.add(step.piece.time);
    if (step.piece.key !== 'C') used.keys.add(step.piece.key);
    for (const note of step.piece.bars.flat()) {
      for (const kind of rhythmKinds(note.token)) used.rhythms.add(kind);
      if (note.pitch) used.pitches.add(pitchToString(note.pitch));
    }
  }
  return used;
}

/**
 * The interleaving rule (spec section 3), over the lessons in book order:
 * nothing is used before it is taught; a lesson introduces pitches (or keys)
 * or rhythms (or meters), not both; and what it says it introduces, it uses.
 * Lessons marked `bootstrap` are exempt from the first two: the very first
 * exercise needs a note and a rhythm before either has been explained.
 */
export function checkInterleaving(lessons: readonly Lesson[]): Issue[] {
  const issues: Issue[] = [];
  const taught = {
    pitches: new Set<string>(),
    rhythms: new Set<string>(),
    meters: new Set<string>(),
    keys: new Set<string>(),
  };
  const kinds = ['pitches', 'rhythms', 'meters', 'keys'] as const;
  const noun = {
    pitches: 'the note',
    rhythms: 'the rhythm value',
    meters: 'the time signature',
    keys: 'the key of',
  };
  for (const lesson of lessons) {
    const err = (detail: string) => issues.push(issue(detail, { file: lesson.file }));
    const used = usedBy(lesson);
    const intro = lesson.introduces;
    const pitchSide = intro.pitches.length + intro.keys.length > 0;
    const rhythmSide = intro.rhythms.length + intro.meters.length > 0;
    if (pitchSide && rhythmSide && !lesson.bootstrap) {
      err('introduces both pitch material and rhythm material; a lesson teaches one new thing');
    }
    for (const kind of kinds) {
      for (const item of intro[kind]) {
        if (!used[kind].has(item))
          err(`says it introduces ${noun[kind]} ${item} but never uses it`);
        if (taught[kind].has(item))
          err(`says it introduces ${noun[kind]} ${item}, which an earlier lesson already taught`);
      }
      if (!lesson.bootstrap) {
        for (const item of used[kind]) {
          if (!taught[kind].has(item) && !intro[kind].includes(item)) {
            err(`uses ${noun[kind]} ${item} before any lesson has taught it`);
          }
        }
      }
      for (const item of intro[kind]) taught[kind].add(item);
    }
  }
  return issues;
}
