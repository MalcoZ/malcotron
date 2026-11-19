/**
 * Note check (`#/mic/notes`): ten notes named by string and fret, played one at
 * a time, each shown beside what the app heard. Ends with a diagnosis, a text
 * report to copy, and the audio to save.
 */
import { soundingName } from '../listen/feedback';
import { FrameAnalyser, type Frame } from '../listen/frames';
import {
  CHECK_TARGETS,
  describeTarget,
  diagnose,
  judge,
  noteWithOctave,
  report,
  type CheckResult,
} from '../listen/note-check';
import { Segmenter } from '../listen/segment';
import { encodeWav } from '../listen/wav';
import type { AppContext, View } from './context';
import { h } from './dom';

/** How long after the attack a note is judged (seconds). */
const LISTEN_FOR = 0.6;
/** Audio kept for saving, at most (seconds). */
const MAX_AUDIO = 180;

const MARK = { right: '✓', octave: '✗', harmonic: '✗', wrong: '✗', nothing: '–' } as const;
const VERDICT_TEXT = {
  right: 'heard right',
  octave: 'wrong octave',
  harmonic: 'heard an overtone',
  wrong: 'wrong note',
  nothing: 'nothing heard',
} as const;

export function createNoteCheckView(ctx: AppContext): View {
  const { mic, calibration } = ctx;
  const cleanup: (() => void)[] = [];
  document.title = 'Note check · Malcotron';

  const micButton = h('button', {
    type: 'button',
    className: 'btn btn-primary',
    id: 'check-mic',
    textContent: 'Turn on the mic',
  });
  const prompt = h('h2', { className: 'check-prompt', id: 'check-prompt' });
  const hint = h('p', { className: 'muted', id: 'check-hint' });
  const live = h('span', { className: 'tuner-note', id: 'check-live', textContent: '–' });
  const skip = h('button', {
    type: 'button',
    className: 'btn',
    id: 'check-skip',
    textContent: 'Skip this note',
  });
  const again = h('button', {
    type: 'button',
    className: 'btn',
    id: 'check-again',
    textContent: 'Start again',
  });
  const list = h('ol', { className: 'check-list', id: 'check-list' });
  const summary = h('div', { className: 'check-summary', id: 'check-summary', hidden: true });
  const copy = h('button', {
    type: 'button',
    className: 'btn btn-primary',
    id: 'check-copy',
    textContent: 'Copy the report',
  });
  const save = h('button', {
    type: 'button',
    className: 'btn',
    id: 'check-save',
    textContent: 'Save the audio',
  });
  const copied = h('span', { className: 'muted', id: 'check-copied' });
  const reportBox = h('textarea', {
    className: 'check-report',
    id: 'check-report',
    readOnly: true,
    rows: 8,
  });

  const card = h(
    'section',
    { className: 'card hero done' },
    h('p', { className: 'eyebrow', id: 'check-count' }),
    prompt,
    hint,
    h(
      'div',
      { className: 'row' },
      h('span', { className: 'muted', textContent: 'Hearing now:' }),
      live,
    ),
    h('div', { className: 'done-actions' }, micButton, skip, again),
  );
  summary.append(
    h('h3', { textContent: 'What the check found' }),
    h('ul', { id: 'check-diagnosis' }),
    h('div', { className: 'done-actions' }, copy, save, copied),
    h('p', {
      className: 'muted small',
      textContent:
        'The report is plain text: paste it into a message. The audio is saved as a WAV file on this computer; nothing is uploaded.',
    }),
    reportBox,
  );
  const el = h(
    'div',
    { className: 'home', id: 'note-check' },
    h(
      'div',
      { className: 'lesson-head' },
      h('a', { className: 'crumb', href: '#/mic', textContent: '‹ Mic setup' }),
      h('h2', { textContent: 'Note check' }),
      h('span', {}),
    ),
    h('p', {
      className: 'muted',
      textContent:
        'Play each note once and let it ring for a second. The app shows what it heard. Use the string and fret given, not the staff, so only the listening is being tested.',
    }),
    card,
    list,
    summary,
  );

  // --- State --------------------------------------------------------------------
  let results: CheckResult[] = [];
  let index = 0;
  /** The note being judged: its onset, once an attack has been heard. */
  let onset: number | null = null;
  /** Attacks before this time belong to the previous note. */
  let readyAfter = -Infinity;
  let latest = 0;
  const recent: Frame[] = [];
  let audio: Float32Array[] = [];
  let audioSamples = 0;
  let analyser = new FrameAnalyser(mic.sampleRate);
  let segmenter = new Segmenter(calibration.value.noiseGate);

  const setUp = () => {
    analyser = new FrameAnalyser(mic.sampleRate);
    analyser.noiseGate = calibration.value.noiseGate;
    analyser.setTuningOffsetCents(calibration.value.tuningCents);
    segmenter = new Segmenter(calibration.value.noiseGate);
  };

  const finished = () => index >= CHECK_TARGETS.length;

  function render(): void {
    const on = mic.state === 'on';
    micButton.hidden = on;
    micButton.disabled = mic.state === 'starting';
    skip.hidden = !on || finished();
    const counter = el.querySelector<HTMLElement>('#check-count')!;
    if (!on) {
      counter.textContent = 'Note check';
      prompt.textContent = 'Turn on the mic to start';
      hint.textContent =
        mic.state === 'denied'
          ? 'Mic access was refused. Allow it in the browser’s site settings, then try again.'
          : 'Ten notes, low to high, about a minute.';
    } else if (finished()) {
      counter.textContent = 'Done';
      prompt.textContent = 'Check complete';
      hint.textContent = 'The results are below.';
    } else {
      const t = CHECK_TARGETS[index]!;
      counter.textContent = `Note ${index + 1} of ${CHECK_TARGETS.length}`;
      prompt.textContent = `Play: ${describeTarget(t)}`;
      hint.textContent = onset === null ? 'Listening for the note…' : 'Hold it…';
    }
    list.replaceChildren(
      ...results.map((r) =>
        h(
          'li',
          { className: `check-row is-${r.verdict}` },
          h('span', { className: 'check-mark', textContent: MARK[r.verdict] }),
          h('span', { className: 'lesson-title', textContent: describeTarget(r.target) }),
          h('span', {
            className: 'check-heard',
            textContent:
              r.heard === null
                ? 'nothing heard'
                : `heard ${noteWithOctave(r.heard)} (wanted ${noteWithOctave(r.target.midi)})`,
          }),
          h('span', { className: 'lesson-state', textContent: VERDICT_TEXT[r.verdict] }),
        ),
      ),
    );
    summary.hidden = !finished();
    if (finished()) {
      el.querySelector('#check-diagnosis')!.replaceChildren(
        ...diagnose(results).map((line) => h('li', { textContent: line })),
      );
      reportBox.value = report(results, {
        sampleRate: mic.sampleRate,
        gate: calibration.value.noiseGate,
        tuningCents: calibration.value.tuningCents,
        userAgent: navigator.userAgent,
      });
      save.disabled = audioSamples === 0;
    }
  }

  function record(result: CheckResult): void {
    results.push(result);
    index++;
    onset = null;
    // Ignore the rest of this note: the next one needs its own attack.
    readyAfter = latest + 0.3;
    render();
    if (finished()) summary.scrollIntoView({ block: 'start' });
  }

  function judgeNow(): void {
    if (onset === null || finished()) return;
    const start = onset;
    record(
      judge(
        CHECK_TARGETS[index]!,
        recent.filter((f) => f.time >= start),
      ),
    );
  }

  cleanup.push(
    mic.onStateChange(() => {
      if (mic.state === 'on') setUp();
      render();
    }),
    mic.onChunk((samples, time) => {
      if (!finished() && audioSamples < MAX_AUDIO * mic.sampleRate) {
        audio.push(samples.slice());
        audioSamples += samples.length;
      }
      for (const frame of analyser.push(samples, time)) {
        latest = frame.time;
        recent.push(frame);
        while (recent.length && recent[0]!.time < frame.time - 2) recent.shift();
        live.textContent = frame.midi === null ? '–' : soundingName(frame.midi);
        const events = segmenter.push(frame);
        if (finished()) continue;
        if (onset === null) {
          const note = events.started.find((n) => n.onset >= readyAfter);
          if (note) {
            onset = note.onset;
            render();
          }
        } else if (
          frame.time >= onset + LISTEN_FOR ||
          events.ended.some((n) => n.onset >= onset!)
        ) {
          judgeNow();
        }
      }
    }),
  );

  micButton.addEventListener('click', () => {
    void mic.start().then((state) => {
      if (state === 'on') calibration.update({ micEnabled: true });
    });
  });
  skip.addEventListener('click', () => record(judge(CHECK_TARGETS[index]!, [])));
  again.addEventListener('click', () => {
    results = [];
    index = 0;
    onset = null;
    readyAfter = latest + 0.1;
    audio = [];
    audioSamples = 0;
    copied.textContent = '';
    render();
  });
  copy.addEventListener('click', () => {
    const fallback = () => {
      reportBox.select();
      copied.textContent = 'Select the text below and copy it.';
    };
    if (!navigator.clipboard) return fallback();
    navigator.clipboard.writeText(reportBox.value).then(() => {
      copied.textContent = 'Copied.';
    }, fallback);
  });
  save.addEventListener('click', () => {
    const samples = new Float32Array(audioSamples);
    let at = 0;
    for (const chunk of audio) {
      samples.set(chunk, at);
      at += chunk.length;
    }
    const url = URL.createObjectURL(
      new Blob([encodeWav(samples, mic.sampleRate) as BlobPart], { type: 'audio/wav' }),
    );
    h('a', { href: url, download: 'malcotron-note-check.wav' }).click();
    URL.revokeObjectURL(url);
    copied.textContent = `Saved ${(samples.length / mic.sampleRate).toFixed(1)} s as malcotron-note-check.wav.`;
  });

  setUp();
  render();
  if (calibration.value.micEnabled && mic.state === 'off') void mic.start();
  return {
    el,
    bottomEl: null,
    destroy() {
      for (const fn of cleanup) fn();
      if (mic.state === 'on') mic.stop();
    },
  };
}
