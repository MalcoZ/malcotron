import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../src/config';
import {
  emptyProgress,
  parseProgress,
  Progress,
  type KeyValueStore,
} from '../../src/course/progress';

function memoryStore(
  initial: Record<string, string> = {},
): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const LESSONS = ['a', 'b', 'c'];

describe('progress', () => {
  it('starts at the first lesson', () => {
    const progress = new Progress(memoryStore());
    expect(progress.next(LESSONS)).toEqual({ lesson: 'a', step: 0 });
    expect(progress.completedCount).toBe(0);
    expect(progress.isCompleted('a')).toBe(false);
  });

  it('continues at the step the learner was on', () => {
    const progress = new Progress(memoryStore());
    progress.visit('a', 2);
    expect(progress.next(LESSONS)).toEqual({ lesson: 'a', step: 2 });
  });

  it('moves on when a lesson is completed, and records the self-check', () => {
    const progress = new Progress(memoryStore());
    progress.visit('a', 4);
    progress.complete('a', 'got-it', new Date('2026-11-16T10:00:00Z'));
    expect(progress.isCompleted('a')).toBe(true);
    expect(progress.record('a')).toEqual({
      completedAt: '2026-11-16T10:00:00.000Z',
      selfCheck: 'got-it',
    });
    expect(progress.next(LESSONS)).toEqual({ lesson: 'b', step: 0 });
  });

  it('re-reading a finished lesson does not pull Continue back to it', () => {
    const progress = new Progress(memoryStore());
    progress.complete('a', null);
    progress.visit('a', 1);
    expect(progress.next(LESSONS)).toEqual({ lesson: 'b', step: 0 });
  });

  it('skips completed lessons in book order, whatever order they were done in', () => {
    const progress = new Progress(memoryStore());
    progress.complete('b', null);
    expect(progress.next(LESSONS)).toEqual({ lesson: 'a', step: 0 });
    progress.complete('a', null);
    expect(progress.next(LESSONS)).toEqual({ lesson: 'c', step: 0 });
    progress.complete('c', 'again');
    expect(progress.next(LESSONS)).toBeNull();
  });

  it('survives a reload (round trip through the store)', () => {
    const store = memoryStore();
    const first = new Progress(store);
    first.complete('a', 'again');
    first.visit('b', 3);
    const second = new Progress(store);
    expect(second.isCompleted('a')).toBe(true);
    expect(second.record('a')?.selfCheck).toBe('again');
    expect(second.next(LESSONS)).toEqual({ lesson: 'b', step: 3 });
    expect(JSON.parse(store.data.get(STORAGE_KEYS.progress)!).version).toBe(1);
  });

  it('reset forgets everything', () => {
    const store = memoryStore();
    const progress = new Progress(store);
    progress.complete('a', null);
    progress.reset();
    expect(progress.completedCount).toBe(0);
    expect(store.data.has(STORAGE_KEYS.progress)).toBe(false);
    expect(new Progress(store).next(LESSONS)).toEqual({ lesson: 'a', step: 0 });
  });

  it.each([
    ['nothing stored', null],
    ['not JSON', '{oops'],
    ['wrong shape', '[1,2,3]'],
    ['another version', JSON.stringify({ version: 2, completed: { a: {} }, current: null })],
    ['null', 'null'],
  ])('starts fresh from %s', (_what, text) => {
    expect(parseProgress(text)).toEqual(emptyProgress());
  });

  it('drops damaged entries and keeps the good ones', () => {
    const text = JSON.stringify({
      version: 1,
      completed: {
        a: { completedAt: '2026-11-16T10:00:00.000Z', selfCheck: 'got-it' },
        b: { selfCheck: 'got-it' },
        c: { completedAt: '2026-11-16T11:00:00.000Z', selfCheck: 'maybe' },
      },
      current: { lesson: 'b', step: -1 },
    });
    expect(parseProgress(text)).toEqual({
      version: 1,
      completed: {
        a: { completedAt: '2026-11-16T10:00:00.000Z', selfCheck: 'got-it' },
        c: { completedAt: '2026-11-16T11:00:00.000Z', selfCheck: null },
      },
      current: null,
    });
  });

  it('works with no storage at all, and with storage that throws', () => {
    const none = new Progress(null);
    none.complete('a', null);
    expect(none.isCompleted('a')).toBe(true);
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const progress = new Progress(broken);
    progress.visit('a', 1);
    progress.complete('a', 'got-it');
    progress.reset();
    expect(progress.next(LESSONS)).toEqual({ lesson: 'a', step: 0 });
  });
});
