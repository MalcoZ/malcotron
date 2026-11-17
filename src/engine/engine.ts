/**
 * The engine as the app uses it: the learner's state plus saving it. Skill
 * data lives in localStorage until M4 moves everything to IndexedDB.
 */
import { ENGINE, STORAGE_KEYS } from '../config';
import type { Piece } from '../content/types';
import type { Lesson } from '../course/types';
import type { TakeGrade } from '../listen/grade';
import { planSession, type SessionContext, type SessionPlan } from './session';
import { skillsOfPiece, uniformResults, type NoteResult } from './skills';
import {
  applyAttempt,
  dayOf,
  emptyState,
  introduce,
  parseState,
  recordPeek,
  summarise,
  updateDials,
  type AttemptOptions,
  type EngineState,
  type SkillSummary,
} from './state';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Turn the mic's grade of a take into per-note results. */
export function resultsFromGrade(grade: TakeGrade): NoteResult[] {
  return grade.notes.map((g) => ({
    barIndex: g.expected.barIndex,
    noteIndex: g.expected.noteIndex,
    pitchCorrect: g.pitchCorrect,
    timing: g.status === 'green' ? 1 : g.status === 'amber' ? 0.5 : 0,
    heardMidi: g.reason === 'wrong' ? g.heardMidi : null,
  }));
}

export class Engine {
  state: EngineState;

  constructor(private readonly store: Store | null) {
    let text: string | null = null;
    try {
      text = store?.getItem(STORAGE_KEYS.engine) ?? null;
    } catch {
      // Storage blocked: the engine works for this visit only.
    }
    this.state = parseState(text);
  }

  /** Record a take graded by the mic. Returns the take's accuracy (share of right notes). */
  recordGrade(
    piece: Piece,
    grade: TakeGrade,
    options: AttemptOptions = {},
    now = new Date(),
  ): number {
    const results = resultsFromGrade(grade);
    return this.record(piece, results, options, now);
  }

  /** Record a take the learner judged themselves (no mic). */
  recordSelfCheck(
    piece: Piece,
    gotIt: boolean,
    options: AttemptOptions = {},
    now = new Date(),
  ): number {
    const accuracy = gotIt ? ENGINE.selfCheckGotIt : ENGINE.selfCheckAgain;
    return this.record(piece, uniformResults(piece, accuracy), options, now);
  }

  private record(piece: Piece, results: NoteResult[], options: AttemptOptions, now: Date): number {
    applyAttempt(this.state, piece, results, now, options);
    const accuracy = results.length
      ? results.filter((r) => r.pitchCorrect).length / results.length
      : 1;
    // Only scheduled work moves the difficulty dials.
    if (options.scheduled !== false) updateDials(this.state.dials, accuracy);
    this.save();
    return accuracy;
  }

  /** A lesson was finished: everything it uses is now being learned. */
  completeLesson(lesson: Lesson, now = new Date()): void {
    const ids = new Set<string>();
    for (const step of lesson.steps) {
      if (step.piece) for (const id of skillsOfPiece(step.piece).keys()) ids.add(id);
    }
    introduce(this.state, [...ids], now);
    this.save();
  }

  peek(piece: Piece, now = new Date()): void {
    recordPeek(this.state, piece, now);
    this.save();
  }

  plan(
    context: SessionContext,
    now = new Date(),
    seed = Math.floor(now.getTime() / 1000),
  ): SessionPlan {
    return planSession(this.state, context, now, seed);
  }

  finishSession(now = new Date()): void {
    const day = dayOf(now);
    if (!this.state.sessionDays.includes(day)) this.state.sessionDays.push(day);
    this.save();
  }

  summary(now = new Date()): SkillSummary {
    return summarise(this.state, now);
  }

  reset(): void {
    this.state = emptyState();
    try {
      this.store?.removeItem(STORAGE_KEYS.engine);
    } catch {
      // Nothing to remove.
    }
  }

  private save(): void {
    try {
      this.store?.setItem(STORAGE_KEYS.engine, JSON.stringify(this.state));
    } catch {
      // Storage full or blocked: keep going in memory.
    }
  }
}
