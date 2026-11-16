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
  /**
   * Vertical layout of one system (unzoomed px). Heights are worked out from
   * the notes on each system, so a line with no ledger lines takes less room.
   */
  /** Room a stem needs beyond its notehead. */
  stemAllowance: 36,
  /** Room a notehead needs on the side without a stem. */
  noteheadAllowance: 8,
  /** Room for the circled string number above a note. */
  markerAllowance: 22,
  /** Room for the position label ("Open", "Pos. V") above everything else. */
  positionLabelAllowance: 14,
  positionLabelFontSize: 9,
  /** How far the clef reaches above the top line and (with its 8) below the bottom line. */
  clefAbove: 16,
  clefBelow: 26,
  /** Padding above and below the notation, and the gap between notation and tab. */
  systemPadding: 4,
  tabGap: 12,
  /** Room below the lowest tab line for fret numbers on string 6. */
  tabBelow: 9,
  /** Font for tab fret numbers, finger numbers and string numbers. */
  numberFont: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  tabNumberFontSize: 10,
  /** Size of the labels drawn under notes in lessons. */
  noteLabelFontSize: 9,
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
  /** Gap kept above the current system when the score scrolls to it (px). */
  scrollMargin: 12,
} as const;

export const COURSE = {
  /** Lesson-writing limits (spec section 2: short text, one idea per step). */
  maxWordsPerStep: 60,
  maxParagraphsPerStep: 3,
  maxLabelLength: 14,
  /** Longest inline score, in bars, for explain/example steps and for practice/check steps. */
  maxBarsExplain: 4,
  maxBarsPractice: 8,
  /** Tempo of a lesson exercise that does not set one (spec section 4: 60 BPM for new material). */
  defaultStepTempo: 60,
} as const;

export const METRONOME = {
  /** Bars of clicks before the first note in "Your turn". */
  countInBars: 1,
  /** Click levels in decibels: the first beat of each bar is louder. */
  accentDb: -6,
  beatDb: -14,
  /** Lowest frequency let through, so the click is high and unpitched (Hz). */
  highpassHz: 2500,
  /** Click length (seconds). */
  decaySeconds: 0.03,
} as const;

export const STORAGE_KEYS = {
  /** Lesson progress. Moves to IndexedDB in M4. */
  progress: 'malcotron.progress',
  /** Manual theme override. Moves to the IndexedDB settings store in M3. */
  theme: 'malcotron.theme',
} as const;
