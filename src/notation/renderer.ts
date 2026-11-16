/**
 * Notation renderer (VexFlow 5, SVG).
 *
 * Each system (line of music) is its own <svg> holding a notation stave and,
 * directly under it, a tab stave. Both are always laid out together, note for
 * note; "Peek tab" only shows or hides the tab group and changes the height of
 * the system, so toggling it can never move the notation sideways.
 *
 * The renderer's public result is the note-handle map: for every note,
 * (barIndex, noteIndex) -> its SVG element, its tab counterpart and its x
 * position. Playback uses it now; M1 colours graded notes with it.
 */
import {
  Accidental,
  Barline,
  Beam,
  Dot,
  Formatter,
  FretHandFinger,
  GhostNote,
  Metrics,
  MetricsDefaults,
  Modifier,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  StringNumber,
  TabNote,
  TabStave,
  TabTie,
  Voice,
  type StemmableNote,
} from 'vexflow/bravura';
import { LAYOUT, type FingeringLevel } from '../config';
import { positionLabel } from '../content/fingering';
import type { Piece, PieceNote } from '../content/types';

export interface NotationColors {
  /** Notes, clefs, text. */
  ink: string;
  /** Staff and tab lines. */
  staff: string;
  /** Behind tab fret numbers, so the tab lines do not run through them. */
  background: string;
}

export interface RenderOptions {
  /** Staff zoom as a scale factor (1 = VexFlow's natural size). */
  zoom: number;
  fingeringLevel: FingeringLevel;
  colors: NotationColors;
}

export interface NoteHandle {
  readonly barIndex: number;
  readonly noteIndex: number;
  readonly systemIndex: number;
  readonly isRest: boolean;
  /** The note (or rest) in the notation stave. */
  readonly el: SVGGElement;
  /** The same note in the tab stave; null for rests, which tab does not show. */
  readonly tabEl: SVGGElement | null;
  /** Horizontal centre of the note, in CSS pixels from the left edge of its system. */
  readonly x: number;
}

export interface SystemInfo {
  readonly index: number;
  /** The positioned wrapper element for this system. */
  readonly el: HTMLElement;
  readonly firstBar: number;
  readonly lastBar: number;
  /** Right-hand end of the last bar, in CSS pixels from the left edge of the system. */
  readonly endX: number;
}

export function handleKey(barIndex: number, noteIndex: number): string {
  return `${barIndex}:${noteIndex}`;
}

const DURATION_CODE = { w: 'w', h: 'h', q: 'q', '8': '8', '16': '16' } as const;

/** VexFlow objects for one bar. They can be formatted once, so they are rebuilt for each pass. */
interface BarParts {
  notes: StaveNote[];
  tabNotes: (TabNote | GhostNote)[];
  voice: Voice;
  tabVoice: Voice;
  beams: Beam[];
}

function staveKey(note: PieceNote): string {
  const p = note.pitch!;
  const accidental = p.alter === 1 ? '#' : p.alter === -1 ? 'b' : '';
  return `${p.letter.toLowerCase()}${accidental}/${p.octave}`;
}

function showsMarkers(level: FingeringLevel, bar: readonly PieceNote[], note: PieceNote): boolean {
  if (note.pitch === null || note.tiedFromPrevious) return false;
  if (level === 'all') return true;
  if (level === 'none') return false;
  return bar.find((n) => n.pitch !== null) === note;
}

function buildBar(piece: Piece, bar: readonly PieceNote[], level: FingeringLevel): BarParts {
  const notes: StaveNote[] = [];
  const tabNotes: (TabNote | GhostNote)[] = [];

  for (const note of bar) {
    if (note.duration.triplet) {
      // The validator rejects triplets until R8; drawing them needs tuplet brackets.
      throw new Error(`Triplets cannot be drawn yet (${piece.file}, bar ${note.barIndex + 1})`);
    }
    const duration = DURATION_CODE[note.duration.base] + (note.duration.dotted ? 'd' : '');

    if (note.pitch === null) {
      const rest = new StaveNote({ keys: ['b/4'], duration: `${duration}r` });
      if (note.duration.dotted) Dot.buildAndAttach([rest], { all: true });
      notes.push(rest);
      tabNotes.push(new GhostNote({ duration }));
      continue;
    }

    const staveNote = new StaveNote({ keys: [staveKey(note)], duration, autoStem: true });
    if (note.accidental) staveNote.addModifier(new Accidental(note.accidental), 0);
    if (note.duration.dotted) Dot.buildAndAttach([staveNote], { all: true });
    const fingering = note.fingering!;
    if (showsMarkers(level, bar, note)) {
      const finger = new FretHandFinger(String(fingering.finger));
      finger.setPosition(Modifier.Position.LEFT);
      staveNote.addModifier(finger, 0);
      const stringNumber = new StringNumber(String(fingering.string));
      stringNumber.setPosition(Modifier.Position.ABOVE);
      staveNote.addModifier(stringNumber, 0);
    }
    notes.push(staveNote);

    // A note tied from the previous one is not struck again: tab shows it in brackets.
    const fret = note.tiedFromPrevious ? `(${fingering.fret})` : fingering.fret;
    tabNotes.push(new TabNote({ positions: [{ str: fingering.string, fret }], duration }));
  }

  const time = { numBeats: piece.meter.beats, beatValue: piece.meter.beatUnit };
  const voice = new Voice(time).setMode(Voice.Mode.STRICT).addTickables(notes);
  const tabVoice = new Voice(time).setMode(Voice.Mode.STRICT).addTickables(tabNotes);
  const beams = Beam.generateBeams(notes as StemmableNote[], {
    groups: Beam.getDefaultBeamGroups(piece.time),
  });
  return { notes, tabNotes, voice, tabVoice, beams };
}

/** Make the notation and tab staves of one bar, with matching note start positions. */
function buildStaves(
  piece: Piece,
  barIndex: number,
  firstInSystem: boolean,
  x: number,
  width: number,
): { stave: Stave; tabStave: TabStave } {
  const stave = new Stave(x, LAYOUT.notationTop, width);
  const tabStave = new TabStave(x, LAYOUT.tabTop, width);
  if (firstInSystem) {
    // Guitar notation: treble clef with a small 8 below (sounds an octave lower).
    stave.addClef('treble', 'default', '8vb');
    stave.addKeySignature(piece.key);
    tabStave.addClef('tab');
  }
  if (barIndex === 0) stave.addTimeSignature(piece.time);
  if (barIndex === piece.bars.length - 1) {
    stave.setEndBarType(Barline.type.END);
    tabStave.setEndBarType(Barline.type.END);
  }
  const noteStartX =
    Math.max(stave.getNoteStartX(), tabStave.getNoteStartX()) + LAYOUT.noteStartPadding;
  stave.setNoteStartX(noteStartX);
  tabStave.setNoteStartX(noteStartX);
  return { stave, tabStave };
}

interface BarMeasure {
  /** Width the notes need, without clef or signatures. */
  notesWidth: number;
  /** Extra width when the bar opens a system (clef, key and, in bar 1, time signature). */
  headerWidth: number;
}

function measureBar(piece: Piece, barIndex: number, level: FingeringLevel): BarMeasure {
  const parts = buildBar(piece, piece.bars[barIndex]!, level);
  const formatter = new Formatter().joinVoices([parts.voice]).joinVoices([parts.tabVoice]);
  const min = formatter.preCalculateMinTotalWidth([parts.voice, parts.tabVoice]);
  const { stave } = buildStaves(piece, barIndex, true, 0, 400);
  const plain = buildStaves(piece, barIndex, false, 0, 400).stave;
  return {
    notesWidth: Math.max(LAYOUT.minBarWidth, min + LAYOUT.barPadding),
    headerWidth: stave.getNoteStartX() - plain.getNoteStartX(),
  };
}

/** Flow bars into systems that fit the width, then stretch each system to fill it. */
export function layoutSystems(
  measures: readonly BarMeasure[],
  availableWidth: number,
): { firstBar: number; widths: number[] }[] {
  const systems: { firstBar: number; natural: number[] }[] = [];
  let current: { firstBar: number; natural: number[] } | null = null;
  let used = 0;
  for (const [i, m] of measures.entries()) {
    if (
      current &&
      (used + m.notesWidth > availableWidth || current.natural.length >= LAYOUT.maxBarsPerSystem)
    ) {
      current = null;
    }
    if (!current) {
      current = { firstBar: i, natural: [] };
      systems.push(current);
      used = 0;
    }
    const width = m.notesWidth + (current.natural.length === 0 ? m.headerWidth : 0);
    current.natural.push(width);
    used += width;
  }

  return systems.map(({ firstBar, natural }) => {
    const total = natural.reduce((a, b) => a + b, 0);
    const header = measures[firstBar]!.headerWidth;
    // Share the spare room in proportion to each bar's notes, up to the widest allowed bar.
    const scale = Math.max(1, (availableWidth - header) / (total - header));
    const widths = natural.map((w, i) => {
      const notes = i === 0 ? w - header : w;
      return Math.min(notes * scale, LAYOUT.maxBarWidth) + (i === 0 ? header : 0);
    });
    return { firstBar, widths };
  });
}

export class ScoreRenderer {
  private readonly container: HTMLElement;
  private handleMap = new Map<string, NoteHandle>();
  private systemList: SystemInfo[] = [];
  private tabVisible = false;
  private zoom = 1;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Every note of the last rendered piece, keyed by handleKey(barIndex, noteIndex). */
  get handles(): ReadonlyMap<string, NoteHandle> {
    return this.handleMap;
  }

  /** The systems (lines of music) of the last render, top to bottom. */
  get systems(): readonly SystemInfo[] {
    return this.systemList;
  }

  getHandle(barIndex: number, noteIndex: number): NoteHandle | undefined {
    return this.handleMap.get(handleKey(barIndex, noteIndex));
  }

  get isTabVisible(): boolean {
    return this.tabVisible;
  }

  /** Show or hide the tab staves. Never changes the horizontal layout. */
  setTabVisible(visible: boolean): void {
    this.tabVisible = visible;
    this.container.classList.toggle('tab-visible', visible);
    for (const system of this.systemList) this.sizeSystem(system.el);
  }

  /** Draw the piece into the container, replacing whatever was there. */
  render(piece: Piece, options: RenderOptions): void {
    const { zoom, fingeringLevel, colors } = options;
    this.zoom = zoom;
    this.container.replaceChildren();
    this.container.classList.toggle('tab-visible', this.tabVisible);
    this.handleMap = new Map();
    this.systemList = [];

    // VexFlow keeps a few default colours (stems, staff lines) in its metrics table.
    MetricsDefaults.Stem.strokeStyle = colors.ink;
    MetricsDefaults.Stave.strokeStyle = colors.staff;
    MetricsDefaults.TabStave.strokeStyle = colors.staff;
    Metrics.clear();

    const widthPx = this.container.clientWidth;
    const availableWidth = widthPx / zoom - 2 * LAYOUT.systemMarginX;
    const measures = piece.bars.map((_, i) => measureBar(piece, i, fingeringLevel));
    const layout = layoutSystems(measures, availableWidth);

    // Ties are drawn after both of their notes exist, which may be on different systems.
    let pendingTie: { note: StaveNote; tabNote: TabNote } | null = null;

    for (const [systemIndex, system] of layout.entries()) {
      const el = document.createElement('div');
      el.className = 'system';
      el.dataset.system = String(systemIndex);
      this.container.append(el);

      const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
      renderer.resize(widthPx, LAYOUT.systemHeightWithTab * zoom);
      const ctx = renderer.getContext();
      ctx.scale(zoom, zoom);
      ctx.setFillStyle(colors.ink);
      ctx.setStrokeStyle(colors.ink);
      ctx.setBackgroundFillStyle(colors.background);

      const drawn: {
        parts: BarParts;
        stave: Stave;
        tabStave: TabStave;
        barIndex: number;
      }[] = [];
      let x = LAYOUT.systemMarginX;
      for (const [i, width] of system.widths.entries()) {
        const barIndex = system.firstBar + i;
        const { stave, tabStave } = buildStaves(piece, barIndex, i === 0, x, width);
        const parts = buildBar(piece, piece.bars[barIndex]!, fingeringLevel);
        for (const s of [stave, tabStave]) {
          s.setDefaultLedgerLineStyle({ strokeStyle: colors.ink, lineWidth: 1.4 });
          s.setContext(ctx);
        }
        new Formatter()
          .joinVoices([parts.voice])
          .joinVoices([parts.tabVoice])
          .formatToStave([parts.voice, parts.tabVoice], stave);
        drawn.push({ parts, stave, tabStave, barIndex });
        x += width;
      }

      // --- Notation layer ---
      const tabTies: { first: TabNote | null; last: TabNote | null }[] = [];
      for (const { parts, stave, barIndex } of drawn) {
        stave.drawWithStyle();
        parts.voice.draw(ctx, stave);
        for (const beam of parts.beams) beam.setContext(ctx).draw();

        const bar = piece.bars[barIndex]!;
        for (const [noteIndex, note] of bar.entries()) {
          const staveNote = parts.notes[noteIndex]!;
          const tabNote = parts.tabNotes[noteIndex] as TabNote;
          if (note.tiedFromPrevious) {
            // The tie may start on the previous system: then only its right half is drawn here.
            const from = pendingTie;
            new StaveTie({
              firstNote:
                from && drawn.some((d) => d.parts.notes.includes(from.note)) ? from.note : null,
              lastNote: staveNote,
            })
              .setContext(ctx)
              .draw();
            tabTies.push({
              first:
                from && drawn.some((d) => d.parts.tabNotes.includes(from.tabNote))
                  ? from.tabNote
                  : null,
              last: tabNote,
            });
          }
          pendingTie = note.tieToNext ? { note: staveNote, tabNote } : null;
        }
      }
      // A tie that runs on to the next system: draw its left half here.
      if (pendingTie) {
        new StaveTie({ firstNote: pendingTie.note, lastNote: null }).setContext(ctx).draw();
        tabTies.push({ first: pendingTie.tabNote, last: null });
      }

      if (fingeringLevel !== 'none') {
        const first = drawn[0]!.stave;
        ctx.save();
        ctx.setFont('system-ui, sans-serif', LAYOUT.positionLabelFontSize, '600');
        ctx.fillText(
          positionLabel(piece.position),
          first.getX() + 2,
          first.getYForLine(0) - LAYOUT.positionLabelRise,
        );
        ctx.restore();
      }

      // --- Tab layer: one group, so Peek tab can show and hide it without a redraw ---
      const tabGroup = ctx.openGroup('tab-layer') as SVGGElement;
      tabGroup.classList.add('malco-tab');
      for (const { parts, tabStave } of drawn) {
        tabStave.drawWithStyle();
        parts.tabVoice.draw(ctx, tabStave);
      }
      for (const tie of tabTies) {
        new TabTie({ firstNote: tie.first, lastNote: tie.last }).setContext(ctx).draw();
      }
      ctx.closeGroup();
      tabGroup.setAttribute('aria-hidden', 'true');

      // --- Note handles ---
      for (const { parts, barIndex } of drawn) {
        for (const [noteIndex, note] of piece.bars[barIndex]!.entries()) {
          const staveNote = parts.notes[noteIndex]!;
          const noteEl = staveNote.getSVGElement() as SVGGElement | undefined;
          if (!noteEl)
            throw new Error(`No SVG element for bar ${barIndex + 1}, note ${noteIndex + 1}`);
          noteEl.dataset.bar = String(barIndex);
          noteEl.dataset.note = String(noteIndex);
          noteEl.classList.add('malco-note');

          let tabEl: SVGGElement | null = null;
          if (note.pitch !== null) {
            tabEl = (parts.tabNotes[noteIndex] as TabNote).getSVGElement() as SVGGElement;
            tabEl.dataset.bar = String(barIndex);
            tabEl.dataset.note = String(noteIndex);
            tabEl.classList.add('malco-tabnote');
          }

          const centre =
            note.pitch === null
              ? staveNote.getAbsoluteX() + staveNote.getGlyphWidth() / 2
              : (staveNote.getNoteHeadBeginX() + staveNote.getNoteHeadEndX()) / 2;
          this.handleMap.set(handleKey(barIndex, noteIndex), {
            barIndex,
            noteIndex,
            systemIndex,
            isRest: note.pitch === null,
            el: noteEl,
            tabEl,
            x: centre * zoom,
          });
        }
      }

      const last = drawn[drawn.length - 1]!;
      this.systemList.push({
        index: systemIndex,
        el,
        firstBar: system.firstBar,
        lastBar: last.barIndex,
        endX: (last.stave.getX() + last.stave.getWidth()) * zoom,
      });
      this.sizeSystem(el);
    }
  }

  /** Set the visible height of a system: taller when the tab is showing. */
  private sizeSystem(el: HTMLElement): void {
    const height =
      (this.tabVisible ? LAYOUT.systemHeightWithTab : LAYOUT.notationHeightNoTab) * this.zoom;
    el.style.height = `${height}px`;
  }
}

/** Resolves when the notation fonts are ready; drawing before that mis-measures glyphs. */
export async function notationFontsReady(): Promise<void> {
  await Promise.all([
    document.fonts.load('30px Bravura'),
    document.fonts.load('12px Academico'),
    document.fonts.load('bold 12px Academico'),
  ]);
  await document.fonts.ready;
}
