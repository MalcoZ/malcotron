/**
 * The app shell: header, the current screen, and the fixed bar under it.
 * Screens are chosen by the URL hash (src/ui/router.ts).
 */
import { clock } from '../audio/clock';
import { Player } from '../audio/player';
import { createClick, createGuitar, type GuitarTone } from '../audio/tones';
import { LAYOUT, STORAGE_KEYS, TONES, type ToneId } from '../config';
import { loadAllPieces } from '../content/loader';
import type { Piece } from '../content/types';
import { buildPiece } from '../content/validate';
import { loadCourse } from '../course/loader';
import { Progress } from '../course/progress';
import { Engine } from '../engine/engine';
import { CalibrationStore } from '../listen/calibration';
import { RealMic, SimulatedMic, type MicInput } from '../listen/mic';
import { simulateNotes, simulateTake, type SimulatedMistakes } from '../listen/simulate';
import { renderTake, type SynthNote, type SynthOptions } from '../listen/synth';
import { notationFontsReady } from '../notation/renderer';
import { createAboutDialog } from './about';
import type { AppContext, View } from './context';
import { h } from './dom';
import { createHome } from './home';
import { createLessonDone, createLessonView } from './lesson-view';
import { createMicView } from './mic-view';
import { createNoteCheckView } from './note-check-view';
import { createPieceView } from './piece-view';
import { createSessionView } from './session-view';
import { parseRoute } from './router';
import { ThemeController } from './theme';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'range';
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function startApp(root: HTMLElement): void {
  const theme = new ThemeController();
  const store = storage();
  const progress = new Progress(store);
  const calibration = new CalibrationStore(store);
  const engine = new Engine(store);
  let mic: MicInput = new RealMic();

  // Tones are created (and their samples fetched) only when first chosen.
  const tones = new Map<ToneId, GuitarTone>();
  const toneFor = (id: ToneId): GuitarTone => {
    let tone = tones.get(id);
    if (!tone) tones.set(id, (tone = createGuitar(id)));
    return tone;
  };
  let savedTone: ToneId = 'nylon';
  try {
    const saved = JSON.parse(store?.getItem(STORAGE_KEYS.settings) ?? '{}') as { tone?: string };
    if (TONES.some((t) => t.id === saved.tone)) savedTone = saved.tone as ToneId;
  } catch {
    // Unreadable settings: use the defaults.
  }
  const tone = toneFor(savedTone);
  const player = new Player(tone, createClick());

  // --- Header ----------------------------------------------------------------
  const themeButton = h('button', {
    type: 'button',
    className: 'btn btn-quiet',
    id: 'theme-toggle',
  });
  const zoomSelect = h('select', { id: 'zoom-select' });
  const zoomSteps = Math.round((LAYOUT.zoomMax - LAYOUT.zoomMin) / LAYOUT.zoomStep);
  for (let i = 0; i <= zoomSteps; i++) {
    const value = LAYOUT.zoomMin + i * LAYOUT.zoomStep;
    zoomSelect.append(
      h('option', { value: value.toFixed(2), textContent: `${Math.round(value * 100)}%` }),
    );
  }
  zoomSelect.value = LAYOUT.zoomDefault.toFixed(2);
  const toneSelect = h('select', { id: 'tone-select' });
  for (const t of TONES) toneSelect.append(h('option', { value: t.id, textContent: t.label }));
  toneSelect.value = savedTone;
  const micLink = h('button', {
    type: 'button',
    className: 'btn btn-quiet mic-link',
    id: 'mic-link',
  });
  const micSetup = h('a', {
    className: 'header-link',
    id: 'mic-setup',
    href: '#/mic',
    textContent: 'Mic setup',
  });
  const header = h(
    'header',
    { className: 'app-header' },
    h(
      'h1',
      { className: 'app-name' },
      h('a', { href: '#/', id: 'home-link', textContent: 'Malcotron' }),
    ),
    h('div', { className: 'spacer' }),
    micLink,
    micSetup,
    h('label', { className: 'header-field' }, h('span', { textContent: 'Tone' }), toneSelect),
    h('label', { className: 'header-field' }, h('span', { textContent: 'Staff size' }), zoomSelect),
    themeButton,
  );

  const narrowNote = h('p', {
    className: 'narrow-note',
    id: 'narrow-note',
    hidden: true,
    textContent: 'Malcotron works best on a larger screen (at least 1024 px wide).',
  });
  const viewSlot = h('div', { className: 'view-slot' });
  const main = h('main', { className: 'score-area', id: 'score-area' }, narrowNote, viewSlot);
  const bottom = h('div', { className: 'bottom-bar', id: 'bottom-bar' });

  const about = createAboutDialog(() => {
    progress.reset();
    engine.reset();
    ctx.session = null;
    about.close();
    if (location.hash === '' || location.hash === '#/') show();
    else location.hash = '#/';
  });
  const aboutButton = h('button', {
    type: 'button',
    className: 'link',
    id: 'about-link',
    textContent: 'About and credits',
  });
  aboutButton.addEventListener('click', () => about.showModal());
  const footer = h(
    'footer',
    { className: 'app-footer' },
    h('span', { className: 'keys', id: 'key-hints' }),
    aboutButton,
  );

  root.replaceChildren(header, main, bottom, footer, about);

  // --- Screens -----------------------------------------------------------------
  const ctx: AppContext = {
    theme,
    player,
    soundReady: tone.loaded,
    course: loadCourse(),
    pieces: loadAllPieces(),
    progress,
    get mic() {
      return mic;
    },
    calibration,
    engine,
    session: null,
    zoom: LAYOUT.zoomDefault,
    navigate(path) {
      const hash = `#${path}`;
      if (location.hash === hash) show();
      else location.hash = hash;
    },
  };

  let view: View | null = null;
  /** A piece shown through the debug hook rather than a route. */
  let adHocPiece: Piece | null = null;

  /** Replace the screen. The old one is torn down before the new one is built, as they share the player. */
  function mount(create: () => View, hints: string): void {
    view?.destroy();
    const next = create();
    view = next;
    viewSlot.replaceChildren(next.el);
    bottom.replaceChildren(...(next.bottomEl ? [next.bottomEl] : []));
    bottom.hidden = next.bottomEl === null;
    footer.querySelector('#key-hints')!.textContent = hints;
    main.scrollTop = 0;
  }

  function show(): void {
    const route = parseRoute(location.hash);
    adHocPiece = null;
    if (route.name === 'lesson' || route.name === 'lesson-done') {
      const lesson = ctx.course.lessons.find((l) => l.id === route.id);
      if (lesson && route.name === 'lesson-done') {
        mount(() => createLessonDone(ctx, lesson), 'Enter: next lesson');
        return;
      }
      if (lesson && route.name === 'lesson') {
        const step = lesson.steps[Math.min(route.step, lesson.steps.length - 1)]!;
        const playable = step.type === 'practice' || step.type === 'check';
        mount(
          () => createLessonView(ctx, lesson, route.step, main),
          !step.piece
            ? 'Enter: next step'
            : playable
              ? 'Space: listen · R: your turn · M: click · T: peek at tab · Enter: next step'
              : 'Space: listen · T: peek at tab · Enter: next step',
        );
        return;
      }
    }
    if (route.name === 'session') {
      mount(
        () => createSessionView(ctx, main),
        'Space: listen · R: your turn · M: click · T: peek at tab · Enter: next',
      );
      return;
    }
    if (route.name === 'note-check') {
      mount(() => createNoteCheckView(ctx), '');
      return;
    }
    if (route.name === 'mic') {
      mount(() => createMicView(ctx), '');
      return;
    }
    if (route.name === 'piece') {
      const piece = ctx.pieces.find((p) => p.id === route.id);
      if (piece) {
        mount(
          () => createPieceView(ctx, piece, main),
          'Space: listen · R: your turn · M: click · L: loop · T: peek at tab · ←/→: tempo · click a bar to start there',
        );
        return;
      }
    }
    document.title = 'Malcotron';
    mount(() => createHome(ctx), '');
  }

  // --- Wiring ------------------------------------------------------------------------
  function updateThemeButton(): void {
    const next = theme.theme === 'dark' ? 'light' : 'dark';
    themeButton.textContent = next === 'dark' ? 'Dark theme' : 'Light theme';
    themeButton.setAttribute('aria-label', `Switch to ${next} theme`);
  }
  themeButton.addEventListener('click', () => theme.toggle());
  theme.onChange(updateThemeButton);
  updateThemeButton();

  toneSelect.addEventListener('change', () => {
    const next = toneFor(toneSelect.value as ToneId);
    player.stop();
    player.setTone(next);
    ctx.soundReady = next.loaded;
    root.dataset.sound = 'loading';
    void next.loaded.then(() => {
      if (player.currentTone === next) root.dataset.sound = 'ready';
    });
    view?.panel?.watchSound();
    try {
      store?.setItem(STORAGE_KEYS.settings, JSON.stringify({ tone: next.id }));
    } catch {
      // The choice lasts for this visit.
    }
  });

  function updateMicLink(): void {
    const on = calibration.value.micEnabled;
    const live = mic.state === 'on';
    micLink.textContent = on ? 'Mic: on' : 'Mic: off';
    micLink.classList.toggle('is-on', on);
    micLink.classList.toggle('is-live', live);
    micLink.setAttribute('aria-pressed', String(on));
    micLink.title = on
      ? live
        ? 'The mic is listening now. Click to turn it off.'
        : 'The mic listens only during Your turn. Click to turn it off.'
      : 'Click to let the app listen while you play.';
  }
  // The header button turns the mic on and off, like any site that uses one.
  micLink.addEventListener('click', () => {
    if (calibration.value.micEnabled) {
      mic.stop();
      calibration.update({ micEnabled: false });
      return;
    }
    void mic.start().then((state) => {
      calibration.update({ micEnabled: state === 'on' });
      const onMicScreen = parseRoute(location.hash).name === 'mic';
      // Permission is settled. Away from the setup screen, let go until a take needs it.
      if (state === 'on' && !onMicScreen) mic.stop();
      // If it could not be opened, the setup screen says why.
      if (state !== 'on' && !onMicScreen) ctx.navigate('/mic');
    });
  });
  mic.onStateChange(updateMicLink);
  calibration.onChange(updateMicLink);
  updateMicLink();

  zoomSelect.addEventListener('change', () => {
    ctx.zoom = Number(zoomSelect.value);
    view?.redraw?.();
  });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || about.open) return;
    if (isTypingTarget(event.target)) return;
    if (view?.handleKey?.(event)) event.preventDefault();
  });
  // A focused button would also "click" when Space is released; the keydown above already acted.
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement && !about.open) {
      event.preventDefault();
    }
  });

  const narrow = window.matchMedia(`(max-width: ${LAYOUT.minSupportedWidth - 1}px)`);
  const updateNarrow = () => (narrowNote.hidden = !narrow.matches);
  narrow.addEventListener('change', updateNarrow);
  updateNarrow();

  window.addEventListener('hashchange', show);

  // Notation needs its fonts before the first draw.
  void notationFontsReady().then(() => {
    show();
    root.dataset.ready = 'true';
  });
  tone.loaded.then(
    () => (root.dataset.sound = 'ready'),
    () => (root.dataset.sound = 'failed'),
  );

  // For end-to-end tests and debugging in the console. `show` draws any piece
  // given as content JSON, after validating it.
  const debug = {
    player,
    clock,
    theme,
    progress,
    engine,
    course: ctx.course,
    get panel() {
      return view?.panel ?? null;
    },
    get renderer() {
      return view?.panel?.renderer ?? null;
    },
    get playhead() {
      return view?.panel?.playhead ?? null;
    },
    show(raw: { id: string }) {
      const piece = buildPiece(raw, `${raw.id}.json`);
      adHocPiece = piece;
      mount(() => createPieceView(ctx, piece, main), '');
    },
    get adHocPiece() {
      return adHocPiece;
    },
    calibration,
    get mic() {
      return mic;
    },
    /**
     * Replace the mic with a simulated learner who plays each Your turn pass
     * into the real listening pipeline, with the mistakes given.
     */
    simulateLearner(mistakes: SimulatedMistakes = {}) {
      const sim = new SimulatedMic(clock.sampleRate);
      mic = sim;
      sim.onStateChange(updateMicLink);
      calibration.update({ micEnabled: true });
      debug.mistakes = mistakes;
      debug.simulatedMic = sim;
      player.onStateChange((playing) => {
        if (playing && player.currentMode === 'turn' && player.currentTimeline && mic === sim) {
          simulateTake(sim, clock, player.currentTimeline, debug.mistakes);
        }
      });
      return sim;
    },
    /** With a simulated mic: play these notes (on the beat grid) during the current run. */
    simulateNotes(notes: { beat: number; midi: number; durationBeats: number }[], lateMs = 0) {
      if (debug.simulatedMic) simulateNotes(debug.simulatedMic, clock, notes, lateMs);
    },
    /** With a simulated mic: deliver a synthesized take at once (times in seconds). */
    feedInstant(notes: SynthNote[], seconds: number, options: SynthOptions = {}) {
      const sim = debug.simulatedMic;
      if (!sim) return;
      const samples = renderTake(notes, sim.sampleRate, seconds, options);
      for (let i = 0; i + 512 <= samples.length; i += 512) {
        sim.feed(samples.subarray(i, i + 512), i / sim.sampleRate);
      }
    },
    mistakes: {} as SimulatedMistakes,
    simulatedMic: null as SimulatedMic | null,
  };
  Object.assign(window, { malcotron: debug });
}
