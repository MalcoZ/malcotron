import type { Fingering } from './fingering';
import type { AccidentalSymbol, Duration, Meter, NoteToken, Pitch } from './music';

export type PitchStage = `P${number}`;
export type RhythmStage = `R${number}`;

/** A piece or phrase exactly as stored in a /content JSON file (spec section 7). */
export interface PieceFile {
  id: string;
  title: string;
  composer: string;
  source: string;
  key: string;
  time: string;
  position: number;
  suggestedTempo: number;
  requires: { pitchStage: PitchStage; rhythmStage: RhythmStage };
  bars: string[];
}

/** One note or rest of a parsed piece, with everything the app derives for it. */
export interface PieceNote {
  readonly barIndex: number;
  readonly noteIndex: number;
  readonly token: NoteToken;
  /** null for a rest. */
  readonly pitch: Pitch | null;
  readonly duration: Duration;
  /** null for a rest. */
  readonly fingering: Fingering | null;
  /** Accidental to draw, after the key signature and earlier notes in the bar. */
  readonly accidental: AccidentalSymbol | null;
  readonly tieToNext: boolean;
  readonly tiedFromPrevious: boolean;
}

/** A validated, fully parsed piece. */
export interface Piece {
  readonly id: string;
  readonly title: string;
  readonly composer: string;
  readonly source: string;
  readonly key: string;
  readonly time: string;
  readonly meter: Meter;
  readonly position: number;
  readonly suggestedTempo: number;
  readonly requires: { readonly pitchStage: PitchStage; readonly rhythmStage: RhythmStage };
  readonly bars: ReadonlyArray<ReadonlyArray<PieceNote>>;
  /** Where the file lives under /content, for example "pieces/ode-to-joy.json". */
  readonly file: string;
}
