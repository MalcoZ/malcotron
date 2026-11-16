/**
 * The score with its controls: notation, playhead, Listen / Your turn, tempo,
 * metronome and Peek tab. Lessons and the piece screen both use it.
 */
import { clock } from '../audio/clock';
import { countInNumber } from '../audio/metronome';
import type { PlayMode } from '../audio/player';
import { FINGERING, LAYOUT, TEMPO, type FingeringLevel } from '../config';
import type { Piece } from '../content/types';
import { Playhead } from '../notation/playhead';
import { ScoreRenderer } from '../notation/renderer';
import type { AppContext } from './context';
import { h } from './dom';

const LEVEL_LABELS: Record<FingeringLevel, string> = {
  all: 'Every note',
  'first-of-bar': 'First of bar',
  none: 'Hidden',
};

export interface PanelConfig {
  piece: Piece;
  tempo: number;
  fingering: FingeringLevel;
  labels?: ReadonlyMap<string, string>;
  showTab: boolean;
  /** Offer "Your turn" (count-in, click, silent melody) and the metronome switch. */
  yourTurn: boolean;
  /** Offer the fingering-level control. */
  fingeringControl: boolean;
  /** Called when a Your turn pass runs to the end. */
  onTurnEnd?: () => void;
}

export class ScorePanel {
  /** The notation. Put it inside the scrolling area. */
  readonly scoreEl: HTMLDivElement;
  /** The control row. */
  readonly controlsEl: HTMLDivElement;
  readonly renderer: ScoreRenderer;
  readonly playhead: Playhead;

  private readonly ctx: AppContext;
  private config: PanelConfig | null = null;
  private fingering: FingeringLevel = FINGERING.defaultLevel;
  private soundLoaded = false;
  private destroyed = false;
  private readonly cleanup: (() => void)[] = [];
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly listenButton: HTMLButtonElement;
  private readonly turnButton: HTMLButtonElement;
  private readonly metronomeButton: HTMLButtonElement;
  private readonly tempoSlider: HTMLInputElement;
  private readonly tempoReadout: HTMLOutputElement;
  private readonly tabButton: HTMLButtonElement;
  private readonly levelField: HTMLLabelElement;
  private readonly levelSelect: HTMLSelectElement;
  private readonly countIn: HTMLSpanElement;

  /** @param scroller the element that scrolls when the score is taller than the window */
  constructor(ctx: AppContext, scroller: HTMLElement) {
    this.ctx = ctx;
    this.scoreEl = h('div', { className: 'systems', id: 'score' });
    this.scoreEl.setAttribute('role', 'img');
    this.renderer = new ScoreRenderer(this.scoreEl);
    this.playhead = new Playhead(this.renderer, clock, scroller);

    this.listenButton = h('button', {
      type: 'button',
      className: 'btn btn-primary play',
      id: 'play',
      disabled: true,
      textContent: 'Loading sound…',
    });
    this.turnButton = h('button', {
      type: 'button',
      className: 'btn play',
      id: 'turn',
      disabled: true,
      textContent: 'Your turn',
    });
    this.metronomeButton = h('button', { type: 'button', className: 'btn', id: 'metronome' });
    this.tempoSlider = h('input', {
      type: 'range',
      id: 'tempo',
      min: String(TEMPO.min),
      max: String(TEMPO.max),
      step: '1',
    });
    this.tempoSlider.setAttribute('aria-label', 'Tempo in beats per minute');
    this.tempoReadout = h('output', { className: 'tempo-readout', id: 'tempo-readout' });
    this.tempoReadout.htmlFor.add('tempo');
    this.tabButton = h('button', { type: 'button', className: 'btn', id: 'peek-tab' });
    this.levelSelect = h('select', { id: 'fingering-level' });
    for (const level of FINGERING.levels) {
      this.levelSelect.append(h('option', { value: level, textContent: LEVEL_LABELS[level] }));
    }
    this.levelField = h(
      'label',
      { className: 'field' },
      h('span', { textContent: 'Fingering' }),
      this.levelSelect,
    );
    this.countIn = h('span', { className: 'count-in', id: 'count-in' });
    this.countIn.setAttribute('aria-live', 'off');

    this.controlsEl = h(
      'div',
      { className: 'controls' },
      this.listenButton,
      this.turnButton,
      this.countIn,
      h(
        'div',
        { className: 'tempo' },
        h('span', { className: 'control-label', textContent: 'Tempo' }),
        this.tempoSlider,
        this.tempoReadout,
        h('span', { className: 'tempo-unit', textContent: 'BPM' }),
      ),
      this.metronomeButton,
      h('div', { className: 'spacer' }),
      this.levelField,
      this.tabButton,
    );
    this.controlsEl.setAttribute('role', 'toolbar');
    this.controlsEl.setAttribute('aria-label', 'Playback and display');

    const { player } = ctx;
    this.listenButton.addEventListener('click', () => this.run('listen'));
    this.turnButton.addEventListener('click', () => this.run('turn'));
    this.metronomeButton.addEventListener('click', () => this.toggleMetronome());
    this.tabButton.addEventListener('click', () => this.toggleTab());
    this.tempoSlider.addEventListener('input', () => this.setTempo(Number(this.tempoSlider.value)));
    this.levelSelect.addEventListener('change', () => {
      this.fingering = this.levelSelect.value as FingeringLevel;
      this.draw();
    });

    this.cleanup.push(
      player.onStateChange((playing) => {
        this.updateButtons();
        if (playing) this.playhead.start();
        else {
          this.playhead.clear();
          this.countIn.textContent = '';
          scroller.scrollTo({ top: 0 });
        }
      }),
      player.onEnd((end) => {
        if (end.mode === 'turn' && end.completed) this.config?.onTurnEnd?.();
      }),
      ctx.theme.onChange(() => this.draw()),
    );
    this.playhead.onFrame = (beat) => {
      const n = countInNumber(beat, clock.leadIn);
      const text = n === null ? '' : String(n);
      if (this.countIn.textContent !== text) this.countIn.textContent = text;
    };

    // Redraw when the score changes width. This debounce is UI housekeeping,
    // not musical timing, so a plain timer is fine here.
    let lastWidth = 0;
    const observer = new ResizeObserver(() => {
      const width = this.scoreEl.clientWidth;
      if (width === lastWidth || width === 0) return;
      const first = lastWidth === 0;
      lastWidth = width;
      clearTimeout(this.resizeTimer);
      if (first) this.draw();
      else this.resizeTimer = setTimeout(() => this.draw(), LAYOUT.resizeDebounceMs);
    });
    observer.observe(this.scoreEl);
    this.cleanup.push(() => observer.disconnect());

    void ctx.soundReady.then(
      () => {
        this.soundLoaded = true;
        this.updateButtons();
      },
      () => {
        this.listenButton.textContent = 'Sound failed to load';
      },
    );
    this.updateButtons();
  }

  /** Show a piece. Stops anything that is playing. */
  load(config: PanelConfig): void {
    this.config = config;
    this.fingering = config.fingering;
    this.levelSelect.value = config.fingering;
    this.levelField.hidden = !config.fingeringControl;
    this.turnButton.hidden = !config.yourTurn;
    this.metronomeButton.hidden = !config.yourTurn;
    this.ctx.player.load(config.piece, config.tempo);
    this.playhead.setTimeline(this.ctx.player.currentTimeline!);
    this.setTempo(config.tempo);
    this.renderer.setTabVisible(config.showTab);
    this.scoreEl.setAttribute('aria-label', `Notation: ${config.piece.title}`);
    this.updateButtons();
    this.draw();
  }

  /** Draw (or redraw) the score at the current size, theme and zoom. */
  draw(): void {
    const config = this.config;
    if (!config || this.destroyed || this.scoreEl.clientWidth === 0) return;
    const palette = this.ctx.theme.palette;
    this.renderer.render(config.piece, {
      zoom: this.ctx.zoom,
      fingeringLevel: this.fingering,
      labels: config.labels,
      colors: { ink: palette.ink, staff: palette.staff, background: palette.surface },
    });
    this.playhead.rendered();
  }

  /** Keyboard shortcuts (spec section 8). Returns true if the key was used. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.config) return false;
    if (event.code === 'Space') {
      if (!event.repeat) this.run('listen');
      return true;
    }
    switch (event.key.toLowerCase()) {
      case 't':
        if (!event.repeat) this.toggleTab();
        return true;
      case 'r':
        if (!this.config.yourTurn) return false;
        if (!event.repeat) this.run('turn');
        return true;
      case 'm':
        if (!this.config.yourTurn) return false;
        if (!event.repeat) this.toggleMetronome();
        return true;
      case 'arrowleft':
        this.setTempo(Number(this.tempoSlider.value) - 5);
        return true;
      case 'arrowright':
        this.setTempo(Number(this.tempoSlider.value) + 5);
        return true;
    }
    return false;
  }

  /** Start a mode, or stop if anything is playing. */
  run(mode: PlayMode): void {
    if (!this.soundLoaded || !this.config) return;
    void this.ctx.player.toggle(mode);
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.resizeTimer);
    this.ctx.player.unload();
    this.playhead.onFrame = null;
    this.playhead.clear();
    for (const fn of this.cleanup) fn();
  }

  private toggleTab(): void {
    this.renderer.setTabVisible(!this.renderer.isTabVisible);
    this.updateButtons();
    this.playhead.reveal();
  }

  private toggleMetronome(): void {
    this.ctx.player.metronomeOn = !this.ctx.player.metronomeOn;
    this.updateButtons();
  }

  private setTempo(bpm: number): void {
    this.tempoSlider.value = String(bpm); // the slider clamps to its range
    this.tempoReadout.textContent = this.tempoSlider.value;
    clock.setTempo(Number(this.tempoSlider.value));
  }

  private updateButtons(): void {
    const { player } = this.ctx;
    const playing = player.isPlaying;
    const mode = player.currentMode;
    if (this.soundLoaded) {
      this.listenButton.textContent = playing && mode === 'listen' ? 'Stop' : 'Listen';
      this.listenButton.disabled = playing && mode !== 'listen';
      this.turnButton.textContent = playing && mode === 'turn' ? 'Stop' : 'Your turn';
      this.turnButton.disabled = playing && mode !== 'turn';
    }
    const shown = this.renderer.isTabVisible;
    this.tabButton.textContent = shown ? 'Hide tab' : 'Peek tab';
    this.tabButton.setAttribute('aria-pressed', String(shown));
    this.tabButton.classList.toggle('is-on', shown);
    const click = player.metronomeOn;
    this.metronomeButton.textContent = click ? 'Click: on' : 'Click: off';
    this.metronomeButton.setAttribute('aria-pressed', String(click));
    this.metronomeButton.classList.toggle('is-on', click);
  }
}
