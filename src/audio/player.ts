/**
 * Playback of one piece: schedules its timeline on the clock. It knows nothing
 * about the screen; the playhead reads the same clock and timeline
 * (src/notation/playhead.ts).
 *
 * Ways to run a piece (spec section 2):
 *  - listen: the melody plays, with the click if the metronome is on. It
 *            starts at the selected bars if there are any, and can loop them.
 *  - turn:   the learner plays. One bar of count-in, click on, melody silent.
 *  - heard:  plays back the notes the mic heard in the last take.
 */
import { METRONOME } from '../config';
import { fracToNumber } from '../content/music';
import type { Piece } from '../content/types';
import { clock } from './clock';
import { clicksFor, countInBeats, pulseBeats, type Click, type Subdivision } from './metronome';
import { buildTimeline, soundingEvents, type NoteEvent, type Timeline } from './timeline';
import type { ClickSound, GuitarTone } from './tones';

export type PlayMode = 'listen' | 'turn' | 'heard';

export interface PlayEnd {
  mode: PlayMode;
  /** True when the piece ran to its end; false when it was stopped early. */
  completed: boolean;
}

/** A note to play back that is not in the score (what the mic heard). */
export interface LooseNote {
  beat: number;
  /** Sounding MIDI number. */
  midi: number;
  durationBeats: number;
}

export interface BeatRange {
  startBeat: number;
  endBeat: number;
}

export class Player {
  private timeline: Timeline | null = null;
  private tone: GuitarTone;
  private readonly click: ClickSound;
  private mode: PlayMode = 'listen';
  private reachedEnd = false;
  /** Whether Listen also clicks. Your turn always does. */
  metronomeOn = false;
  /** Clicks per beat. */
  subdivision: Subdivision = 1;
  /** Bars selected by the learner: Listen starts there, and loops them if `loop` is on. */
  range: BeatRange | null = null;
  loop = false;
  private stateListeners = new Set<(playing: boolean) => void>();
  private endListeners = new Set<(end: PlayEnd) => void>();
  private noteListeners = new Set<(event: NoteEvent, audioTime: number) => void>();
  private clickListeners = new Set<(click: Click, audioTime: number) => void>();
  private looseListeners = new Set<(note: LooseNote, audioTime: number) => void>();

  constructor(tone: GuitarTone, click: ClickSound) {
    this.tone = tone;
    this.click = click;
    clock.onStart(() => this.emitState(true));
    clock.onStop(() => {
      this.emitState(false);
      const end = { mode: this.mode, completed: this.reachedEnd };
      for (const listener of this.endListeners) listener(end);
    });
  }

  get currentTimeline(): Timeline | null {
    return this.timeline;
  }

  get isPlaying(): boolean {
    return clock.state === 'running';
  }

  /** The mode of the current or most recent run. */
  get currentMode(): PlayMode {
    return this.mode;
  }

  get currentTone(): GuitarTone {
    return this.tone;
  }

  /** Change the guitar voice. Takes effect from the next note. */
  setTone(tone: GuitarTone): void {
    this.tone.silence();
    this.tone = tone;
  }

  /** Metronome pulse of the loaded piece, in beats. */
  get pulse(): number {
    return this.timeline ? pulseBeats(this.timeline.meter) : 1;
  }

  /** Load a piece: stops playback, clears any selection and sets the clock to the given tempo. */
  load(piece: Piece, tempo: number): void {
    this.stop();
    this.timeline = buildTimeline(piece);
    this.range = null;
    this.loop = false;
    clock.setTempo(tempo);
  }

  /** Forget the loaded piece (when leaving a screen). */
  unload(): void {
    this.stop();
    this.timeline = null;
    this.range = null;
    this.loop = false;
  }

  /**
   * Start. Must be called from a user gesture the first time.
   * @param heard for mode 'heard': the notes to play back
   */
  async play(mode: PlayMode = 'listen', heard: readonly LooseNote[] = []): Promise<void> {
    const timeline = this.timeline;
    if (!timeline) return;
    await clock.unlock();
    await this.tone.loaded;
    if (this.timeline !== timeline) return; // another piece was loaded while waiting
    this.stop();
    this.mode = mode;
    this.reachedEnd = false;

    const total = fracToNumber(timeline.totalBeats);
    const leadIn = mode === 'turn' ? countInBeats(timeline, METRONOME.countInBars) : 0;
    const range = mode === 'listen' ? this.range : null;
    const from = range ? range.startBeat : -leadIn;
    const to = range ? range.endBeat : total;
    clock.prepare(leadIn);

    if (mode === 'turn' || this.metronomeOn) {
      const options = { subdivision: this.subdivision, fromBeat: from, toBeat: to };
      for (const click of clicksFor(timeline, leadIn, options)) {
        clock.schedule(click.beat, (audioTime) => {
          this.click.play(click.accent ? 'accent' : click.sub ? 'sub' : 'beat', audioTime);
          for (const listener of this.clickListeners) listener(click, audioTime);
        });
      }
    }
    if (mode === 'listen') {
      for (const event of soundingEvents(timeline)) {
        const start = fracToNumber(event.startBeat);
        if (start < from - 1e-9 || start >= to - 1e-9) continue;
        // In a loop a note may not ring past the join.
        const beats = Math.min(
          fracToNumber(event.soundingBeats),
          range && this.loop ? to - start : Infinity,
        );
        clock.schedule(event.startBeat, (audioTime) => {
          // Length in seconds at the tempo in force when the note is struck.
          this.tone.play(event.soundingMidi!, clock.beatsToSeconds(beats), audioTime);
          for (const listener of this.noteListeners) listener(event, audioTime);
        });
      }
    }
    if (mode === 'heard') {
      for (const note of heard) {
        // A note struck a hair before the first beat still belongs to the take.
        if (note.beat < -0.5 || note.beat >= total) continue;
        clock.schedule(Math.max(0, note.beat), (audioTime) => {
          const seconds = clock.beatsToSeconds(Math.max(0.25, note.durationBeats));
          this.tone.play(Math.round(note.midi), seconds, audioTime);
          for (const listener of this.looseListeners) listener(note, audioTime);
        });
      }
    }
    if (range && this.loop) {
      clock.setLoop(from, to);
    } else {
      // Stop exactly at the end and return to the start.
      clock.schedule(to, (audioTime) => {
        this.reachedEnd = true;
        clock.stop(audioTime);
      });
    }
    clock.start(from);
  }

  /** Clicks only: a bar of count-in, then `count` clicks (for latency calibration). */
  async playClicks(count: number, leadIn: number): Promise<void> {
    await clock.unlock();
    this.stop();
    this.mode = 'turn';
    this.reachedEnd = false;
    clock.prepare(leadIn);
    for (let beat = -leadIn; beat < count; beat++) {
      const click: Click = { beat, accent: beat < 0 ? beat === -leadIn : beat === 0, sub: false };
      clock.schedule(beat, (audioTime) => {
        this.click.play(beat < 0 ? 'beat' : 'accent', audioTime);
        for (const listener of this.clickListeners) listener(click, audioTime);
      });
    }
    clock.schedule(count, (audioTime) => {
      this.reachedEnd = true;
      clock.stop(audioTime);
    });
    clock.start();
  }

  /** Stop now and cut off whatever is ringing. (At the end of a piece the last note rings out.) */
  stop(): void {
    if (clock.state !== 'running') return;
    this.reachedEnd = false;
    clock.stop();
    this.tone.silence();
  }

  /** Start in a mode, or stop if anything is playing. */
  async toggle(mode: PlayMode = 'listen', heard: readonly LooseNote[] = []): Promise<void> {
    if (this.isPlaying) this.stop();
    else await this.play(mode, heard);
  }

  /** Total length of the loaded piece in beats. */
  get totalBeats(): number {
    return this.timeline ? fracToNumber(this.timeline.totalBeats) : 0;
  }

  /** Each returns a function that removes the listener. */
  onStateChange(listener: (playing: boolean) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Called when a run stops, whether it finished or was stopped early. */
  onEnd(listener: (end: PlayEnd) => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** Called as each note is handed to the audio engine, with its exact audio time. */
  onNote(listener: (event: NoteEvent, audioTime: number) => void): () => void {
    this.noteListeners.add(listener);
    return () => this.noteListeners.delete(listener);
  }

  /** Called as each metronome click is handed to the audio engine. */
  onClick(listener: (click: Click, audioTime: number) => void): () => void {
    this.clickListeners.add(listener);
    return () => this.clickListeners.delete(listener);
  }

  /** Called as each played-back heard note is handed to the audio engine. */
  onHeardNote(listener: (note: LooseNote, audioTime: number) => void): () => void {
    this.looseListeners.add(listener);
    return () => this.looseListeners.delete(listener);
  }

  private emitState(playing: boolean): void {
    for (const listener of this.stateListeners) listener(playing);
  }
}
