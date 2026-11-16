/**
 * Lesson progress, kept in the browser. M1 uses localStorage behind this
 * small versioned interface; M4 moves it to IndexedDB with a migration.
 */
import { STORAGE_KEYS } from '../config';

export type SelfCheck = 'got-it' | 'again';

export interface LessonRecord {
  /** When the lesson was completed (ISO date-time). */
  completedAt: string;
  /** The learner's answer on the check step, if they gave one. */
  selfCheck: SelfCheck | null;
}

export interface ProgressData {
  version: 1;
  completed: Record<string, LessonRecord>;
  /** Where the learner last was. */
  current: { lesson: string; step: number } | null;
}

/** The part of Storage this module needs, so tests can pass a stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function emptyProgress(): ProgressData {
  return { version: 1, completed: {}, current: null };
}

/** Read stored progress, returning a fresh start for anything missing, corrupt or from another version. */
export function parseProgress(text: string | null): ProgressData {
  if (!text) return emptyProgress();
  try {
    const data = JSON.parse(text) as Partial<ProgressData> | null;
    if (!data || data.version !== 1 || typeof data.completed !== 'object' || !data.completed) {
      return emptyProgress();
    }
    const completed: Record<string, LessonRecord> = {};
    for (const [id, record] of Object.entries(data.completed)) {
      if (record && typeof record.completedAt === 'string') {
        completed[id] = {
          completedAt: record.completedAt,
          selfCheck:
            record.selfCheck === 'got-it' || record.selfCheck === 'again' ? record.selfCheck : null,
        };
      }
    }
    const current =
      data.current &&
      typeof data.current.lesson === 'string' &&
      Number.isInteger(data.current.step) &&
      data.current.step >= 0
        ? { lesson: data.current.lesson, step: data.current.step }
        : null;
    return { version: 1, completed, current };
  } catch {
    return emptyProgress();
  }
}

export class Progress {
  private data: ProgressData;
  private readonly store: KeyValueStore | null;

  constructor(store: KeyValueStore | null) {
    this.store = store;
    let text: string | null = null;
    try {
      text = store?.getItem(STORAGE_KEYS.progress) ?? null;
    } catch {
      // Storage blocked: progress lasts for this visit only.
    }
    this.data = parseProgress(text);
  }

  isCompleted(lessonId: string): boolean {
    return lessonId in this.data.completed;
  }

  record(lessonId: string): LessonRecord | undefined {
    return this.data.completed[lessonId];
  }

  get completedCount(): number {
    return Object.keys(this.data.completed).length;
  }

  get current(): { lesson: string; step: number } | null {
    return this.data.current;
  }

  /** Remember where the learner is. */
  visit(lessonId: string, step: number): void {
    this.data.current = { lesson: lessonId, step };
    this.save();
  }

  complete(lessonId: string, selfCheck: SelfCheck | null, now: Date = new Date()): void {
    this.data.completed[lessonId] = { completedAt: now.toISOString(), selfCheck };
    this.data.current = null;
    this.save();
  }

  /**
   * The lesson to continue with: the one in progress, else the first not yet
   * completed, in book order. Null when the whole course is done.
   */
  next(lessonIds: readonly string[]): { lesson: string; step: number } | null {
    const current = this.data.current;
    if (current && lessonIds.includes(current.lesson) && !this.isCompleted(current.lesson)) {
      return current;
    }
    const first = lessonIds.find((id) => !this.isCompleted(id));
    return first ? { lesson: first, step: 0 } : null;
  }

  reset(): void {
    this.data = emptyProgress();
    try {
      this.store?.removeItem(STORAGE_KEYS.progress);
    } catch {
      // Nothing to remove.
    }
  }

  private save(): void {
    try {
      this.store?.setItem(STORAGE_KEYS.progress, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: keep going with in-memory progress.
    }
  }
}
