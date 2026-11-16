import type { Player } from '../audio/player';
import type { Piece } from '../content/types';
import type { Progress } from '../course/progress';
import type { Course } from '../course/types';
import type { CalibrationStore } from '../listen/calibration';
import type { MicInput } from '../listen/mic';
import type { ScorePanel } from './score-panel';
import type { ThemeController } from './theme';

/** What every screen is given. */
export interface AppContext {
  readonly theme: ThemeController;
  readonly player: Player;
  /** Resolves when the current guitar tone's samples have loaded. */
  soundReady: Promise<void>;
  readonly course: Course;
  readonly pieces: readonly Piece[];
  readonly progress: Progress;
  readonly mic: MicInput;
  readonly calibration: CalibrationStore;
  /** Staff zoom, shared by all screens (dev control in the header). */
  zoom: number;
  /** Go to a route such as "/lesson/p1-open-strings/2". */
  navigate(path: string): void;
}

/** One screen. The shell puts `el` in the scrolling area and `bottomEl` in the fixed bar under it. */
export interface View {
  readonly el: HTMLElement;
  readonly bottomEl: HTMLElement | null;
  /** The score on this screen, if it has one. */
  readonly panel?: ScorePanel | null;
  /** Handle a key press; return true if it was used. */
  handleKey?(event: KeyboardEvent): boolean;
  /** Redraw the score (zoom changed). */
  redraw?(): void;
  /** Stop audio and release listeners. */
  destroy(): void;
}
