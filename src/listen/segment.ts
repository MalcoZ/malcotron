/**
 * Note segmentation: frames in, notes out (spec section 5, step 3). A new note
 * starts on an attack (the level jumps) or when a steady pitch changes by
 * about a semitone for more than 40 ms (slurs).
 */
import { LISTEN } from '../config';
import type { Frame } from './frames';

export interface PlayedNote {
  /** When the note started, in the frames' time base (seconds). */
  onset: number;
  /** Seconds. Zero while the note is still sounding. */
  duration: number;
  /** Sounding pitch, fractional MIDI (median over the note). */
  midi: number;
  /** Mean clarity of the frames that gave the pitch, 0 to 1. */
  clarity: number;
}

export interface SegmentEvents {
  /** A note has started and its pitch is known. Reported once per note. */
  started: PlayedNote[];
  /** Notes that have ended, with their final pitch and length. */
  ended: PlayedNote[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface OpenNote {
  onset: number;
  pitches: number[];
  clarities: number[];
  reported: boolean;
  lastVoiced: number;
  /** Frames in a row whose pitch differs from the note's. */
  off: { since: number; pitches: number[]; clarities: number[] } | null;
}

export class Segmenter {
  private note: OpenNote | null = null;
  private levels: number[] = [];
  private lastOnset = -Infinity;
  /** An attack was heard but no clear pitch has arrived yet. */
  private pendingOnset: number | null = null;

  constructor(private noiseGate: number = LISTEN.defaultNoiseGate) {}

  setNoiseGate(gate: number): void {
    this.noiseGate = gate;
  }

  push(frame: Frame): SegmentEvents {
    const events: SegmentEvents = { started: [], ended: [] };
    const { levels } = this;
    const earlier = levels.length >= LISTEN.onsetLookbackFrames ? levels[0]! : 0;
    levels.push(frame.level);
    if (levels.length > LISTEN.onsetLookbackFrames) levels.shift();

    const attack =
      frame.level >= this.noiseGate &&
      frame.level > Math.max(earlier, this.noiseGate / 2) * LISTEN.onsetRatio &&
      (frame.time - this.lastOnset) * 1000 >= LISTEN.minNoteGapMs;

    if (attack) {
      if (this.note) this.close(frame.time, events);
      this.lastOnset = frame.time;
      this.pendingOnset = frame.time;
    }

    if (frame.midi !== null) {
      if (!this.note) {
        // A pitch with no attack heard (a very soft start): the note starts here.
        this.note = this.open(this.pendingOnset ?? frame.time);
        this.pendingOnset = null;
      }
      const note = this.note;
      note.lastVoiced = frame.time;
      const current = note.pitches.length ? median(note.pitches) : frame.midi;
      if (
        Math.abs(frame.midi - current) >= LISTEN.pitchChangeSemitones &&
        note.pitches.length >= 2
      ) {
        note.off ??= { since: frame.time, pitches: [], clarities: [] };
        note.off.pitches.push(frame.midi);
        note.off.clarities.push(frame.clarity);
        if ((frame.time - note.off.since) * 1000 >= LISTEN.pitchChangeMs) {
          // The pitch moved and stayed: a new note without a new attack (legato).
          const moved = note.off;
          this.close(moved.since, events);
          this.note = this.open(moved.since);
          this.note.pitches = moved.pitches;
          this.note.clarities = moved.clarities;
          this.note.lastVoiced = frame.time;
        }
      } else {
        note.off = null;
        note.pitches.push(frame.midi);
        note.clarities.push(frame.clarity);
      }
      const open = this.note;
      if (!open.reported && open.pitches.length >= 2) {
        open.reported = true;
        events.started.push(this.snapshot(open, 0));
      }
    } else if (this.note && (frame.time - this.note.lastVoiced) * 1000 >= LISTEN.releaseMs) {
      this.close(this.note.lastVoiced, events);
    }
    if (
      this.pendingOnset !== null &&
      (frame.time - this.pendingOnset) * 1000 > 2 * LISTEN.releaseMs
    ) {
      this.pendingOnset = null; // an attack that never became a pitch: a knock or a click
    }
    return events;
  }

  /** End whatever is sounding (the take is over). */
  flush(time: number): SegmentEvents {
    const events: SegmentEvents = { started: [], ended: [] };
    if (this.note) this.close(time, events);
    return events;
  }

  private open(onset: number): OpenNote {
    return { onset, pitches: [], clarities: [], reported: false, lastVoiced: onset, off: null };
  }

  private snapshot(note: OpenNote, duration: number): PlayedNote {
    const mean = note.clarities.reduce((a, b) => a + b, 0) / Math.max(1, note.clarities.length);
    return { onset: note.onset, duration, midi: median(note.pitches), clarity: mean };
  }

  private close(time: number, events: SegmentEvents): void {
    const note = this.note;
    this.note = null;
    if (!note || note.pitches.length < 2) return;
    const duration = time - note.onset;
    if (duration * 1000 < LISTEN.minNoteMs) return;
    const done = this.snapshot(note, duration);
    if (!note.reported) events.started.push({ ...done, duration: 0 });
    events.ended.push(done);
  }
}
