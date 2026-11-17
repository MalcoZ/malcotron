/**
 * Turns a stream of mic samples into analysis frames: pre-filtered, then one
 * pitch and level reading per hop (spec section 5, steps 1 and 2).
 */
import { LISTEN } from '../config';
import { hzToMidi, PitchDetector } from './pitch';

export interface Frame {
  /** Time of the start of the newest hop in the frame, in the caller's time base (seconds). */
  time: number;
  /** Sounding pitch as a fractional MIDI number, or null when unclear or quiet. */
  midi: number | null;
  clarity: number;
  /** Level of the newest hop (RMS, 0 to 1). Used for attacks, as it reacts fastest. */
  level: number;
  /** The noise gate in force for this frame (it follows the room). */
  gate: number;
}

const DECIMATE = 2;

/** A second-order filter section (RBJ cookbook), run sample by sample. */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(type: 'lowpass' | 'highpass', hz: number, sampleRate: number) {
    const w = (2 * Math.PI * hz) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    const k = type === 'lowpass' ? 1 - cos : 1 + cos;
    this.b0 = k / 2 / a0;
    this.b1 = (type === 'lowpass' ? k : -k) / a0;
    this.b2 = k / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export class FrameAnalyser {
  private readonly detector: PitchDetector;
  private readonly buffer: Float32Array;
  private readonly half: Float32Array;
  private readonly filters: Biquad[];
  private filled = 0;
  private sinceHop = 0;
  private samplesSeen = 0;
  /** The highest the gate may go. Frames quieter than the gate in force have no pitch. */
  noiseGate: number = LISTEN.defaultNoiseGate;
  /** Quietest level in each recent quarter second, for following the room's noise floor. */
  private readonly blockMinima: number[] = [];
  private blockMin = Infinity;
  private blockFrames = 0;

  /**
   * @param a4 tuning reference; the mic check sets it from the guitar's offset
   */
  constructor(
    private readonly sampleRate: number,
    private a4 = 440,
  ) {
    // After the low-pass nothing above 2 kHz is left, so every second sample is
    // enough for pitch detection, and it makes it four times cheaper.
    this.detector = new PitchDetector(sampleRate / DECIMATE, LISTEN.frameSize / DECIMATE);
    this.buffer = new Float32Array(LISTEN.frameSize);
    this.half = new Float32Array(LISTEN.frameSize / DECIMATE);
    // Two low-pass sections: the click (above 2.5 kHz) is cut by more than 12 dB.
    this.filters = [
      new Biquad('highpass', LISTEN.highpassHz, sampleRate),
      new Biquad('lowpass', LISTEN.lowpassHz, sampleRate),
      new Biquad('lowpass', LISTEN.lowpassHz, sampleRate),
    ];
  }

  /** Shift every reported pitch by a tuning offset in cents (guitar flat = negative). */
  setTuningOffsetCents(cents: number): void {
    this.a4 = 440 * Math.pow(2, cents / 1200);
  }

  /**
   * Add samples. `startTime` is the time of the first sample. Returns the
   * frames completed by these samples.
   */
  push(samples: Float32Array, startTime: number): Frame[] {
    const { buffer } = this;
    const size = LISTEN.frameSize;
    const hop = LISTEN.hopSize;
    const frames: Frame[] = [];
    for (let i = 0; i < samples.length; i++) {
      let x = samples[i]!;
      for (const f of this.filters) x = f.process(x);
      if (this.filled < size) buffer[this.filled++] = x;
      else {
        buffer.copyWithin(0, 1);
        buffer[size - 1] = x;
      }
      this.samplesSeen++;
      if (this.filled === size && ++this.sinceHop >= hop) {
        this.sinceHop = 0;
        let sum = 0;
        for (let j = size - hop; j < size; j++) sum += buffer[j]! * buffer[j]!;
        const level = Math.sqrt(sum / hop);
        const hopStart = startTime + (i + 1 - hop) / this.sampleRate;
        let midi: number | null = null;
        let clarity = 0;
        const gate = this.currentGate(level);
        if (level >= gate) {
          const half = this.half;
          for (let j = 0; j < half.length; j++) half[j] = buffer[j * DECIMATE]!;
          const estimate = this.detector.detect(half);
          clarity = estimate.clarity;
          if (estimate.hz !== null && clarity >= LISTEN.clarityThreshold) {
            midi = hzToMidi(estimate.hz, this.a4);
          }
        }
        frames.push({ time: hopStart, midi, clarity, level, gate });
      }
    }
    return frames;
  }

  /**
   * The gate for this frame: a few times above the quietest level heard
   * lately, but never above `noiseGate` nor below the configured floor.
   */
  private currentGate(level: number): number {
    const perBlock = Math.max(1, Math.round((0.25 * this.sampleRate) / LISTEN.hopSize));
    this.blockMin = Math.min(this.blockMin, level);
    if (++this.blockFrames >= perBlock) {
      this.blockMinima.push(this.blockMin);
      const keep = Math.round(LISTEN.floorWindowSeconds / 0.25);
      if (this.blockMinima.length > keep) this.blockMinima.shift();
      this.blockMin = Infinity;
      this.blockFrames = 0;
    }
    if (this.blockMinima.length === 0) return this.noiseGate;
    const floor = Math.min(...this.blockMinima);
    return Math.min(this.noiseGate, Math.max(LISTEN.minNoiseGate, floor * LISTEN.gateOverNoise));
  }

  /** The room's noise floor as last measured (RMS), or null before any audio. */
  get noiseFloor(): number | null {
    return this.blockMinima.length ? Math.min(...this.blockMinima) : null;
  }

  /** Seconds of audio that must arrive before the first frame. */
  get warmUpSeconds(): number {
    return LISTEN.frameSize / this.sampleRate;
  }
}
