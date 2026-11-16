/**
 * Loads the curriculum and every lesson from /content at build time. Content
 * is validated in CI, so a failure here is a bug.
 */
import curriculum from '../../content/curriculum.json';
import { rawPieces } from '../content/loader';
import { validateCourse } from './lessons';
import type { Course, Lesson } from './types';

const modules = import.meta.glob<unknown>('../../content/lessons/*.json', {
  eager: true,
  import: 'default',
});

let cache: Course | null = null;

export function loadCourse(): Course {
  if (!cache) {
    const files = Object.entries(modules).map(([path, raw]) => ({
      file: path.replace(/^.*\/content\//, ''),
      raw,
    }));
    const result = validateCourse(curriculum, files, rawPieces());
    if (!result.course) {
      throw new Error(`Course content is invalid: ${result.errors[0]?.message}`);
    }
    cache = result.course;
  }
  return cache;
}

export function getLesson(id: string): Lesson | undefined {
  return loadCourse().lessons.find((l) => l.id === id);
}

/** The lesson after this one in book order, if any. */
export function nextLesson(id: string): Lesson | undefined {
  const lessons = loadCourse().lessons;
  const index = lessons.findIndex((l) => l.id === id);
  return index >= 0 ? lessons[index + 1] : undefined;
}
