/**
 * Mic input (spec section 5, step 1). Audio is handed to listeners in memory
 * and never stored or sent anywhere.
 *
 * `RealMic` uses getUserMedia and an AudioWorklet on the same audio context
 * as playback, so its times are on the clock's time base. `SimulatedMic` is a
 * stand-in that tests feed with synthesized audio.
 */
import * as Tone from 'tone';

export type MicState = 'off' | 'starting' | 'on' | 'denied' | 'unavailable';

export type ChunkListener = (samples: Float32Array, time: number) => void;

export interface MicInput {
  readonly state: MicState;
  readonly sampleRate: number;
  /** Ask for the mic and start capturing. Resolves to the resulting state. */
  start(): Promise<MicState>;
  stop(): void;
  /** Receive blocks of samples with the audio-clock time of their first sample. */
  onChunk(listener: ChunkListener): () => void;
  onStateChange(listener: (state: MicState) => void): () => void;
}

abstract class BaseMic implements MicInput {
  protected current: MicState = 'off';
  private chunkListeners = new Set<ChunkListener>();
  private stateListeners = new Set<(state: MicState) => void>();

  get state(): MicState {
    return this.current;
  }

  abstract get sampleRate(): number;
  abstract start(): Promise<MicState>;
  abstract stop(): void;

  onChunk(listener: ChunkListener): () => void {
    this.chunkListeners.add(listener);
    return () => this.chunkListeners.delete(listener);
  }

  onStateChange(listener: (state: MicState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  protected setState(state: MicState): void {
    if (state === this.current) return;
    this.current = state;
    for (const listener of this.stateListeners) listener(state);
  }

  protected emit(samples: Float32Array, time: number): void {
    for (const listener of this.chunkListeners) listener(samples, time);
  }
}

export class RealMic extends BaseMic {
  private stream: MediaStream | null = null;
  private nodes: { disconnect(): void }[] = [];

  get sampleRate(): number {
    return Tone.getContext().sampleRate;
  }

  async start(): Promise<MicState> {
    if (this.current === 'on' || this.current === 'starting') return this.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setState('unavailable');
      return this.current;
    }
    this.setState('starting');
    try {
      // The browser's speech processing would mangle a guitar: turn all of it off.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      await Tone.start();
      const context = Tone.getContext();
      await context.addAudioWorkletModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
      const source = context.createMediaStreamSource(this.stream);
      const capture = context.createAudioWorkletNode('malcotron-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      // Routed to the output through a silent gain so the browser keeps it running.
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(capture);
      capture.connect(silent);
      silent.connect(context.rawContext.destination);
      capture.port.onmessage = (event: MessageEvent<{ samples: Float32Array; time: number }>) => {
        this.emit(event.data.samples, event.data.time);
      };
      this.nodes = [source, capture, silent];
      this.setState('on');
    } catch (error) {
      this.release();
      const name = (error as DOMException | undefined)?.name;
      this.setState(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
      );
    }
    return this.current;
  }

  stop(): void {
    this.release();
    this.setState('off');
  }

  private release(): void {
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }
}

/** A mic that hears whatever it is fed. Used by tests in place of a real one. */
export class SimulatedMic extends BaseMic {
  constructor(readonly sampleRate = 44100) {
    super();
  }

  start(): Promise<MicState> {
    this.setState('on');
    return Promise.resolve(this.current);
  }

  stop(): void {
    this.setState('off');
  }

  /** Deliver samples as if the mic had just captured them. */
  feed(samples: Float32Array, time: number): void {
    if (this.current === 'on') this.emit(samples, time);
  }
}
