/**
 * Session builder (spec section 4): warm-up, reviews, the next lesson, and a
 * piece to apply it all, from the learner's state.
 */
import { ENGINE } from '../config';
import type { Piece } from '../content/types';
import { poolForKey, type ExerciseSpec } from './generator';
import { pitchOfSkill, skillKind, skillsOfPiece } from './skills';
import { dayOf, dueSkills, frequentConfusions, learningSkills, type EngineState } from './state';

export type SessionItem =
  | {
      kind: 'exercise';
      block: 'warm-up' | 'review';
      title: string;
      spec: ExerciseSpec;
      skills: string[];
    }
  | { kind: 'lesson'; block: 'new'; lessonId: string; title: string }
  | { kind: 'piece'; block: 'apply'; pieceId: string; title: string };

export interface SessionPlan {
  items: SessionItem[];
  /** Skills due for review when the session was planned. */
  dueCount: number;
  /** Reviews alone would take longer than the backlog limit, so new material was held back. */
  backlogged: boolean;
  minutes: number;
}

export interface SessionContext {
  /** The next lesson to do, if any is left. */
  nextLesson: { id: string; title: string } | null;
  /** Every piece and phrase, for the apply block. */
  pieces: readonly Piece[];
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Everything the learner has met, read off the skill records. */
function known(state: EngineState) {
  const ids = Object.entries(state.skills)
    .filter(([, r]) => r.status !== 'new')
    .map(([id]) => id);
  return {
    ids: new Set(ids),
    pitches: ids.map(pitchOfSkill).filter((p): p is string => p !== null),
    rhythms: ids.filter((id) => skillKind(id) === 'rhythm').map((id) => id.slice(4)),
    meters: ids
      .filter((id) => skillKind(id) === 'meter')
      .map((id) => id.slice(6).replace('-', '/')),
    keys: ids.filter((id) => skillKind(id) === 'key').map((id) => id.slice(4)),
  };
}

/** Turn a handful of skills to practise into an exercise spec. */
function specFor(
  state: EngineState,
  targets: readonly string[],
  seed: number,
  options: { title: string; bars?: number; tempo?: number; pair?: [string, string] },
): ExerciseSpec | null {
  const have = known(state);
  if (have.pitches.length === 0) return null;
  const wantedKey = targets.find((id) => skillKind(id) === 'key')?.slice(4);
  const accidentals = targets
    .filter((id) => skillKind(id) === 'accidental')
    .map((id) => id.split('/')[2]!);
  const key = wantedKey ?? 'C';
  const pool = poolForKey(have.pitches, key, [...accidentals, ...(options.pair ?? [])]);
  if (pool.length < 2) return null;
  const meter = targets
    .find((id) => skillKind(id) === 'meter')
    ?.slice(6)
    .replace('-', '/');
  const time =
    meter ?? (have.meters.includes('4/4') || have.meters.length === 0 ? '4/4' : have.meters[0]!);
  const rhythms = have.rhythms.length ? have.rhythms : ['q'];
  const focus = [
    ...targets.map(pitchOfSkill).filter((p): p is string => p !== null && pool.includes(p)),
    ...accidentals.filter((p) => pool.includes(p)),
  ];
  return {
    seed,
    key,
    time,
    bars: options.bars ?? ENGINE.lengths[state.dials.length] ?? 4,
    pool,
    focus,
    rhythms: rhythms.includes('q') ? rhythms : [...rhythms, 'q'],
    focusRhythms: targets.filter((id) => skillKind(id) === 'rhythm').map((id) => id.slice(4)),
    interval: state.dials.interval,
    pair: options.pair,
    tempo: options.tempo ?? state.dials.tempo,
    title: options.title,
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Written pitch names (in the learner's pool) for a sounding MIDI number. */
function writtenFor(soundingMidi: number, pool: readonly string[]): string | undefined {
  const written = soundingMidi + 12;
  const name = `${NAMES[written % 12]}${Math.floor(written / 12) - 1}`;
  return pool.includes(name) ? name : undefined;
}

/**
 * Plan a session.
 * @param seed makes the generated exercises repeatable
 */
export function planSession(
  state: EngineState,
  context: SessionContext,
  now: Date,
  seed: number,
): SessionPlan {
  const S = ENGINE.session;
  const have = known(state);
  const items: SessionItem[] = [];
  let nextSeed = seed;

  const due = dueSkills(state, now);
  const learning = learningSkills(state, now).filter((id) => !due.includes(id));
  const backlogMinutes =
    Math.ceil(due.length / ENGINE.skillsPerExercise) * ENGINE.minutesPerExercise;
  const backlogged = backlogMinutes > S.backlogMinutes;

  // --- Warm-up: material already mastered (or, early on, anything known), a little slower ---
  if (have.pitches.length >= 2) {
    const mastered = Object.entries(state.skills)
      .filter(([, r]) => r.status === 'mastered' || r.status === 'placed')
      .map(([id]) => id);
    const warm = (mastered.length ? mastered : [...have.ids]).slice(
      0,
      ENGINE.skillsPerExercise * 2,
    );
    for (const group of chunk(warm, ENGINE.skillsPerExercise).slice(
      0,
      Math.round(S.warmUp / ENGINE.minutesPerExercise),
    )) {
      const spec = specFor(state, group, nextSeed++, {
        title: 'Warm-up',
        bars: ENGINE.lengths[0],
        tempo: Math.max(ENGINE.minTempo, state.dials.tempo - ENGINE.tempoStep),
      });
      if (spec)
        items.push({ kind: 'exercise', block: 'warm-up', title: 'Warm-up', spec, skills: group });
    }
  }

  // --- Reviews: a confusion drill if one is needed, then due skills, then skills still being learned ---
  const reviewSlots = Math.round(
    (backlogged ? S.reviews + S.fresh - S.freshWhenBacklogged : S.reviews) /
      ENGINE.minutesPerExercise,
  );
  const reviews: SessionItem[] = [];
  const confusion = frequentConfusions(state)[0];
  if (confusion) {
    const a = writtenFor(confusion.written, have.pitches);
    const b = writtenFor(confusion.played, have.pitches);
    if (a && b) {
      const spec = specFor(state, [], nextSeed++, {
        title: `Tell them apart: ${a.replace(/\d/, '')} and ${b.replace(/\d/, '')}`,
        pair: [a, b],
      });
      if (spec) {
        spec.focus = [a, b];
        reviews.push({ kind: 'exercise', block: 'review', title: spec.title!, spec, skills: [] });
      }
    }
  }
  for (const group of chunk([...due, ...learning], ENGINE.skillsPerExercise)) {
    if (reviews.length >= reviewSlots) break;
    const spec = specFor(state, group, nextSeed++, { title: 'Review' });
    if (spec)
      reviews.push({ kind: 'exercise', block: 'review', title: 'Review', spec, skills: group });
  }
  items.push(...reviews);

  // --- New: the next lesson, unless reviews have piled up ---
  if (context.nextLesson && !backlogged) {
    items.push({
      kind: 'lesson',
      block: 'new',
      lessonId: context.nextLesson.id,
      title: context.nextLesson.title,
    });
  }

  // --- Apply: a piece whose every note and rhythm has been met, least recently played first ---
  const playable = context.pieces
    .filter((piece) => [...skillsOfPiece(piece).keys()].every((id) => have.ids.has(id)))
    .sort((a, b) => {
      const seen = (p: Piece) => state.skills[`piece/${p.id}`]?.lastSeen ?? '';
      return seen(a).localeCompare(seen(b));
    });
  const today = dayOf(now);
  const piece =
    playable.find((p) => !state.skills[`piece/${p.id}`]?.history.some((h) => h.day === today)) ??
    playable[0];
  if (piece) items.push({ kind: 'piece', block: 'apply', pieceId: piece.id, title: piece.title });

  const minutes = items.reduce(
    (sum, item) =>
      sum +
      (item.kind === 'exercise'
        ? ENGINE.minutesPerExercise
        : item.kind === 'lesson'
          ? ENGINE.minutesPerLesson
          : ENGINE.minutesPerPiece),
    0,
  );
  return { items, dueCount: due.length, backlogged, minutes };
}
