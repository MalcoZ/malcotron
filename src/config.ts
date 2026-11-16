/**
 * Every tunable value used so far, in one place (spec section 1: "keep it in
 * one config file so it can be tuned").
 */

export type FingeringLevel = 'all' | 'first-of-bar' | 'none';

export const FINGERING = {
  /** Highest fret the fingering function and override check will accept. */
  maxFret: 19,
  /** Highest position number content may declare. */
  maxPosition: 16,
  /** Open position covers frets 0 to this fret. */
  openPositionMaxFret: 4,
  /** Home frets in position N are N to N + homeSpan - 1; stretches sit one fret outside. */
  homeSpan: 4,
  /** Marker display levels, in fading order (spec section 2). */
  levels: ['all', 'first-of-bar', 'none'] as readonly FingeringLevel[],
  defaultLevel: 'all' as FingeringLevel,
} as const;

export const TEMPO = {
  /** Quarter-note BPM range of the tempo slider (spec section 6). */
  min: 30,
  max: 220,
  /** Used when a piece has no suggested tempo; new material starts here (spec section 4). */
  default: 60,
} as const;

export const LAYOUT = {
  /** Staff zoom range and default, as a scale factor (spec section 8: 80% to 160%). */
  zoomMin: 0.8,
  zoomMax: 1.6,
  zoomStep: 0.2,
  zoomDefault: 1.2,
  /** Below this window width the "best on a larger screen" note is shown (px). */
  minSupportedWidth: 1024,
  /** Wait this long after the last resize event before redrawing (ms). */
  resizeDebounceMs: 150,
  /** Space left and right of the staves inside the score area (unzoomed px). */
  systemMarginX: 12,
  /** Narrowest bar the layout will produce before starting a new system (unzoomed px). */
  minBarWidth: 110,
  /** Extra room added to the tightest possible spacing of a bar's notes (unzoomed px). */
  barPadding: 46,
  /** Widest a bar may be stretched to fill a system (unzoomed px). */
  maxBarWidth: 420,
  /** Most bars allowed on one system. */
  maxBarsPerSystem: 4,
  /** Vertical layout of one system (unzoomed px). */
  notationTop: 46,
  notationHeightNoTab: 172,
  tabTop: 152,
  systemHeightWithTab: 284,
  /** Position label size and offset above the top staff line (unzoomed px). */
  positionLabelFontSize: 9,
  positionLabelRise: 34,
  /** Breathing room between a barline (or signature) and the first note (unzoomed px). */
  noteStartPadding: 8,
} as const;

export const PLAYBACK = {
  /** Sounding range of the bundled samples, as MIDI numbers: E2 to B5. */
  sampleMidiMin: 40,
  sampleMidiMax: 83,
  /** Sampler release time after a note's written length ends (seconds). */
  releaseSeconds: 0.4,
  /** Melody level (decibels). */
  melodyVolumeDb: -4,
  /** Size of the sounding note while highlighted (spec section 8: about 1.08x). */
  highlightScale: 1.08,
  /** How far above the bottom/top edge the current system is kept when scrolling (px). */
  scrollMargin: 24,
} as const;

export const STORAGE_KEYS = {
  /** Manual theme override. Moves to the IndexedDB settings store in M3. */
  theme: 'malcotron.theme',
} as const;
