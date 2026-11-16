/**
 * Playback of one piece: schedules its timeline on the clock and plays it in a
 * guitar tone. It knows nothing about the screen; the playhead reads the same
 * clock and timeline (src/notation/playhead.ts).
 */
import { fracToNumber } from '../content/music';
import type { Piece } from '../content/types';
import { clock } from './clock';
import { buildTimeline, soundingEvents, type NoteEvent, type Timeline } from './timeline';
import type { GuitarTone } from './tones';

export class Player {
  private timeline: Timeline | null = null;
  private readonly tone: GuitarTone;
  private stateListeners = new Set<(playing: boolean) => void>();
  private noteListeners = new Set<(event: NoteEvent, audioTime: number) => void>();

  constructor(tone: GuitarTone) {
    this.tone = tone;
    clock.onStart(() => this.emitState(true));
    clock.onStop(() => this.emitState(false));
  }

  get currentTimeline(): Timeline | null {
    return this.timeline;
  }

  get isPlaying(): boolean {
    return clock.state === 'running';
  }

  /** Load a piece: stops playback and sets the clock to the given tempo. */
  load(piece: Piece, tempo: number): void {
    this.stop();
    this.timeline = buildTimeline(piece);
    clock.setTempo(tempo);
  }

  /** Start from the beginning. Must be called from a user gesture the first time. */
  async play(): Promise<void> {
    const timeline = this.timeline;
    if (!timeline) return;
    await clock.unlock();
    await this.tone.loaded;
    this.stop();
    clock.clearAll();
    for (const event of soundingEvents(timeline)) {
      clock.schedule(event.startBeat, (audioTime) => {
        // Length in seconds at the tempo in force when the note is struck.
        this.tone.play(event.soundingMidi!, clock.beatsToSeconds(event.soundingBeats), audioTime);
        for (const listener of this.noteListeners) listener(event, audioTime);
      });
    }
    // Stop exactly at the end of the last bar and return to the start.
    clock.schedule(timeline.totalBeats, (audioTime) => clock.stop(audioTime));
    clock.start(0);
  }

  /** Stop now and cut off whatever is ringing. (At the end of a piece the last note rings out.) */
  stop(): void {
    if (clock.state !== 'running') return;
    clock.stop();
    this.tone.silence();
  }

  async toggle(): Promise<void> {
    if (this.isPlaying) this.stop();
    else await this.play();
  }

  /** Total length of the loaded piece in beats. */
  get totalBeats(): number {
    return this.timeline ? fracToNumber(this.timeline.totalBeats) : 0;
  }

  onStateChange(listener: (playing: boolean) => void): void {
    this.stateListeners.add(listener);
  }

  /** Called as each note is handed to the audio engine, with its exact audio time. */
  onNote(listener: (event: NoteEvent, audioTime: number) => void): void {
    this.noteListeners.add(listener);
  }

  private emitState(playing: boolean): void {
    for (const listener of this.stateListeners) listener(playing);
  }
}
