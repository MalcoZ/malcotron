/**
 * The M0 app shell: one page with a header, a dev-only piece picker, the score
 * and a control row (Play/Stop, tempo, Peek tab, fingering level).
 */
import { clock } from '../audio/clock';
import { Player } from '../audio/player';
import { createNylonGuitar } from '../audio/tones';
import { FINGERING, LAYOUT, TEMPO, type FingeringLevel } from '../config';
import { loadAllPieces } from '../content/loader';
import type { Piece } from '../content/types';
import { Playhead } from '../notation/playhead';
import { notationFontsReady, ScoreRenderer } from '../notation/renderer';
import { createAboutDialog } from './about';
import { h } from './dom';
import { ThemeController } from './theme';

const LEVEL_LABELS: Record<FingeringLevel, string> = {
  all: 'Every note',
  'first-of-bar': 'First of bar',
  none: 'Hidden',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'range';
}

export function startApp(root: HTMLElement): void {
  const theme = new ThemeController();
  const pieces = loadAllPieces();

  // --- State -----------------------------------------------------------------
  const requested = new URLSearchParams(location.search).get('piece');
  let piece: Piece = pieces.find((p) => p.id === requested) ?? pieces[0]!;
  let zoom: number = LAYOUT.zoomDefault;
  let fingeringLevel: FingeringLevel = FINGERING.defaultLevel;
  let fontsReady = false;

  // --- Header ----------------------------------------------------------------
  const themeButton = h('button', {
    type: 'button',
    className: 'btn btn-quiet',
    id: 'theme-toggle',
  });
  const header = h(
    'header',
    { className: 'app-header' },
    h('h1', { className: 'app-name', textContent: 'Malcotron' }),
    themeButton,
  );

  // --- Dev bar: piece picker and staff zoom ------------------------------------
  const pieceSelect = h('select', { id: 'piece-select' });
  for (const p of pieces) {
    pieceSelect.append(h('option', { value: p.id, textContent: p.title }));
  }
  pieceSelect.value = piece.id;
  const zoomSelect = h('select', { id: 'zoom-select' });
  const zoomSteps = Math.round((LAYOUT.zoomMax - LAYOUT.zoomMin) / LAYOUT.zoomStep);
  for (let i = 0; i <= zoomSteps; i++) {
    const value = LAYOUT.zoomMin + i * LAYOUT.zoomStep;
    zoomSelect.append(
      h('option', { value: value.toFixed(2), textContent: `${Math.round(value * 100)}%` }),
    );
  }
  zoomSelect.value = zoom.toFixed(2);
  const devBar = h(
    'div',
    { className: 'dev-bar' },
    h('span', { className: 'dev-tag', textContent: 'Dev' }),
    h('label', {}, h('span', { textContent: 'Piece' }), pieceSelect),
    h('label', {}, h('span', { textContent: 'Staff size' }), zoomSelect),
  );

  // --- Score -------------------------------------------------------------------
  const narrowNote = h('p', {
    className: 'narrow-note',
    id: 'narrow-note',
    hidden: true,
    textContent: 'Malcotron works best on a larger screen (at least 1024 px wide).',
  });
  const titleEl = h('h2', { className: 'piece-title' });
  const composerEl = h('p', { className: 'piece-composer' });
  const metaEl = h('p', { className: 'piece-meta' });
  const systemsEl = h('div', { className: 'systems', id: 'score' });
  systemsEl.setAttribute('role', 'img');
  const sheet = h(
    'div',
    { className: 'sheet' },
    h('div', { className: 'piece-head' }, h('div', {}, titleEl, composerEl), metaEl),
    systemsEl,
  );
  const scoreArea = h('main', { className: 'score-area', id: 'score-area' }, narrowNote, sheet);

  // --- Control row ---------------------------------------------------------------
  const playButton = h('button', {
    type: 'button',
    className: 'btn btn-primary play',
    id: 'play',
    disabled: true,
    textContent: 'Loading sound…',
  });
  const tempoSlider = h('input', {
    type: 'range',
    id: 'tempo',
    min: String(TEMPO.min),
    max: String(TEMPO.max),
    step: '1',
  });
  tempoSlider.setAttribute('aria-label', 'Tempo in beats per minute');
  const tempoReadout = h('output', { className: 'tempo-readout', id: 'tempo-readout' });
  tempoReadout.htmlFor.add('tempo');
  const tabButton = h('button', { type: 'button', className: 'btn', id: 'peek-tab' });
  const levelSelect = h('select', { id: 'fingering-level' });
  for (const level of FINGERING.levels) {
    levelSelect.append(h('option', { value: level, textContent: LEVEL_LABELS[level] }));
  }
  levelSelect.value = fingeringLevel;

  const controls = h(
    'div',
    { className: 'controls' },
    playButton,
    h(
      'div',
      { className: 'tempo' },
      h('span', { className: 'control-label', textContent: 'Tempo' }),
      tempoSlider,
      tempoReadout,
      h('span', { className: 'tempo-unit', textContent: 'BPM' }),
    ),
    h('div', { className: 'spacer' }),
    h('label', { className: 'field' }, h('span', { textContent: 'Fingering' }), levelSelect),
    tabButton,
  );
  controls.setAttribute('role', 'toolbar');
  controls.setAttribute('aria-label', 'Playback and display');

  // --- Footer ----------------------------------------------------------------------
  const about = createAboutDialog();
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
    h('span', {
      className: 'keys',
      textContent: 'Space: play or stop · T: peek at tab',
    }),
    aboutButton,
  );

  root.replaceChildren(header, devBar, scoreArea, controls, footer, about);

  // --- Wiring ------------------------------------------------------------------------
  const renderer = new ScoreRenderer(systemsEl);
  const tone = createNylonGuitar();
  const player = new Player(tone);
  const playhead = new Playhead(renderer, clock, scoreArea);

  function draw(): void {
    if (!fontsReady) return;
    const palette = theme.palette;
    renderer.render(piece, {
      zoom,
      fingeringLevel,
      colors: { ink: palette.ink, staff: palette.staff, background: palette.surface },
    });
    playhead.rendered();
  }

  function updateThemeButton(): void {
    const next = theme.theme === 'dark' ? 'light' : 'dark';
    themeButton.textContent = next === 'dark' ? 'Dark theme' : 'Light theme';
    themeButton.setAttribute('aria-label', `Switch to ${next} theme`);
  }

  function updateTabButton(): void {
    const shown = renderer.isTabVisible;
    tabButton.textContent = shown ? 'Hide tab' : 'Peek tab';
    tabButton.setAttribute('aria-pressed', String(shown));
    tabButton.classList.toggle('is-on', shown);
  }

  function updatePlayButton(): void {
    if (playButton.disabled) return;
    playButton.textContent = player.isPlaying ? 'Stop' : 'Play';
    playButton.classList.toggle('is-playing', player.isPlaying);
  }

  function setTempo(bpm: number): void {
    tempoSlider.value = String(bpm);
    tempoReadout.textContent = tempoSlider.value;
    clock.setTempo(Number(tempoSlider.value));
  }

  function selectPiece(next: Piece): void {
    piece = next;
    player.load(piece, piece.suggestedTempo);
    playhead.setTimeline(player.currentTimeline!);
    setTempo(piece.suggestedTempo);
    titleEl.textContent = piece.title;
    composerEl.textContent = piece.composer;
    metaEl.textContent = `Key of ${piece.key} · ${piece.time}`;
    systemsEl.setAttribute('aria-label', `Notation: ${piece.title}`);
    document.title = `${piece.title} · Malcotron`;
    scoreArea.scrollTop = 0;
    draw();
  }

  function toggleTab(): void {
    renderer.setTabVisible(!renderer.isTabVisible);
    updateTabButton();
  }

  function togglePlay(): void {
    if (playButton.disabled) return;
    void player.toggle();
  }

  themeButton.addEventListener('click', () => theme.toggle());
  theme.onChange(() => {
    updateThemeButton();
    draw();
  });
  pieceSelect.addEventListener('change', () => {
    const next = pieces.find((p) => p.id === pieceSelect.value);
    if (next) selectPiece(next);
  });
  zoomSelect.addEventListener('change', () => {
    zoom = Number(zoomSelect.value);
    draw();
  });
  levelSelect.addEventListener('change', () => {
    fingeringLevel = levelSelect.value as FingeringLevel;
    draw();
  });
  tempoSlider.addEventListener('input', () => setTempo(Number(tempoSlider.value)));
  tabButton.addEventListener('click', toggleTab);
  playButton.addEventListener('click', togglePlay);

  player.onStateChange((playing) => {
    updatePlayButton();
    if (playing) playhead.start();
    else {
      playhead.clear();
      scoreArea.scrollTo({ top: 0 });
    }
  });

  // Keyboard: Space plays or stops, T peeks at tab (spec section 8).
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || about.open) return;
    if (isTypingTarget(event.target)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) togglePlay();
    } else if (event.key === 't' || event.key === 'T') {
      event.preventDefault();
      if (!event.repeat) toggleTab();
    }
  });
  // A focused button would also "click" when Space is released; the keydown above already acted.
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement && !about.open) {
      event.preventDefault();
    }
  });

  // Redraw when the score area changes width. This debounce is UI housekeeping,
  // not musical timing, so a plain timer is fine here.
  let lastWidth = 0;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  new ResizeObserver(() => {
    const width = systemsEl.clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, LAYOUT.resizeDebounceMs);
  }).observe(systemsEl);

  const narrow = window.matchMedia(`(max-width: ${LAYOUT.minSupportedWidth - 1}px)`);
  const updateNarrow = () => (narrowNote.hidden = !narrow.matches);
  narrow.addEventListener('change', updateNarrow);
  updateNarrow();

  updateThemeButton();
  updateTabButton();
  selectPiece(piece);

  void notationFontsReady().then(() => {
    fontsReady = true;
    lastWidth = systemsEl.clientWidth;
    draw();
    root.dataset.ready = 'true';
  });

  tone.loaded.then(
    () => {
      playButton.disabled = false;
      updatePlayButton();
      root.dataset.sound = 'ready';
    },
    () => {
      playButton.textContent = 'Sound failed to load';
      root.dataset.sound = 'failed';
    },
  );

  // For end-to-end tests and debugging in the console.
  Object.assign(window, { malcotron: { renderer, player, clock, playhead, theme } });
}
