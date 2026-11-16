/**
 * Timeline: turns a piece into note events measured in beats (exact
 * fractions, one beat = one quarter note), independent of tempo.
 *
 * Playback, the playhead and (from M1) the metronome and mic grader all read
 * this one list, so they agree on where every note is.
 */
import { frac, fracAdd, wholeNotesToBeats, ZERO, type Fraction } from '../content/music';
import type { Piece } from '../content/types';

export interface NoteEvent {
  readonly barIndex: number;
  readonly noteIndex: number;
  /** Position of the event in the flat list. */
  readonly index: number;
  readonly startBeat: Fraction;
  /** Written length of this note or rest. */
  readonly durationBeats: Fraction;
  /** Sounding MIDI pitch (an octave below written); null for a rest. */
  readonly soundingMidi: number | null;
  readonly isRest: boolean;
  /** True when this note continues the previous one through a tie: it is not struck again. */
  readonly tiedFromPrevious: boolean;
  /**
   * How long the note sounds once struck: its own length plus every note tied
   * on after it. Zero for rests and for notes tied from the previous note.
   */
  readonly soundingBeats: Fraction;
}

export interface Timeline {
  readonly events: readonly NoteEvent[];
  readonly totalBeats: Fraction;
  /** Start beat of each bar. */
  readonly barStartBeats: readonly Fraction[];
  readonly beatsPerBar: Fraction;
  /** The time signature, for the metronome's pulse. */
  readonly meter: { readonly beats: number; readonly beatUnit: number };
}

export function buildTimeline(piece: Piece): Timeline {
  const beatsPerBar = wholeNotesToBeats(piece.meter.barLength);
  const drafts: (Omit<NoteEvent, 'soundingBeats'> & { tieToNext: boolean })[] = [];
  const barStartBeats: Fraction[] = [];

  for (const [barIndex, bar] of piece.bars.entries()) {
    // Bars are validated to be full, so each one starts on the bar grid.
    let beat = frac(beatsPerBar.n * barIndex, beatsPerBar.d);
    barStartBeats.push(beat);
    for (const note of bar) {
      const durationBeats = wholeNotesToBeats(note.duration.length);
      drafts.push({
        barIndex,
        noteIndex: note.noteIndex,
        index: drafts.length,
        startBeat: beat,
        durationBeats,
        soundingMidi: note.pitch ? note.pitch.soundingMidi : null,
        isRest: note.pitch === null,
        tiedFromPrevious: note.tiedFromPrevious,
        tieToNext: note.tieToNext,
      });
      beat = fracAdd(beat, durationBeats);
    }
  }

  const events: NoteEvent[] = drafts.map((draft, i) => {
    let soundingBeats = ZERO;
    if (!draft.isRest && !draft.tiedFromPrevious) {
      soundingBeats = draft.durationBeats;
      for (let j = i; drafts[j]!.tieToNext && drafts[j + 1]; j++) {
        soundingBeats = fracAdd(soundingBeats, drafts[j + 1]!.durationBeats);
      }
    }
    return {
      barIndex: draft.barIndex,
      noteIndex: draft.noteIndex,
      index: draft.index,
      startBeat: draft.startBeat,
      durationBeats: draft.durationBeats,
      soundingMidi: draft.soundingMidi,
      isRest: draft.isRest,
      tiedFromPrevious: draft.tiedFromPrevious,
      soundingBeats,
    };
  });

  return {
    events,
    totalBeats: frac(beatsPerBar.n * piece.bars.length, beatsPerBar.d),
    barStartBeats,
    beatsPerBar,
    meter: { beats: piece.meter.beats, beatUnit: piece.meter.beatUnit },
  };
}

/** The events that actually strike a string. */
export function soundingEvents(timeline: Timeline): NoteEvent[] {
  return timeline.events.filter((e) => !e.isRest && !e.tiedFromPrevious);
}

/**
 * Index of the event under a beat position, or -1 before the start or at/after
 * the end. Events are back to back, so this is a binary search on start beats.
 */
export function eventIndexAtBeat(
  starts: readonly number[],
  totalBeats: number,
  beat: number,
): number {
  if (beat < 0 || beat >= totalBeats || starts.length === 0) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= beat) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
