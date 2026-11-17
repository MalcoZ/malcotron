/**
 * Skills: the small things the learner is learning (spec section 4). One
 * piece touches many skills at once; this module says which, and how well
 * each went in a graded take.
 */
import { isInKey, pitchToString, type NoteToken } from '../content/music';
import type { Piece, PieceNote } from '../content/types';

/** How one written note went. Rests have no result. */
export interface NoteResult {
  barIndex: number;
  noteIndex: number;
  pitchCorrect: boolean;
  /** 1 on time, 0.5 a little off, 0 a timing miss or not played. */
  timing: number;
  /** Sounding MIDI number played instead, when the pitch was wrong. */
  heardMidi: number | null;
}

export type SkillKind = 'pitch' | 'key' | 'accidental' | 'rhythm' | 'meter' | 'piece';

export function skillKind(id: string): SkillKind {
  if (id.startsWith('pos')) return 'pitch';
  if (id.startsWith('key/')) return 'key';
  if (id.startsWith('acc/')) return 'accidental';
  if (id.startsWith('rhy/')) return 'rhythm';
  if (id.startsWith('meter/')) return 'meter';
  return 'piece';
}

/** Skill id for a written pitch in a position: `pos0/str3/A4`. */
export function pitchSkill(position: number, string: number, pitch: string): string {
  return `pos${position}/str${string}/${pitch}`;
}

/** The written pitch at the end of a pitch skill id. */
export function pitchOfSkill(id: string): string | null {
  return skillKind(id) === 'pitch' ? (id.split('/')[2] ?? null) : null;
}

/** Rhythm value of a token: `q`, `h.`, `8`, or for rests `rq`, `rh`; a tie adds `tie`. */
export function rhythmKinds(token: Pick<NoteToken, 'pitch' | 'duration' | 'tieToNext'>): string[] {
  const value =
    token.duration.base + (token.duration.dotted ? '.' : '') + (token.duration.triplet ? 't' : '');
  const kinds = [token.pitch === null ? `r${value}` : value];
  if (token.tieToNext) kinds.push('tie');
  return kinds;
}

export function rhythmSkill(kind: string): string {
  return `rhy/${kind}`;
}

export function meterSkill(time: string): string {
  return `meter/${time.replace('/', '-')}`;
}

const key = (note: PieceNote) => `${note.barIndex}:${note.noteIndex}`;

/**
 * Every skill a piece touches, with the notes each is graded from
 * (as "bar:note" keys). Rhythm skills for rests are graded from the next
 * note played, since a rest itself makes no sound to time.
 */
export function skillsOfPiece(piece: Piece, includePiece = false): Map<string, string[]> {
  const skills = new Map<string, string[]>();
  const add = (id: string, note: string) => {
    const list = skills.get(id);
    if (list) list.push(note);
    else skills.set(id, [note]);
  };
  const notes = piece.bars.flat();
  const sounding = notes.filter((n) => n.pitch !== null && !n.tiedFromPrevious);
  for (const [i, note] of notes.entries()) {
    // The note whose attack shows whether this value was counted right.
    const judged =
      note.pitch !== null && !note.tiedFromPrevious
        ? note
        : notes.slice(i + 1).find((n) => n.pitch !== null && !n.tiedFromPrevious);
    if (judged) for (const kind of rhythmKinds(note.token)) add(rhythmSkill(kind), key(judged));
    if (note.pitch === null || note.tiedFromPrevious || !note.fingering) continue;
    add(pitchSkill(piece.position, note.fingering.string, pitchToString(note.pitch)), key(note));
    if (note.pitch.alter !== 0 && isInKey(note.pitch, piece.key))
      add(`key/${piece.key}`, key(note));
    if (!isInKey(note.pitch, piece.key)) {
      const sign = note.pitch.alter === 1 ? 'sharp' : note.pitch.alter === -1 ? 'flat' : 'natural';
      add(`acc/${sign}/${pitchToString(note.pitch)}`, key(note));
    }
  }
  for (const note of sounding) add(meterSkill(piece.time), key(note));
  if (includePiece) for (const note of sounding) add(`piece/${piece.id}`, key(note));
  return skills;
}

/**
 * Accuracy of each skill in one take, 0 to 1: pitch-like skills by right
 * notes, rhythm and meter by timing, a piece by right notes.
 */
export function skillAccuracies(
  skills: ReadonlyMap<string, readonly string[]>,
  results: readonly NoteResult[],
): Map<string, number> {
  const byNote = new Map(results.map((r) => [`${r.barIndex}:${r.noteIndex}`, r]));
  const out = new Map<string, number>();
  for (const [id, notes] of skills) {
    const kind = skillKind(id);
    let sum = 0;
    let count = 0;
    for (const note of notes) {
      const result = byNote.get(note);
      if (!result) continue;
      count++;
      sum += kind === 'rhythm' || kind === 'meter' ? result.timing : result.pitchCorrect ? 1 : 0;
    }
    if (count > 0) out.set(id, sum / count);
  }
  return out;
}

/** Results for a take in which every note went the same way (a self-check, or a simulation). */
export function uniformResults(piece: Piece, accuracy: number): NoteResult[] {
  const notes = piece.bars.flat().filter((n) => n.pitch !== null && !n.tiedFromPrevious);
  // Spread the misses evenly through the take.
  const wrong = Math.round(notes.length * (1 - accuracy));
  return notes.map((n, i) => {
    const miss =
      wrong > 0 &&
      Math.floor(((i + 1) * wrong) / notes.length) > Math.floor((i * wrong) / notes.length);
    return {
      barIndex: n.barIndex,
      noteIndex: n.noteIndex,
      pitchCorrect: !miss,
      timing: miss ? 0 : 1,
      heardMidi: null,
    };
  });
}
