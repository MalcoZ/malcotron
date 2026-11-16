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
  subDb: -24,
  /** Lowest frequency let through, so the click is high and unpitched (Hz). */
  highpassHz: 2500,
  /** Click length (seconds). */
  decaySeconds: 0.03,
} as const;

export const LISTEN = {
  /** Analysis frame and hop, in samples (spec section 5). */
  frameSize: 2048,
  hopSize: 512,
  /** Sounding range the detector looks in (Hz). */
  minHz: 75,
  maxHz: 1400,
  /** Frames less clear than this have no pitch (0 to 1). */
  clarityThreshold: 0.9,
  /** A later peak must reach this share of the best one to be taken as the pitch. */
  peakPickRatio: 0.9,
  /** The mic signal is low-passed here so the metronome click cannot be heard as a note (Hz). */
  lowpassHz: 1800,
  highpassHz: 60,
  /** Default noise gate (RMS, 0 to 1) until the mic check measures the room. */
  defaultNoiseGate: 0.01,
  /** The gate is set this many times above the measured room noise. */
  gateOverNoise: 4,
  /** A jump in level by this factor, against the level ~35 ms earlier, is a new attack. */
  onsetRatio: 1.7,
  onsetLookbackFrames: 3,
  /** Attacks closer together than this are one note (ms). */
  minNoteGapMs: 70,
  /** A pitch change of this many semitones, held this long, is a new note (legato). */
  pitchChangeSemitones: 0.8,
  pitchChangeMs: 40,
  /** A note ends after this long below the gate or without a clear pitch (ms). */
  releaseMs: 90,
  /** Notes shorter than this are dropped as noise (ms). */
  minNoteMs: 50,
  /** Pitch match tolerance after tuning offset (cents). */
  pitchCents: 50,
  /** Timing tolerances (ms): early stages, and from P6/R5 on. */
  early: { greenMs: 120, amberMs: 250 },
  later: { greenMs: 70, amberMs: 150 },
  laterFromPitchStage: 6,
  laterFromRhythmStage: 5,
  /** Count an exact octave error as correct when the detector was unsure (spec section 5). */
  forgiveOctave: true,
  octaveMaxClarity: 0.95,
  /** Alignment scores: matching pitch, wrong pitch, a missed note, an extra note. */
  align: { match: 2, mismatch: -1, missed: -1, extra: -0.6, perBeatOff: 1.5, maxTimePenalty: 2 },
  /** Live colouring pairs a heard note with a written one this close in time (beats). */
  liveWindowBeats: 0.6,
  /** Clicks in the latency calibration. */
  calibrationClicks: 8,
  calibrationBpm: 80,
} as const;

export const TONES = [
  { id: 'nylon', label: 'Nylon classical' },
  { id: 'steel', label: 'Steel acoustic' },
  { id: 'clean', label: 'Clean electric' },
  { id: 'jazz', label: 'Jazz electric' },
] as const;
export type ToneId = (typeof TONES)[number]['id'];

export const STORAGE_KEYS = {
  /** Mic calibration for this browser and device (never exported). */
  calibration: 'malcotron.calibration',
  /** Tone and other preferences. Moves to IndexedDB in M4. */
  settings: 'malcotron.settings',
  /** Lesson progress. Moves to IndexedDB in M4. */
  progress: 'malcotron.progress',
  /** Manual theme override. Moves to the IndexedDB settings store in M3. */
  theme: 'malcotron.theme',
} as const;
