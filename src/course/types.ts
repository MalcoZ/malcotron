import type { FingeringLevel } from '../config';
import type { Piece, PitchStage, RhythmStage } from '../content/types';

export type StepType = 'explain' | 'example' | 'practice' | 'check';

/** A score written inside a lesson step (the piece format without the metadata). */
export interface InlineScore {
  key: string;
  time: string;
  position: number;
  bars: string[];
}

export interface NoteLabel {
  bar: number;
  note: number;
  text: string;
}

/** A lesson step exactly as stored in a lesson JSON file (spec section 7). */
export interface StepFile {
  type: StepType;
  title?: string;
  text: string[];
  /** An inline score, or... */
  score?: InlineScore;
  /** ...the id of a piece or phrase in /content. */
  piece?: string;
  /** Use only these bars of the score or piece: [first, last], counted from 1. */
  bars?: [number, number];
  labels?: 'names' | 'none' | NoteLabel[];
  showTab?: boolean;
  fingering?: FingeringLevel;
  tempo?: number;
}

export interface LessonFile {
  id: string;
  title: string;
  summary: string;
  requires: { pitchStage: PitchStage; rhythmStage: RhythmStage };
  /** What this lesson teaches for the first time (checked by the interleaving rule). */
  introduces?: Introduces;
  /** The first lessons must use a note and a rhythm before either can be taught. */
  bootstrap?: boolean;
  steps: StepFile[];
}

export interface Introduces {
  /** Written pitches, for example ["F5", "G5"] or ["F#4"]. */
  pitches?: string[];
  /** Rhythm values: q h w h. 8 q. 16, rests rq rh rw r8, and tie. */
  rhythms?: string[];
  /** Time signatures, for example ["3/4"]. */
  meters?: string[];
  /** Keys other than C, for example ["G"]. */
  keys?: string[];
}

export interface ChapterFile {
  id: string;
  title: string;
  summary: string;
  /** The stages this chapter covers, for example ["P1", "R1"]. */
  stages: string[];
  lessons: string[];
}

export interface CurriculumFile {
  chapters: ChapterFile[];
}

/** A validated step, with its score parsed and its labels resolved. */
export interface Step {
  readonly index: number;
  readonly type: StepType;
  readonly title: string | null;
  readonly text: readonly string[];
  /** null for a text-only step. */
  readonly piece: Piece | null;
  /** Label text by handleKey(barIndex, noteIndex). */
  readonly labels: ReadonlyMap<string, string>;
  readonly showTab: boolean;
  readonly fingering: FingeringLevel;
  readonly tempo: number;
}

export interface Lesson {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly requires: { readonly pitchStage: PitchStage; readonly rhythmStage: RhythmStage };
  readonly introduces: Required<Introduces>;
  readonly bootstrap: boolean;
  readonly steps: readonly Step[];
  readonly file: string;
}

export interface Chapter {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly stages: readonly string[];
  readonly lessons: readonly Lesson[];
}

export interface Course {
  readonly chapters: readonly Chapter[];
  /** Every lesson in book order. */
  readonly lessons: readonly Lesson[];
}
