import { describe, expect, it } from 'vitest';
import { LISTEN, STORAGE_KEYS } from '../../src/config';
import {
  CalibrationStore,
  defaultCalibration,
  latencyFromOffsets,
  median,
  openStringFor,
  parseCalibration,
} from '../../src/listen/calibration';
import { encodeWav } from '../../src/listen/wav';
import { readWav } from '../../tools/detect-harness';

describe('calibration', () => {
  it('starts with the mic off and nothing measured', () => {
    expect(defaultCalibration()).toEqual({
      micEnabled: false,
      noiseGate: LISTEN.defaultNoiseGate,
      tuningCents: 0,
      latencyMs: 0,
      measured: { noise: false, tuning: false, latency: false },
    });
  });

  it.each([null, '{bad', '7', 'null'])('ignores unreadable data %j', (text) => {
    expect(parseCalibration(text)).toEqual(defaultCalibration());
  });

  it('clamps stored values to sane ranges', () => {
    const parsed = parseCalibration(
      JSON.stringify({ micEnabled: true, noiseGate: 9, tuningCents: -500, latencyMs: 'x' }),
    );
    expect(parsed).toMatchObject({
      micEnabled: true,
      noiseGate: 0.5,
      tuningCents: -100,
      latencyMs: 0,
    });
  });

  it('saves changes, keeps the other measurements and tells listeners', () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const calibration = new CalibrationStore(store);
    let calls = 0;
    const off = calibration.onChange(() => calls++);
    calibration.update({
      noiseGate: 0.02,
      measured: { ...calibration.value.measured, noise: true },
    });
    calibration.update({
      latencyMs: 42,
      measured: { ...calibration.value.measured, latency: true },
    });
    expect(calls).toBe(2);
    off();
    calibration.update({ micEnabled: true });
    expect(calls).toBe(2);
    const reloaded = new CalibrationStore(store).value;
    expect(reloaded).toMatchObject({ micEnabled: true, noiseGate: 0.02, latencyMs: 42 });
    expect(reloaded.measured).toEqual({ noise: true, tuning: false, latency: true });
    expect(data.has(STORAGE_KEYS.calibration)).toBe(true);
  });

  it('recognises the six open strings', () => {
    expect([40, 45.2, 49.6, 55, 59.3, 64].map(openStringFor)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(openStringFor(42)).toBeNull();
    expect(openStringFor(67)).toBeNull();
  });

  it('takes the median lateness as the timing correction', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([1, 3])).toBe(2);
    expect(median([])).toBe(0);
    expect(latencyFromOffsets([60, 55, 70, 62, 58, 65, 61, 63])).toBe(62);
    // One wild strike does not move it; strikes far from any click are ignored.
    expect(latencyFromOffsets([60, 55, 70, 62, 58, 340, 61, 63])).toBe(61);
    // Too few notes on the clicks: no result.
    expect(latencyFromOffsets([60, 55, 70])).toBeNull();
  });
});

describe('test recording', () => {
  it('writes a WAV file the harness can read back', () => {
    const samples = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10) * 0.5);
    const wav = encodeWav(samples, 48000);
    expect(wav.length).toBe(44 + 960);
    const back = readWav(Buffer.from(wav));
    expect(back.sampleRate).toBe(48000);
    expect(back.samples).toHaveLength(480);
    for (let i = 0; i < 480; i += 37) expect(back.samples[i]!).toBeCloseTo(samples[i]!, 3);
    // Out-of-range samples are clipped, not wrapped.
    const loud = readWav(Buffer.from(encodeWav(Float32Array.from([2, -2]), 44100))).samples;
    expect(loud[0]!).toBeCloseTo(1, 3);
    expect(loud[1]!).toBeCloseTo(-1, 3);
  });
});
