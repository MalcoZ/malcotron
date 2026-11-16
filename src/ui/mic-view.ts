/**
 * Mic setup (spec section 5): turn the mic on, measure the room, check the six
 * open strings and the guitar's tuning, tune, and calibrate timing.
 */
import { clock } from '../audio/clock';
import { LISTEN } from '../config';
import { latencyFromOffsets, median, OPEN_STRINGS, openStringFor } from '../listen/calibration';
import { soundingName } from '../listen/feedback';
import { FrameAnalyser } from '../listen/frames';
import { Segmenter } from '../listen/segment';
import type { AppContext, View } from './context';
import { h } from './dom';

const STRING_NAMES = ['6th (E)', '5th (A)', '4th (D)', '3rd (G)', '2nd (B)', '1st (E)'];
const STATE_TEXT = {
  off: 'The mic is off.',
  starting: 'Waiting for permission…',
  on: 'The mic is on. Audio is analysed in this browser and never stored or sent anywhere.',
  denied: 'Mic access was refused. Allow it in the browser’s site settings, then try again.',
  unavailable: 'No mic could be opened on this device.',
} as const;

export function createMicView(ctx: AppContext): View {
  const { mic, calibration, player } = ctx;
  const cleanup: (() => void)[] = [];

  // --- 1. On / off -------------------------------------------------------------
  const status = h('p', { className: 'muted', id: 'mic-status' });
  const toggle = h('button', { type: 'button', className: 'btn btn-primary', id: 'mic-toggle' });
  const meter = h(
    'div',
    { className: 'meter' },
    h('div', { className: 'meter-fill', id: 'mic-level' }),
  );
  const fill = meter.firstElementChild as HTMLElement;
  const onCard = h(
    'section',
    { className: 'card mic-card' },
    h('h3', { textContent: '1. Microphone' }),
    status,
    h('div', { className: 'row' }, toggle, meter),
    h('p', {
      className: 'muted small',
      textContent:
        'Headphones are best. On speakers the click is short and high so the mic can tell it from the guitar.',
    }),
  );

  // --- 2. Room noise -------------------------------------------------------------
  const noiseButton = h('button', {
    type: 'button',
    className: 'btn',
    id: 'measure-noise',
    textContent: 'Measure the room',
  });
  const noiseText = h('span', { className: 'muted', id: 'noise-result' });
  const noiseCard = h(
    'section',
    { className: 'card mic-card' },
    h('h3', { textContent: '2. Room noise' }),
    h('p', {
      className: 'muted',
      textContent: 'Stay quiet for two seconds so the app learns what silence sounds like here.',
    }),
    h('div', { className: 'row' }, noiseButton, noiseText),
  );

  // --- 3. Open strings, tuning and tuner -----------------------------------------
  const chips = STRING_NAMES.map((name, i) =>
    h('span', { className: 'chip', dataset: { string: String(6 - i) }, textContent: name }),
  );
  const tunerNote = h('span', { className: 'tuner-note', id: 'tuner-note', textContent: '–' });
  const tunerCents = h('span', { className: 'muted', id: 'tuner-cents' });
  const needle = h('div', { className: 'tuner-needle', id: 'tuner-needle' });
  const tuningText = h('span', { className: 'muted', id: 'tuning-result' });
  const stringsCard = h(
    'section',
    { className: 'card mic-card' },
    h('h3', { textContent: '3. Open strings and tuner' }),
    h('p', {
      className: 'muted',
      textContent:
        'Play each open string once and let it ring. The tuner shows what the mic hears.',
    }),
    h('div', { className: 'row chips', id: 'string-chips' }, ...chips),
    h(
      'div',
      { className: 'row tuner' },
      tunerNote,
      h('div', { className: 'tuner-scale' }, needle),
      tunerCents,
    ),
    h('div', { className: 'row' }, tuningText),
  );

  // --- 4. Timing -------------------------------------------------------------------
  const timingButton = h('button', {
    type: 'button',
    className: 'btn',
    id: 'calibrate',
    textContent: 'Calibrate timing',
  });
  const timingText = h('span', { className: 'muted', id: 'latency-result' });
  const timingCard = h(
    'section',
    { className: 'card mic-card' },
    h('h3', { textContent: '4. Timing' }),
    h('p', {
      className: 'muted',
      textContent: `After four quiet clicks you will hear ${LISTEN.calibrationClicks} louder ones. Play any note exactly on each of those.`,
    }),
    h('div', { className: 'row' }, timingButton, timingText),
  );

  const el = h(
    'div',
    { className: 'home mic-view', id: 'mic-view' },
    h(
      'div',
      { className: 'lesson-head' },
      h('a', { className: 'crumb', href: '#/', textContent: '‹ All lessons' }),
      h('h2', { textContent: 'Microphone setup' }),
    ),
    h('div', { className: 'mic-grid' }, onCard, noiseCard, stringsCard, timingCard),
  );

  // --- Analysis ------------------------------------------------------------------
  let analyser = new FrameAnalyser(mic.sampleRate);
  let segmenter = new Segmenter(calibration.value.noiseGate);
  analyser.noiseGate = calibration.value.noiseGate;
  let noise: { squares: number; samples: number } | null = null;
  const heardStrings = new Map<number, number>();
  let offsets: number[] | null = null;

  function refresh(): void {
    const state = mic.state;
    const c = calibration.value;
    status.textContent = STATE_TEXT[state];
    toggle.textContent = state === 'on' ? 'Turn the mic off' : 'Turn on the mic';
    toggle.disabled = state === 'starting';
    for (const button of [noiseButton, timingButton]) button.disabled = state !== 'on';
    if (!noise) {
      noiseText.textContent = c.measured.noise
        ? `Measured. Gate set at ${(c.noiseGate * 100).toFixed(1)}% level.`
        : '';
    }
    if (c.measured.tuning && heardStrings.size === 0) {
      tuningText.textContent = tuningSentence(c.tuningCents);
    }
    if (!offsets) timingText.textContent = c.measured.latency ? `Measured: ${c.latencyMs} ms.` : '';
  }

  function tuningSentence(cents: number): string {
    const rounded = Math.round(cents);
    if (Math.abs(rounded) < 3) return 'All six strings heard. The guitar is at standard pitch.';
    return `All six strings heard. The guitar is about ${Math.abs(rounded)} cents ${rounded < 0 ? 'flat' : 'sharp'} overall; grading allows for that.`;
  }

  cleanup.push(
    mic.onStateChange(refresh),
    mic.onChunk((samples, time) => {
      if (noise) {
        for (const x of samples) noise.squares += x * x;
        noise.samples += samples.length;
        if (noise.samples >= 2 * mic.sampleRate) {
          const level = Math.sqrt(noise.squares / noise.samples);
          const gate = Math.min(0.2, Math.max(0.003, level * LISTEN.gateOverNoise));
          noise = null;
          calibration.update({
            noiseGate: gate,
            measured: { ...calibration.value.measured, noise: true },
          });
          analyser.noiseGate = gate;
          segmenter.setNoiseGate(gate);
          noiseText.textContent = `Measured. Gate set at ${(gate * 100).toFixed(1)}% level.`;
          noiseButton.disabled = false;
        }
        return;
      }
      for (const frame of analyser.push(samples, time)) {
        fill.style.width = `${Math.min(100, Math.sqrt(frame.level) * 140).toFixed(0)}%`;
        if (frame.midi !== null) {
          const nearest = Math.round(frame.midi);
          const cents = Math.round((frame.midi - nearest) * 100);
          tunerNote.textContent = soundingName(nearest);
          tunerCents.textContent =
            cents === 0 ? 'in tune' : `${Math.abs(cents)} cents ${cents < 0 ? 'flat' : 'sharp'}`;
          needle.style.left = `${50 + cents}%`;
          needle.classList.toggle('in-tune', Math.abs(cents) <= 5);
        }
        const events = segmenter.push(frame);
        for (const note of events.started) {
          if (!offsets || clock.state !== 'running') continue;
          const beat = clock.beatAt(note.onset);
          if (beat > -0.5 && beat < LISTEN.calibrationClicks - 0.5) {
            offsets.push(((beat - Math.round(beat)) * 60000) / clock.tempo);
          }
        }
        for (const note of events.ended) {
          const index = openStringFor(note.midi);
          if (index === null || note.duration < 0.2) continue;
          heardStrings.set(index, (note.midi - OPEN_STRINGS[index]!) * 100);
          chips[index]!.classList.add('is-heard');
          chips[index]!.textContent = `✓ ${STRING_NAMES[index]}`;
          if (heardStrings.size === OPEN_STRINGS.length) {
            const cents = median([...heardStrings.values()]);
            calibration.update({
              tuningCents: cents,
              measured: { ...calibration.value.measured, tuning: true },
            });
            tuningText.textContent = tuningSentence(cents);
          }
        }
      }
    }),
    player.onEnd((end) => {
      if (!offsets) return;
      const result = end.completed ? latencyFromOffsets(offsets) : null;
      offsets = null;
      timingButton.textContent = 'Calibrate timing';
      if (result === null) {
        timingText.textContent = end.completed
          ? 'Not enough notes were heard on the clicks. Try again, a little louder.'
          : '';
        return;
      }
      calibration.update({
        latencyMs: result,
        measured: { ...calibration.value.measured, latency: true },
      });
      timingText.textContent = `Measured: ${result} ms.`;
    }),
  );

  toggle.addEventListener('click', () => {
    if (mic.state === 'on') {
      mic.stop();
      calibration.update({ micEnabled: false });
      return;
    }
    void mic.start().then((state) => {
      calibration.update({ micEnabled: state === 'on' });
      // A real mic may run at a different sample rate than assumed before it opened.
      analyser = new FrameAnalyser(mic.sampleRate);
      analyser.noiseGate = calibration.value.noiseGate;
      segmenter = new Segmenter(calibration.value.noiseGate);
      refresh();
    });
  });
  noiseButton.addEventListener('click', () => {
    noise = { squares: 0, samples: 0 };
    noiseButton.disabled = true;
    noiseText.textContent = 'Listening… stay quiet.';
  });
  timingButton.addEventListener('click', () => {
    if (offsets) {
      player.stop();
      return;
    }
    offsets = [];
    timingText.textContent = 'Play a note on each of the louder clicks.';
    timingButton.textContent = 'Stop';
    clock.setTempo(LISTEN.calibrationBpm);
    void player.playClicks(LISTEN.calibrationClicks, 4);
  });

  document.title = 'Microphone setup · Malcotron';
  refresh();
  return {
    el,
    bottomEl: null,
    destroy() {
      if (offsets) player.stop();
      for (const fn of cleanup) fn();
    },
  };
}
