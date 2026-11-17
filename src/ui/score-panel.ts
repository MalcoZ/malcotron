/**
 * The score with its controls: notation, playhead, Listen / Your turn, tempo,
 * metronome, loop and Peek tab, and the result of a take (graded by the mic,
 * or self-checked without one). Lessons and the piece screen both use it.
 */
import { clock } from '../audio/clock';
import { countInNumber, pulsePhase, type Subdivision } from '../audio/metronome';
import type { PlayMode } from '../audio/player';
import { FINGERING, LAYOUT, TEMPO, type FingeringLevel } from '../config';
import { fracToNumber } from '../content/music';
import type { Piece } from '../content/types';
import type { SelfCheck } from '../course/progress';
import { feedbackFor, soundingName } from '../listen/feedback';
import { flipGrade, replayNotes, summarise, type NoteGrade } from '../listen/grade';
import { TakeListener, type TakeResult } from '../listen/listener';
import { Playhead } from '../notation/playhead';
import { handleKey, ScoreRenderer } from '../notation/renderer';
import type { AppContext } from './context';
import { h } from './dom';

const LEVEL_LABELS: Record<FingeringLevel, string> = {
  all: 'Every note',
  'first-of-bar': 'First of bar',
  none: 'Hidden',
};

const SUBDIVISIONS: [Subdivision, string][] = [
  [1, 'Beats'],
  [2, 'Eighths'],
  [3, 'Triplets'],
  [4, 'Sixteenths'],
];

/** The mark shown with each grade, so colour is never the only signal (spec section 8). */
const MARKS = { green: '✓', amber: '◷', red: '✕' } as const;

export interface TurnOutcome {
  /** Share of notes with the right pitch, when the mic graded the take. */
  accuracy: number | null;
  /** The learner's own answer, when there was no mic. */
  selfCheck: SelfCheck | null;
}

export interface PanelConfig {
  piece: Piece;
  tempo: number;
  fingering: FingeringLevel;
  labels?: ReadonlyMap<string, string>;
  showTab: boolean;
  /** Offer "Your turn" (count-in, click, silent melody), the metronome and loop controls. */
  yourTurn: boolean;
  /** Offer the fingering-level control. */
  fingeringControl: boolean;
  /**
   * How takes count for the learning engine: `scheduled` work (lessons and
   * sessions) moves the review schedule; `free` practice only updates stats.
   */
  practice: 'scheduled' | 'free';
  /** Track the piece itself as a skill (pieces, not exercises). */
  trackPiece?: boolean;
  /** Called when a take has a result: a grade, or the learner's own answer. */
  onOutcome?: (outcome: TurnOutcome) => void;
}

export class ScorePanel {
  /** The notation. Put it inside the scrolling area. */
  readonly scoreEl: HTMLDivElement;
  /** The control row. */
  readonly controlsEl: HTMLDivElement;
  /** Where the result of a take appears. Put it under the score. */
  readonly resultEl: HTMLDivElement;
  readonly renderer: ScoreRenderer;
  readonly playhead: Playhead;
  /** The last graded take, if any. */
  lastTake: TakeResult | null = null;

  private readonly ctx: AppContext;
  private config: PanelConfig | null = null;
  private fingering: FingeringLevel = FINGERING.defaultLevel;
  private soundLoaded = false;
  private destroyed = false;
  private listener: TakeListener | null = null;
  private grades = new Map<string, NoteGrade>();
  private selection: { first: number; last: number } | null = null;
  private dragFrom: number | null = null;
  /** Takes of the loaded piece so far: a retry can earn Hard at best (spec section 4). */
  private takes = 0;
  private readonly cleanup: (() => void)[] = [];
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly listenButton: HTMLButtonElement;
  private readonly turnButton: HTMLButtonElement;
  private readonly metronomeButton: HTMLButtonElement;
  private readonly subdivisionSelect: HTMLSelectElement;
  private readonly loopButton: HTMLButtonElement;
  private readonly tempoSlider: HTMLInputElement;
  private readonly tempoReadout: HTMLOutputElement;
  private readonly tabButton: HTMLButtonElement;
  private readonly levelField: HTMLLabelElement;
  private readonly levelSelect: HTMLSelectElement;
  private readonly countIn: HTMLSpanElement;
  private readonly pulse: HTMLSpanElement;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** @param scroller the element that scrolls when the score is taller than the window */
  constructor(ctx: AppContext, scroller: HTMLElement) {
    this.ctx = ctx;
    this.scoreEl = h('div', { className: 'systems', id: 'score' });
    this.scoreEl.setAttribute('role', 'img');
    this.resultEl = h('div', { className: 'take-result', id: 'take-result', hidden: true });
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
    this.subdivisionSelect = h('select', { id: 'subdivision' });
    this.subdivisionSelect.setAttribute('aria-label', 'What the metronome clicks');
    for (const [value, label] of SUBDIVISIONS) {
      this.subdivisionSelect.append(h('option', { value: String(value), textContent: label }));
    }
    this.loopButton = h('button', { type: 'button', className: 'btn', id: 'loop' });
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
    this.levelSelect.setAttribute('aria-label', 'Fingering markers');
    this.levelSelect.title = 'Fingering markers';
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
    this.pulse = h('span', { className: 'pulse', id: 'pulse' });
    this.pulse.setAttribute('aria-hidden', 'true');

    this.controlsEl = h(
      'div',
      { className: 'controls' },
      this.listenButton,
      this.turnButton,
      h('span', { className: 'beat-display' }, this.pulse, this.countIn),
      h(
        'div',
        { className: 'tempo' },
        h('span', { className: 'control-label', textContent: 'Tempo' }),
        this.tempoSlider,
        this.tempoReadout,
        h('span', { className: 'tempo-unit', textContent: 'BPM' }),
      ),
      this.metronomeButton,
      this.subdivisionSelect,
      this.loopButton,
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
    this.loopButton.addEventListener('click', () => this.toggleLoop());
    this.tabButton.addEventListener('click', () => this.toggleTab());
    this.tempoSlider.addEventListener('input', () => this.setTempo(Number(this.tempoSlider.value)));
    this.subdivisionSelect.addEventListener('change', () => {
      player.subdivision = Number(this.subdivisionSelect.value) as Subdivision;
    });
    this.levelSelect.addEventListener('change', () => {
      this.fingering = this.levelSelect.value as FingeringLevel;
      this.draw();
    });

    // Select bars by clicking one, or dragging across several (spec section 6).
    this.scoreEl.addEventListener('pointerdown', (event) => {
      this.dragFrom = this.barUnder(event);
    });
    this.scoreEl.addEventListener('pointerup', (event) => {
      const to = this.barUnder(event);
      const from = this.dragFrom;
      this.dragFrom = null;
      if (from === null || to === null || !this.config?.yourTurn) return;
      const same = this.selection?.first === from && this.selection?.last === to && from === to;
      this.select(same ? null : { first: Math.min(from, to), last: Math.max(from, to) });
    });

    this.cleanup.push(
      player.onStateChange((playing) => {
        this.updateButtons();
        if (playing) {
          this.playhead.start();
        } else {
          this.playhead.clear();
          this.countIn.textContent = '';
          this.pulse.style.opacity = '0';
          scroller.scrollTo({ top: 0 });
        }
      }),
      player.onEnd((end) => {
        if (end.mode !== 'turn') return;
        const listener = this.listener;
        this.listener = null;
        // The take is over: let go of the mic until the next one.
        if (listener) this.ctx.mic.stop();
        if (!end.completed) {
          listener?.cancel();
          this.clearGrades();
          return;
        }
        if (listener) this.showGrade(listener.finish());
        else this.showSelfCheck();
      }),
      ctx.theme.onChange(() => this.draw()),
    );
    this.playhead.onFrame = (beat) => this.onFrame(beat);

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

    this.watchSound();
    this.updateButtons();
  }

  /** Wait for the current tone's samples (again after the tone is changed). */
  watchSound(): void {
    const ready = this.ctx.soundReady;
    this.soundLoaded = false;
    void ready.then(
      () => {
        if (this.ctx.soundReady !== ready) return;
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
    for (const el of [
      this.turnButton,
      this.metronomeButton,
      this.subdivisionSelect,
      this.loopButton,
    ]) {
      el.hidden = !config.yourTurn;
    }
    this.ctx.player.load(config.piece, config.tempo);
    this.subdivisionSelect.value = String(this.ctx.player.subdivision);
    this.playhead.setTimeline(this.ctx.player.currentTimeline!);
    this.setTempo(config.tempo);
    this.renderer.setTabVisible(config.showTab);
    this.scoreEl.setAttribute('aria-label', `Notation: ${config.piece.title}`);
    this.selection = null;
    this.takes = 0;
    this.clearGrades();
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
    // The notation's elements are new: put the grades and the selection back.
    this.paintGrades();
    this.paintSelection();
  }

  /** Keyboard shortcuts (spec section 8). Returns true if the key was used. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.config) return false;
    if (event.code === 'Space') {
      if (!event.repeat) this.run('listen');
      return true;
    }
    const practice = this.config.yourTurn;
    switch (event.key.toLowerCase()) {
      case 't':
        if (!event.repeat) this.toggleTab();
        return true;
      case 'r':
        if (!practice) return false;
        if (!event.repeat) this.run('turn');
        return true;
      case 'm':
        if (!practice) return false;
        if (!event.repeat) this.toggleMetronome();
        return true;
      case 'l':
        if (!practice) return false;
        if (!event.repeat) this.toggleLoop();
        return true;
      case 'escape':
        if (!this.selection) return false;
        this.select(null);
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
    const { player } = this.ctx;
    if (player.isPlaying) {
      player.stop();
      return;
    }
    if (mode === 'turn') void this.startTurn();
    else if (mode === 'heard' && this.lastTake) {
      void player.play('heard', replayNotes(this.lastTake.grade, clock.tempo));
    } else void player.play('listen');
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.resizeTimer);
    if (this.listener) {
      this.listener.cancel();
      this.ctx.mic.stop();
    }
    this.ctx.player.unload();
    this.playhead.onFrame = null;
    this.playhead.clear();
    for (const fn of this.cleanup) fn();
  }

  // --- A take ---------------------------------------------------------------------

  private async startTurn(): Promise<void> {
    const { player, mic, calibration } = this.ctx;
    const config = this.config!;
    this.clearGrades();
    let listening = false;
    if (calibration.value.micEnabled) {
      // The button press is the user gesture the browser needs to open the mic.
      listening = (mic.state === 'on' ? 'on' : await mic.start()) === 'on';
    }
    if (this.destroyed || this.config !== config) return;
    await player.play('turn');
    if (!listening || !player.isPlaying || player.currentMode !== 'turn') return;
    const listener = new TakeListener(
      mic,
      clock,
      player.currentTimeline!,
      config.piece,
      calibration.value,
    );
    listener.onLive = (grade) => {
      this.grades.set(handleKey(grade.expected.barIndex, grade.expected.noteIndex), grade);
      this.paintGrades(false);
    };
    listener.start();
    this.listener = listener;
  }

  private showGrade(take: TakeResult): void {
    this.lastTake = take;
    this.grades = new Map(
      take.grade.notes.map((g) => [handleKey(g.expected.barIndex, g.expected.noteIndex), g]),
    );
    this.paintGrades();
    this.renderResult();
    const config = this.config;
    if (config) {
      this.ctx.engine.recordGrade(config.piece, take.grade, this.attemptOptions(config));
      config.onOutcome?.({ accuracy: summarise(take.grade).accuracy, selfCheck: null });
    }
  }

  private attemptOptions(config: PanelConfig) {
    return {
      firstTry: this.takes++ === 0,
      scheduled: config.practice === 'scheduled',
      includePiece: config.trackPiece === true,
    };
  }

  /** Summary, feedback sentence and actions for the graded take. */
  private renderResult(): void {
    const take = this.lastTake;
    const config = this.config;
    if (!take || !config) return;
    const { total, pitchCorrect, onTime } = summarise(take.grade);
    const again = h('button', {
      type: 'button',
      className: 'btn',
      id: 'again',
      textContent: 'Again',
    });
    const hear = h('button', {
      type: 'button',
      className: 'btn',
      id: 'hear-me',
      textContent: 'Hear what I played',
    });
    again.addEventListener('click', () => this.run('turn'));
    hear.addEventListener('click', () => this.run('heard'));
    this.resultEl.replaceChildren(
      h('strong', {
        id: 'take-score',
        textContent: `${pitchCorrect} of ${total} notes right, ${onTime} on time`,
      }),
      h('span', { id: 'take-feedback', textContent: feedbackFor(take.grade, config.piece) }),
      h('span', { className: 'spacer' }),
      again,
      hear,
    );
    this.resultEl.dataset.kind = 'graded';
    this.resultEl.hidden = false;
  }

  /** No mic: ask the learner how it went. */
  private showSelfCheck(): void {
    const config = this.config;
    if (!config) return;
    const gotIt = h('button', {
      type: 'button',
      className: 'btn',
      id: 'got-it',
      textContent: 'Got it',
    });
    const again = h('button', {
      type: 'button',
      className: 'btn',
      id: 'again',
      textContent: 'Again',
    });
    const verdict = h('span', { className: 'muted', id: 'self-check-result' });
    const micLink = h('a', {
      href: '#/mic',
      className: 'mic-hint',
      textContent: 'Turn on the mic',
    });
    const hint = h(
      'span',
      { className: 'muted mic-hint-text' },
      micLink,
      ' to have this checked for you.',
    );
    gotIt.addEventListener('click', () => {
      verdict.textContent = 'Good. Press Next.';
      hint.hidden = true;
      gotIt.disabled = true;
      this.ctx.engine.recordSelfCheck(config.piece, true, this.attemptOptions(config));
      config.onOutcome?.({ accuracy: null, selfCheck: 'got-it' });
    });
    again.addEventListener('click', () => {
      this.ctx.engine.recordSelfCheck(config.piece, false, this.attemptOptions(config));
      config.onOutcome?.({ accuracy: null, selfCheck: 'again' });
      this.run('turn');
    });
    const box = h(
      'div',
      { className: 'self-check', id: 'self-check' },
      h('strong', { textContent: 'How did it go?' }),
      gotIt,
      again,
      verdict,
      h('span', { className: 'spacer' }),
      hint,
    );
    this.resultEl.replaceChildren(box);
    this.resultEl.dataset.kind = 'self';
    this.resultEl.hidden = false;
  }

  private clearGrades(): void {
    this.grades.clear();
    this.lastTake = null;
    this.resultEl.hidden = true;
    this.resultEl.replaceChildren();
    this.paintGrades();
  }

  /**
   * Colour the notes by grade and, once the take is over, add a mark under
   * each one that can be tapped to correct the mic.
   */
  private paintGrades(withMarks = true): void {
    for (const el of this.scoreEl.querySelectorAll('.grade-green, .grade-amber, .grade-red')) {
      el.classList.remove('grade-green', 'grade-amber', 'grade-red');
    }
    for (const row of this.scoreEl.querySelectorAll('.mark-row')) row.remove();
    const final = withMarks && this.lastTake !== null;
    const rows = new Map<number, HTMLElement>();
    for (const [key, grade] of this.grades) {
      const handle = this.renderer.handles.get(key);
      if (!handle) continue;
      for (const el of [handle.el, handle.tabEl]) el?.classList.add(`grade-${grade.status}`);
      if (!final) continue;
      let row = rows.get(handle.systemIndex);
      if (!row) {
        row = h('div', { className: 'mark-row' });
        rows.set(handle.systemIndex, row);
        this.renderer.systems[handle.systemIndex]?.el.after(row);
      }
      row.append(this.markFor(key, grade, handle.x));
    }
  }

  private markFor(key: string, grade: NoteGrade, x: number): HTMLButtonElement {
    const wrong = grade.reason === 'wrong' && grade.heardMidi !== null;
    const text = MARKS[grade.status] + (wrong ? ` ${soundingName(grade.heardMidi!)}` : '');
    const meaning =
      grade.reason === 'ok'
        ? 'right'
        : grade.reason === 'timing'
          ? `right note, ${Math.abs(Math.round(grade.offsetMs ?? 0))} ms ${(grade.offsetMs ?? 0) > 0 ? 'late' : 'early'}`
          : wrong
            ? `played as ${soundingName(grade.heardMidi!)}`
            : 'not heard';
    const mark = h('button', {
      type: 'button',
      className: `mark mark-${grade.status}${grade.flipped ? ' is-flipped' : ''}`,
      textContent: text,
      title: `${meaning}. Click if the mic got this wrong.`,
      dataset: { note: key, status: grade.status },
    });
    mark.setAttribute(
      'aria-label',
      `${soundingName(grade.expected.midi)}: ${meaning}. Press to change.`,
    );
    mark.style.left = `${x}px`;
    mark.addEventListener('click', () => this.flip(key));
    return mark;
  }

  /** "I played this right" / "I missed this": correct one grade by hand. */
  private flip(key: string): void {
    const take = this.lastTake;
    if (!take) return;
    const index = take.grade.notes.findIndex(
      (g) => handleKey(g.expected.barIndex, g.expected.noteIndex) === key,
    );
    if (index < 0) return;
    const flipped = flipGrade(take.grade.notes[index]!);
    take.grade.notes[index] = flipped;
    this.grades.set(key, flipped);
    this.paintGrades();
    this.renderResult();
    this.config?.onOutcome?.({ accuracy: summarise(take.grade).accuracy, selfCheck: null });
    (this.scoreEl.querySelector(`.mark[data-note="${key}"]`) as HTMLElement | null)?.focus();
  }

  // --- Selection and loop ---------------------------------------------------------------

  private barUnder(event: PointerEvent): number | null {
    const systemEl = (event.target as Element).closest<HTMLElement>('.system');
    if (!systemEl) return null;
    const x = event.clientX - systemEl.getBoundingClientRect().left;
    return this.renderer.barAt(Number(systemEl.dataset.system), x) ?? null;
  }

  private select(selection: { first: number; last: number } | null): void {
    const { player } = this.ctx;
    const timeline = player.currentTimeline;
    if (player.isPlaying) player.stop();
    this.selection = selection;
    if (selection && timeline) {
      const perBar = fracToNumber(timeline.beatsPerBar);
      player.range = {
        startBeat: selection.first * perBar,
        endBeat: (selection.last + 1) * perBar,
      };
    } else {
      player.range = null;
      player.loop = false;
    }
    this.paintSelection();
    this.updateButtons();
  }

  private paintSelection(): void {
    for (const el of this.scoreEl.querySelectorAll('.bar-selected')) el.remove();
    if (!this.selection) return;
    for (let bar = this.selection.first; bar <= this.selection.last; bar++) {
      const box = this.renderer.barBox(bar);
      if (!box) continue;
      const mark = h('div', { className: 'bar-selected', dataset: { bar: String(bar) } });
      mark.style.left = `${box.x}px`;
      mark.style.width = `${box.width}px`;
      box.system.el.prepend(mark);
    }
  }

  private toggleLoop(): void {
    const { player } = this.ctx;
    const timeline = player.currentTimeline;
    if (!timeline) return;
    if (player.isPlaying) player.stop();
    if (!player.loop && !this.selection) {
      // Nothing selected: loop the whole piece.
      this.select({ first: 0, last: timeline.barStartBeats.length - 1 });
    }
    player.loop = !player.loop;
    this.updateButtons();
  }

  // --- Small things -------------------------------------------------------------------------

  private onFrame(beat: number): void {
    const pulse = this.ctx.player.pulse;
    const n = countInNumber(beat, clock.leadIn, pulse);
    const text = n === null ? '' : String(n);
    if (this.countIn.textContent !== text) this.countIn.textContent = text;
    // Visual metronome: a dot that flashes on each pulse and fades until the next.
    const phase = pulsePhase(beat, clock.leadIn, pulse);
    const lit = this.reducedMotion.matches
      ? phase < 0.25
        ? 1
        : 0.15
      : Math.max(0.15, 1 - phase * 1.6);
    this.pulse.style.opacity = lit.toFixed(2);
  }

  private toggleTab(): void {
    this.renderer.setTabVisible(!this.renderer.isTabVisible);
    // Peeking is free. It is only noted, per skill, as a private signal (spec section 2).
    if (this.renderer.isTabVisible && this.config) this.ctx.engine.peek(this.config.piece);
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
      const listening = playing && mode !== 'turn';
      this.listenButton.textContent = listening ? 'Stop' : 'Listen';
      this.listenButton.disabled = playing && !listening;
      this.turnButton.textContent = playing && mode === 'turn' ? 'Stop' : 'Your turn';
      this.turnButton.disabled = playing && mode !== 'turn';
    } else {
      this.listenButton.textContent = 'Loading sound…';
      this.listenButton.disabled = true;
      this.turnButton.disabled = true;
    }
    const shown = this.renderer.isTabVisible;
    this.tabButton.textContent = shown ? 'Hide tab' : 'Peek tab';
    this.tabButton.setAttribute('aria-pressed', String(shown));
    this.tabButton.classList.toggle('is-on', shown);
    const click = player.metronomeOn;
    this.metronomeButton.textContent = click ? 'Click: on' : 'Click: off';
    this.metronomeButton.setAttribute('aria-pressed', String(click));
    this.metronomeButton.classList.toggle('is-on', click);
    this.loopButton.textContent = player.loop ? 'Loop: on' : 'Loop: off';
    this.loopButton.setAttribute('aria-pressed', String(player.loop));
    this.loopButton.classList.toggle('is-on', player.loop);
  }
}
