/**
 * The clock: the one source of musical time.
 *
 * It wraps the Tone.js Transport, which counts in ticks driven by the audio
 * hardware clock. Everything that needs to know "where are we in the music"
 * asks this module: playback and the playhead now; the metronome, count-in,
 * looping and mic grading in M1. Nothing else may use setTimeout, setInterval
 * or Date.now() for musical timing.
 *
 * Positions are in beats (one beat = one quarter note). Because the Transport
 * counts ticks rather than seconds, a tempo change takes effect at once and
 * everything already scheduled moves with it.
 */
import * as Tone from 'tone';
import { TEMPO } from '../config';
import type { Fraction } from '../content/music';
import {
  beatsToSeconds,
  beatToTransportTicks,
  secondsToBeats,
  TICKS_PER_BEAT,
  transportTicksToBeat,
} from './time';

export type ClockState = 'stopped' | 'running';

/** A scheduled callback gets the exact audio-context time (seconds) of its beat. */
export type ScheduledCallback = (audioTime: number) => void;

class Clock {
  private stopListeners = new Set<() => void>();
  private startListeners = new Set<() => void>();
  private configured = false;
  private phase: ClockState = 'stopped';
  /** Audio time at which the current run starts counting. */
  private startedAt = 0;
  /** Audio time at which the current run ends, once a stop has been asked for. */
  private stopAt: number | null = null;
  private lastBeat = 0;
  /** Beats of count-in before beat 0 in the current run. */
  private leadInBeats = 0;

  private get transport() {
    const transport = Tone.getTransport();
    if (!this.configured) {
      this.configured = true;
      transport.PPQ = TICKS_PER_BEAT;
      transport.bpm.value = TEMPO.default;
    }
    return transport;
  }

  /** Resume the audio context. Browsers only allow this inside a user gesture. */
  async unlock(): Promise<void> {
    await Tone.start();
  }

  /** 'running' from `start` until the stop has actually been heard. */
  get state(): ClockState {
    return this.phase;
  }

  /** Tempo in quarter-note beats per minute. */
  get tempo(): number {
    return this.transport.bpm.value;
  }

  /** Change tempo. Safe while running: scheduled events and the beat position follow smoothly. */
  setTempo(bpm: number): void {
    const clamped = Math.min(TEMPO.max, Math.max(TEMPO.min, bpm));
    this.transport.bpm.value = clamped;
  }

  /**
   * The beat being heard right now. Tone schedules a little ahead of the
   * audio; this reads the position at the true current audio time, so visuals
   * driven from it line up with the sound. Negative during a count-in and just
   * before the first beat sounds; 0 when stopped.
   */
  get beat(): number {
    if (this.phase !== 'running') return 0;
    const heard = Tone.immediate();
    if (heard < this.startedAt) {
      return -this.leadInBeats - secondsToBeats(this.startedAt - heard, this.tempo);
    }
    // Between the audible stop and the stop being reported, hold the last position.
    if (this.stopAt !== null && heard >= this.stopAt) return this.lastBeat;
    this.lastBeat = transportTicksToBeat(this.transport.getTicksAtTime(heard), this.leadInBeats);
    return this.lastBeat;
  }

  /**
   * The beat at an audio-context time (for example when the mic heard a note).
   * This is the only place audio time is turned into beats. Only meaningful
   * while the clock is running.
   */
  beatAt(audioTime: number): number {
    if (audioTime < this.startedAt) {
      return -this.leadInBeats - secondsToBeats(this.startedAt - audioTime, this.tempo);
    }
    return transportTicksToBeat(this.transport.getTicksAtTime(audioTime), this.leadInBeats);
  }

  /** Audio time at which the current run started. */
  get startedAtAudioTime(): number {
    return this.startedAt;
  }

  /** The audio sample rate. */
  get sampleRate(): number {
    return Tone.getContext().sampleRate;
  }

  /** Audio-context time now, in seconds. */
  get audioTime(): number {
    return Tone.immediate();
  }

  beatsToSeconds(beats: number | Fraction): number {
    return beatsToSeconds(beats, this.tempo);
  }

  secondsToBeats(seconds: number): number {
    return secondsToBeats(seconds, this.tempo);
  }

  /** Run a callback when the clock reaches a beat. Returns an id for `clear`. */
  schedule(beat: number | Fraction, callback: ScheduledCallback): number {
    return this.transport.schedule(callback, `${beatToTransportTicks(beat, this.leadInBeats)}i`);
  }

  clear(id: number): void {
    this.transport.clear(id);
  }

  /** Remove everything scheduled. */
  clearAll(): void {
    this.transport.cancel(0);
  }

  /** Beats of count-in before beat 0. */
  get leadIn(): number {
    return this.leadInBeats;
  }

  /**
   * Set how many beats the next run starts before beat 0 (a count-in), and
   * clear the schedule. Call it before scheduling anything for that run:
   * scheduling at beat 0 always means the first beat of the music, and beats
   * down to -leadIn can be scheduled for count-in clicks.
   */
  prepare(leadInBeats = 0): void {
    if (this.phase === 'running') this.stop();
    this.transport.cancel(0);
    this.transport.loop = false;
    this.leadInBeats = Math.max(0, leadInBeats);
  }

  /**
   * Repeat the stretch between two beats until stopped. Events scheduled
   * inside it fire on every pass, with no gap at the join.
   */
  setLoop(startBeat: number, endBeat: number): void {
    const transport = this.transport;
    transport.setLoopPoints(
      `${beatToTransportTicks(startBeat, this.leadInBeats)}i`,
      `${beatToTransportTicks(endBeat, this.leadInBeats)}i`,
    );
    transport.loop = true;
  }

  /**
   * Start counting: from the start of the lead-in if there is one, or from
   * `fromBeat`. Stop first if running.
   */
  start(fromBeat?: number): void {
    const transport = this.transport;
    if (this.phase === 'running') this.stop();
    const from = fromBeat ?? -this.leadInBeats;
    const at = Tone.now();
    transport.ticks = beatToTransportTicks(from, this.leadInBeats);
    transport.start(at);
    this.startedAt = at;
    this.stopAt = null;
    this.lastBeat = from;
    this.phase = 'running';
    for (const listener of this.startListeners) listener();
  }

  /**
   * Stop and return to the beginning. With `atAudioTime` (from a scheduled
   * callback, which runs slightly ahead of the audio) the stop waits until
   * that moment is actually heard.
   */
  stop(atAudioTime?: number): void {
    if (this.phase !== 'running') return;
    if (atAudioTime === undefined) {
      this.transport.stop(Tone.immediate());
      this.phase = 'stopped';
      this.stopAt = null;
      for (const listener of this.stopListeners) listener();
      return;
    }
    this.stopAt = atAudioTime;
    Tone.getDraw().schedule(() => {
      // Ignore if the clock was stopped or restarted by hand in the meantime.
      if (this.phase === 'running' && this.stopAt === atAudioTime) this.stop();
    }, atAudioTime);
  }

  onStart(listener: () => void): void {
    this.startListeners.add(listener);
  }

  onStop(listener: () => void): void {
    this.stopListeners.add(listener);
  }
}

/** The app's single clock. */
export const clock = new Clock();
export type { Clock };
