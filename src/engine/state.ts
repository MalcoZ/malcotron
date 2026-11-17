/**
 * The learner's state: one record per skill, confusions and the difficulty
 * dials (spec section 4). Everything here is pure; `store.ts` saves it.
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';
import { ENGINE } from '../config';
import type { Piece } from '../content/types';
import { skillAccuracies, skillsOfPiece, type NoteResult } from './skills';

export type SkillStatus = 'new' | 'learning' | 'mastered' | 'placed';

export interface SkillRecord {
  status: SkillStatus;
  /** FSRS card, with dates as ISO strings. */
  card: StoredCard;
  attempts: number;
  /** Recent results, oldest first. */
  history: { day: string; accuracy: number }[];
  peeks: number;
  /** ISO date-time of the last attempt. */
  lastSeen: string | null;
}

export type StoredCard = Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string };

export interface Dials {
  tempo: number;
  /** Index into ENGINE.lengths. */
  length: number;
  /** 0 steps, 1 skips, 2 leaps. */
  interval: number;
  /** 0 every note, 1 first of bar, 2 hidden. */
  markers: number;
  /** Recent exercise accuracies, newest last, for stepping up and down. */
  recent: number[];
}

export interface EngineState {
  version: 1;
  skills: Record<string, SkillRecord>;
  /** Count of each wrong pitch played for a written pitch, keyed "written>played" (sounding names). */
  confusions: Record<string, number>;
  dials: Dials;
  /** Days on which a session was finished. */
  sessionDays: string[];
}

const scheduler = fsrs(
  generatorParameters({ request_retention: ENGINE.retention, enable_fuzz: false }),
);

export function emptyState(): EngineState {
  return {
    version: 1,
    skills: {},
    confusions: {},
    dials: { tempo: ENGINE.startTempo, length: 0, interval: 0, markers: 0, recent: [] },
    sessionDays: [],
  };
}

/** The calendar day of a moment, in the learner's own time zone: "2026-11-17". */
export function dayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function storeCard(card: Card): StoredCard {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() };
}

function loadCard(card: StoredCard): Card {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

function newRecord(now: Date): SkillRecord {
  return {
    status: 'new',
    card: storeCard(createEmptyCard(now)),
    attempts: 0,
    history: [],
    peeks: 0,
    lastSeen: null,
  };
}

/** Accuracy to FSRS rating (spec section 4). */
export function ratingFor(accuracy: number, firstTry: boolean): Grade {
  if (accuracy < ENGINE.again) return Rating.Again;
  if (accuracy < ENGINE.good || !firstTry) return Rating.Hard;
  return accuracy >= 1 ? Rating.Easy : Rating.Good;
}

/**
 * Mastered when the skill has gone well (90% or better) in at least three
 * sessions on three different days (spec section 2). The best result of each
 * day counts.
 */
export function isMastered(history: SkillRecord['history']): boolean {
  const goodDays = new Set(
    history.filter((h) => h.accuracy >= ENGINE.masteryAccuracy).map((h) => h.day),
  );
  return goodDays.size >= ENGINE.masterySessions;
}

export interface AttemptOptions {
  /** False for a retry of the same exercise: it can earn Hard at best. */
  firstTry?: boolean;
  /** False for free practice: stats are updated but the review schedule is not. */
  scheduled?: boolean;
  /** Also track the piece itself as a skill. */
  includePiece?: boolean;
}

/** Record one graded take. Returns the accuracy of each skill it touched. */
export function applyAttempt(
  state: EngineState,
  piece: Piece,
  results: readonly NoteResult[],
  now: Date,
  options: AttemptOptions = {},
): Map<string, number> {
  const { firstTry = true, scheduled = true, includePiece = false } = options;
  const accuracies = skillAccuracies(skillsOfPiece(piece, includePiece), results);
  const day = dayOf(now);
  for (const [id, accuracy] of accuracies) {
    const record = (state.skills[id] ??= newRecord(now));
    record.attempts++;
    record.lastSeen = now.toISOString();
    record.history.push({ day, accuracy });
    if (record.history.length > ENGINE.historyLength) record.history.shift();
    if (scheduled) {
      const rating = ratingFor(accuracy, firstTry);
      record.card = storeCard(scheduler.next(loadCard(record.card), now, rating).card);
      // A failed review sends a mastered (or placed) skill back to learning.
      if (rating === Rating.Again && record.status !== 'new') {
        record.status = 'learning';
        // Mastery has to be earned again from here.
        record.history = [{ day, accuracy }];
      }
    }
    if (record.status === 'new') record.status = 'learning';
    if (record.status === 'learning' && isMastered(record.history)) record.status = 'mastered';
  }
  // Which wrong pitch was played for which written pitch.
  for (const result of results) {
    if (result.pitchCorrect || result.heardMidi === null) continue;
    const written = piece.bars[result.barIndex]?.[result.noteIndex]?.pitch;
    if (!written) continue;
    const pair = `${written.soundingMidi}>${result.heardMidi}`;
    state.confusions[pair] = (state.confusions[pair] ?? 0) + 1;
  }
  return accuracies;
}

/** Mark skills as being learned (a lesson that introduces them was finished). */
export function introduce(state: EngineState, skillIds: readonly string[], now: Date): void {
  for (const id of skillIds) {
    const record = (state.skills[id] ??= newRecord(now));
    if (record.status === 'new') record.status = 'learning';
  }
}

/** Log a peek at the tab against the skills on the page (a private signal, never a penalty). */
export function recordPeek(state: EngineState, piece: Piece, now: Date): void {
  for (const id of skillsOfPiece(piece).keys()) {
    (state.skills[id] ??= newRecord(now)).peeks++;
  }
}

/** Skills whose review is due at `now`, most overdue first. */
export function dueSkills(state: EngineState, now: Date): string[] {
  return Object.entries(state.skills)
    .filter(([, r]) => r.status !== 'new' && r.attempts > 0 && new Date(r.card.due) <= now)
    .sort((a, b) => a[1].card.due.localeCompare(b[1].card.due))
    .map(([id]) => id);
}

/** Skills still being learned that have not gone well today, least recently practised first. */
export function learningSkills(state: EngineState, now: Date): string[] {
  const today = dayOf(now);
  return Object.entries(state.skills)
    .filter(
      ([, r]) =>
        r.status === 'learning' &&
        !r.history.some((h) => h.day === today && h.accuracy >= ENGINE.masteryAccuracy),
    )
    .sort((a, b) => (a[1].lastSeen ?? '').localeCompare(b[1].lastSeen ?? ''))
    .map(([id]) => id);
}

/** Wrong-note pairs seen often enough to drill, most frequent first, as sounding MIDI numbers. */
export function frequentConfusions(
  state: EngineState,
): { written: number; played: number; count: number }[] {
  return Object.entries(state.confusions)
    .filter(([, count]) => count >= ENGINE.confusionDrillAfter)
    .map(([pair, count]) => {
      const [written, played] = pair.split('>').map(Number);
      return { written: written!, played: played!, count };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Move the difficulty dials after an exercise (spec section 4): up after three
 * in a row above 95%, down after two in a row below 70%. The dials move in
 * order: tempo, length, interval size, markers.
 */
export function updateDials(dials: Dials, accuracy: number): 'up' | 'down' | null {
  dials.recent.push(accuracy);
  if (dials.recent.length > ENGINE.upAfter) dials.recent.shift();
  const last = (n: number) => dials.recent.slice(-n);
  const up =
    dials.recent.length >= ENGINE.upAfter &&
    last(ENGINE.upAfter).every((a) => a > ENGINE.upAccuracy);
  const down =
    dials.recent.length >= ENGINE.downAfter &&
    last(ENGINE.downAfter).every((a) => a < ENGINE.downAccuracy);
  if (!up && !down) return null;
  dials.recent = [];
  if (up) {
    if (
      dials.tempo + ENGINE.tempoStep <= ENGINE.maxTempo &&
      dials.tempo < ENGINE.startTempo + 2 * ENGINE.tempoStep
    ) {
      dials.tempo += ENGINE.tempoStep;
    } else if (dials.length < ENGINE.lengths.length - 1) dials.length++;
    else if (dials.interval < 2) dials.interval++;
    else if (dials.markers < 2) dials.markers++;
    else dials.tempo = Math.min(ENGINE.maxTempo, dials.tempo + ENGINE.tempoStep);
    return 'up';
  }
  if (dials.tempo - ENGINE.tempoStep >= ENGINE.minTempo) dials.tempo -= ENGINE.tempoStep;
  else if (dials.length > 0) dials.length--;
  else if (dials.interval > 0) dials.interval--;
  else if (dials.markers > 0) dials.markers--;
  return 'down';
}

export interface SkillSummary {
  learning: number;
  mastered: number;
  due: number;
}

export function summarise(state: EngineState, now: Date): SkillSummary {
  const records = Object.values(state.skills);
  return {
    learning: records.filter((r) => r.status === 'learning').length,
    mastered: records.filter((r) => r.status === 'mastered' || r.status === 'placed').length,
    due: dueSkills(state, now).length,
  };
}

/** Read saved state; anything missing, damaged or from another version starts fresh. */
export function parseState(text: string | null): EngineState {
  if (!text) return emptyState();
  try {
    const data = JSON.parse(text) as Partial<EngineState> | null;
    if (!data || data.version !== 1 || typeof data.skills !== 'object' || !data.skills)
      return emptyState();
    const base = emptyState();
    const skills: Record<string, SkillRecord> = {};
    for (const [id, r] of Object.entries(data.skills)) {
      if (!r || typeof r.card?.due !== 'string' || !Array.isArray(r.history)) continue;
      if (Number.isNaN(new Date(r.card.due).getTime())) continue;
      skills[id] = {
        status: ['new', 'learning', 'mastered', 'placed'].includes(r.status)
          ? r.status
          : 'learning',
        card: r.card,
        attempts: Number(r.attempts) || 0,
        history: r.history.filter(
          (h) => typeof h?.day === 'string' && typeof h.accuracy === 'number',
        ),
        peeks: Number(r.peeks) || 0,
        lastSeen: typeof r.lastSeen === 'string' ? r.lastSeen : null,
      };
    }
    return {
      version: 1,
      skills,
      confusions: typeof data.confusions === 'object' && data.confusions ? data.confusions : {},
      dials: { ...base.dials, ...(typeof data.dials === 'object' ? data.dials : {}) },
      sessionDays: Array.isArray(data.sessionDays)
        ? data.sessionDays.filter((d) => typeof d === 'string')
        : [],
    };
  } catch {
    return emptyState();
  }
}
