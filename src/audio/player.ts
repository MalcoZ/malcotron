/**
 * Playback of one piece: schedules its timeline on the clock. It knows nothing
 * about the screen; the playhead reads the same clock and timeline
 * (src/notation/playhead.ts).
 *
 * Two ways to run a piece (spec section 2):
 *  - listen: the melody plays, with the click if the metronome is on.
 *  - turn:   the learner plays. One bar of count-in, click on, melody silent.
 */
import { METRONOME } from '../config';
import { fracToNumber } from '../content/music';
import type { Piece } from '../content/types';
import { clock } from './clock';
import { clicksFor, countInBeats, type Click } from './metronome';
import { buildTimeline, soundingEvents, type NoteEvent, type Timeline } from './timeline';
import type { ClickSound, GuitarTone } from './tones';

export type PlayMode = 'listen' | 'turn';

export interface PlayEnd {
  mode: PlayMode;
  /** True when the piece ran to its end; false when it was stopped early. */
  completed: boolean;
}

export class Player {
  private timeline: Timeline | null = null;
  private readonly tone: GuitarTone;
  private readonly click: ClickSound;
  private mode: PlayMode = 'listen';
  private reachedEnd = false;
  /** Whether Listen also clicks. Your turn always does. */
  metronomeOn = false;
  private stateListeners = new Set<(playing: boolean) => void>();
  private endListeners = new Set<(end: PlayEnd) => void>();
  private noteListeners = new Set<(event: NoteEvent, audioTime: number) => void>();
  private clickListeners = new Set<(click: Click, audioTime: number) => void>();

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

  /** Load a piece: stops playback and sets the clock to the given tempo. */
  load(piece: Piece, tempo: number): void {
    this.stop();
    this.timeline = buildTimeline(piece);
    clock.setTempo(tempo);
  }

  /** Forget the loaded piece (when leaving a screen). */
  unload(): void {
    this.stop();
    this.timeline = null;
  }

  /** Start from the beginning. Must be called from a user gesture the first time. */
  async play(mode: PlayMode = 'listen'): Promise<void> {
    const timeline = this.timeline;
    if (!timeline) return;
    await clock.unlock();
    await this.tone.loaded;
    if (this.timeline !== timeline) return; // another piece was loaded while waiting
    this.stop();
    this.mode = mode;
    this.reachedEnd = false;

    const leadIn = mode === 'turn' ? countInBeats(timeline, METRONOME.countInBars) : 0;
    clock.prepare(leadIn);

    if (mode === 'turn' || this.metronomeOn) {
      for (const click of clicksFor(timeline, leadIn)) {
        clock.schedule(click.beat, (audioTime) => {
          this.click.play(click.accent, audioTime);
          for (const listener of this.clickListeners) listener(click, audioTime);
        });
      }
    }
    if (mode === 'listen') {
      for (const event of soundingEvents(timeline)) {
        clock.schedule(event.startBeat, (audioTime) => {
          // Length in seconds at the tempo in force when the note is struck.
          this.tone.play(event.soundingMidi!, clock.beatsToSeconds(event.soundingBeats), audioTime);
          for (const listener of this.noteListeners) listener(event, audioTime);
        });
      }
    }
    // Stop exactly at the end of the last bar and return to the start.
    clock.schedule(timeline.totalBeats, (audioTime) => {
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
  async toggle(mode: PlayMode = 'listen'): Promise<void> {
    if (this.isPlaying) this.stop();
    else await this.play(mode);
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

  private emitState(playing: boolean): void {
    for (const listener of this.stateListeners) listener(playing);
  }
}
