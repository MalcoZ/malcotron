/**
 * Listens to one take: mic samples in, graded notes out, live and at the end
 * (spec section 5, steps 2 to 6). Every time comes from the clock.
 */
import type { Timeline } from '../audio/timeline';
import type { Piece } from '../content/types';
import type { Calibration } from './calibration';
import { FrameAnalyser, type Frame } from './frames';
import {
  expectedNotes,
  gradeLive,
  gradeTake,
  timingBias,
  toleranceFor,
  type ExpectedNote,
  type HeardNote,
  type NoteGrade,
  type TakeGrade,
  type Tolerance,
} from './grade';
import type { MicInput } from './mic';
import { Segmenter, type PlayedNote } from './segment';

/** What the listener needs from the clock. */
export interface BeatClock {
  beatAt(audioTime: number): number;
  readonly tempo: number;
}

export interface TakeResult {
  grade: TakeGrade;
  /** Every note heard after the count-in, on the beat grid. */
  heard: HeardNote[];
}

export class TakeListener {
  private readonly analyser: FrameAnalyser;
  private readonly segmenter: Segmenter;
  private readonly expected: ExpectedNote[];
  private readonly tolerance: Tolerance;
  private readonly heard: HeardNote[] = [];
  private readonly liveTaken = new Set<number>();
  private readonly latencySeconds: number;
  private unsubscribe: (() => void) | null = null;
  private lastTime = 0;
  /** Offsets of the right notes heard so far, for the take's even lateness. */
  private readonly liveOffsets: number[] = [];
  /** Called as soon as a note is heard and paired with a written one. */
  onLive: ((grade: NoteGrade) => void) | null = null;
  /** Called with every analysis frame (for a level meter or tuner). */
  onFrame: ((frame: Frame) => void) | null = null;

  constructor(
    private readonly mic: MicInput,
    private readonly clock: BeatClock,
    timeline: Timeline,
    piece: Piece,
    calibration: Calibration,
  ) {
    this.analyser = new FrameAnalyser(mic.sampleRate);
    this.analyser.noiseGate = calibration.noiseGate;
    this.analyser.setTuningOffsetCents(calibration.tuningCents);
    this.segmenter = new Segmenter(calibration.noiseGate);
    this.expected = expectedNotes(timeline);
    this.tolerance = toleranceFor(piece);
    this.latencySeconds = calibration.latencyMs / 1000;
  }

  start(): void {
    this.unsubscribe = this.mic.onChunk((samples, time) => {
      this.lastTime = time + samples.length / this.mic.sampleRate;
      for (const frame of this.analyser.push(samples, time)) {
        this.onFrame?.(frame);
        const events = this.segmenter.push(frame);
        for (const note of events.started) this.noteStarted(note);
        for (const note of events.ended) this.noteEnded(note);
      }
    });
  }

  /** Stop listening and give the final grade. */
  finish(): TakeResult {
    this.unsubscribe?.();
    this.unsubscribe = null;
    // The take is over: close a note that is still ringing, using the clock while it still runs.
    for (const note of this.segmenter.flush(this.lastTime).ended) this.noteEnded(note);
    const heard = [...this.heard].sort((a, b) => a.beat - b.beat);
    return { grade: gradeTake(this.expected, heard, this.clock.tempo, this.tolerance), heard };
  }

  /** Stop listening without grading. */
  cancel(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private toHeard(note: PlayedNote): HeardNote {
    return {
      beat: this.clock.beatAt(note.onset - this.latencySeconds),
      midi: note.midi,
      clarity: note.clarity,
      durationBeats: (note.duration * this.clock.tempo) / 60,
    };
  }

  private noteStarted(note: PlayedNote): void {
    const heard = this.toHeard(note);
    if (heard.beat < -0.5) return; // played during the count-in
    const bias = timingBias(this.liveOffsets);
    const grade = gradeLive(
      this.expected,
      this.liveTaken,
      heard,
      this.clock.tempo,
      this.tolerance,
      bias,
    );
    if (!grade) return;
    this.liveTaken.add(grade.expected.index);
    if (grade.pitchCorrect && grade.offsetMs !== null) this.liveOffsets.push(grade.offsetMs + bias);
    this.onLive?.(grade);
  }

  private noteEnded(note: PlayedNote): void {
    const heard = this.toHeard(note);
    if (heard.beat >= -0.5) this.heard.push(heard);
  }
}
