// Mic capture: passes raw samples to the page in blocks, with the audio-clock
// time of each block's first sample. Nothing is stored or sent anywhere else.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(512);
    this.filled = 0;
    this.blockTime = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      if (this.filled === 0) this.blockTime = currentTime + i / sampleRate;
      this.block[this.filled++] = input[i];
      if (this.filled === this.block.length) {
        this.port.postMessage({ samples: this.block.slice(), time: this.blockTime });
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('malcotron-capture', CaptureProcessor);
