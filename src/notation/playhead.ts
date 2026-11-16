/**
 * Playhead and note highlight, driven from the clock.
 *
 * Every animation frame it reads the clock's current beat and places the
 * playhead and highlight from that, so they cannot drift from the audio: a
 * late frame simply draws the right position a little later. It holds no time
 * of its own.
 */
import { PLAYBACK } from '../config';
import { fracToNumber } from '../content/music';
import { eventIndexAtBeat, type Timeline } from '../audio/timeline';
import type { NoteHandle, ScoreRenderer } from './renderer';

export interface BeatSource {
  /** The beat being heard now. */
  readonly beat: number;
  readonly state: 'stopped' | 'running';
}

export class Playhead {
  private readonly renderer: ScoreRenderer;
  private readonly source: BeatSource;
  private readonly scroller: HTMLElement;
  private readonly line: HTMLDivElement;
  /** Tint over the bar being played, so the eye can find its place (spec section 8). */
  private readonly band: HTMLDivElement;
  private currentBar = -1;
  private timeline: Timeline | null = null;
  private starts: number[] = [];
  private totalBeats = 0;
  private frame = 0;
  private current: NoteHandle | null = null;
  private currentSystem = -1;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** Called on every animation frame while running, with the beat being heard. */
  onFrame: ((beat: number) => void) | null = null;
  /** Notified whenever the highlighted note changes (null when nothing is highlighted). */
  onNoteChange: ((handle: NoteHandle | null) => void) | null = null;

  /**
   * @param scroller the element that scrolls when the score is taller than the window
   */
  constructor(renderer: ScoreRenderer, source: BeatSource, scroller: HTMLElement) {
    this.renderer = renderer;
    this.source = source;
    this.scroller = scroller;
    this.line = document.createElement('div');
    this.line.className = 'playhead';
    this.line.setAttribute('aria-hidden', 'true');
    this.band = document.createElement('div');
    this.band.className = 'bar-band';
    this.band.setAttribute('aria-hidden', 'true');
  }

  setTimeline(timeline: Timeline): void {
    this.timeline = timeline;
    this.starts = timeline.events.map((e) => fracToNumber(e.startBeat));
    this.totalBeats = fracToNumber(timeline.totalBeats);
  }

  /** Begin following the clock. */
  start(): void {
    cancelAnimationFrame(this.frame);
    const tick = () => {
      if (this.source.state !== 'running') {
        this.clear();
        return;
      }
      const beat = this.source.beat;
      this.update(beat);
      this.onFrame?.(beat);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Stop following and remove the playhead and highlight. */
  clear(): void {
    cancelAnimationFrame(this.frame);
    this.setCurrent(null);
    this.line.remove();
    this.band.remove();
    this.currentSystem = -1;
    this.currentBar = -1;
  }

  /** The score was redrawn: its elements are new, so forget the old ones. */
  rendered(): void {
    this.current = null;
    this.currentSystem = -1;
    this.currentBar = -1;
    this.line.remove();
    this.band.remove();
    if (this.source.state === 'running') this.update(this.source.beat);
  }

  private update(beat: number): void {
    const timeline = this.timeline;
    if (!timeline) return;
    const index = eventIndexAtBeat(this.starts, this.totalBeats, beat);
    if (index < 0) {
      this.setCurrent(null);
      return;
    }
    const event = timeline.events[index]!;
    const handle = this.renderer.getHandle(event.barIndex, event.noteIndex);
    if (!handle) return;
    this.setCurrent(handle);

    const system = this.renderer.systems[handle.systemIndex];
    if (!system) return;
    if (handle.barIndex !== this.currentBar) {
      this.currentBar = handle.barIndex;
      const box = this.renderer.barBox(handle.barIndex);
      if (box) {
        this.band.style.left = `${box.x}px`;
        this.band.style.width = `${box.width}px`;
        box.system.el.prepend(this.band);
      }
    }
    if (handle.systemIndex !== this.currentSystem) {
      this.currentSystem = handle.systemIndex;
      system.el.append(this.line);
      this.keepInView(system.el);
    }

    let x = handle.x;
    if (!this.reducedMotion.matches) {
      // Glide towards the next note, or to the end of the system after its last note.
      const next = timeline.events[index + 1];
      const nextHandle = next && this.renderer.getHandle(next.barIndex, next.noteIndex);
      const targetX =
        nextHandle && nextHandle.systemIndex === handle.systemIndex ? nextHandle.x : system.endX;
      const start = this.starts[index]!;
      const end = next ? this.starts[index + 1]! : this.totalBeats;
      const progress = Math.min(1, Math.max(0, (beat - start) / (end - start)));
      x += (targetX - handle.x) * progress;
    }
    this.line.style.transform = `translateX(${x.toFixed(2)}px)`;
  }

  private setCurrent(handle: NoteHandle | null): void {
    if (handle === this.current) return;
    for (const el of [this.current?.el, this.current?.tabEl]) el?.classList.remove('is-current');
    this.current = handle;
    for (const el of [handle?.el, handle?.tabEl]) el?.classList.add('is-current');
    this.onNoteChange?.(handle);
  }

  /** The layout changed height (tab shown or hidden): keep the system being played in view. */
  reveal(): void {
    const system = this.renderer.systems[this.currentSystem];
    if (system) this.keepInView(system.el);
  }

  /**
   * If the system being played is not fully visible, scroll it to the top of
   * the view, so the learner never has to scroll by hand and can see as much
   * of what comes next as fits.
   */
  private keepInView(systemEl: HTMLElement): void {
    const view = this.scroller.getBoundingClientRect();
    const rect = systemEl.getBoundingClientRect();
    if (rect.top >= view.top && rect.bottom <= view.bottom) return;
    const delta = rect.top - (view.top + PLAYBACK.scrollMargin);
    if (Math.abs(delta) < 1) return;
    this.scroller.scrollBy({
      top: delta,
      behavior: this.reducedMotion.matches ? 'auto' : 'smooth',
    });
  }
}
