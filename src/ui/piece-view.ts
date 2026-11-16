/** Free practice on one piece: the score, its context, and the full controls. */
import { FINGERING } from '../config';
import type { Piece } from '../content/types';
import type { AppContext, View } from './context';
import { h } from './dom';
import { ScorePanel } from './score-panel';

export function createPieceView(ctx: AppContext, piece: Piece, scroller: HTMLElement): View {
  const panel = new ScorePanel(ctx, scroller);
  const el = h(
    'div',
    { className: 'piece-view' },
    h(
      'div',
      { className: 'sheet' },
      h(
        'div',
        { className: 'piece-head' },
        h('h2', { className: 'piece-title', textContent: piece.title }),
        h('p', { className: 'piece-composer', textContent: piece.composer }),
        h('p', { className: 'piece-meta', textContent: `Key of ${piece.key} · ${piece.time}` }),
      ),
      h('p', { className: 'piece-source', id: 'piece-source', textContent: piece.source }),
      panel.scoreEl,
    ),
    panel.resultEl,
  );
  document.title = `${piece.title} · Malcotron`;
  panel.load({
    piece,
    tempo: piece.suggestedTempo,
    fingering: FINGERING.defaultLevel,
    showTab: false,
    yourTurn: true,
    fingeringControl: true,
  });
  return {
    el,
    bottomEl: panel.controlsEl,
    panel,
    handleKey: (event) => panel.handleKey(event),
    redraw: () => panel.draw(),
    destroy: () => panel.destroy(),
  };
}
