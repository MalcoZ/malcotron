/**
 * A session (spec section 4): warm-up, reviews, the next lesson and a piece,
 * one item at a time, ending with a short summary.
 */
import { ENGINE, FINGERING } from '../config';
import { generatePiece } from '../engine/generator';
import type { SessionItem } from '../engine/session';
import { pitchOfSkill, skillKind } from '../engine/skills';
import type { AppContext, View } from './context';
import { h } from './dom';
import { ScorePanel } from './score-panel';

const BLOCK_NAMES = { 'warm-up': 'Warm-up', review: 'Review', new: 'New', apply: 'Play' } as const;

/** A plain sentence saying what an exercise is for. */
function describe(item: Extract<SessionItem, { kind: 'exercise' }>): string {
  if (item.spec.pair) {
    return 'These two notes have been getting mixed up. They are side by side here so you can see and hear the difference.';
  }
  const notes = [
    ...new Set(item.skills.map(pitchOfSkill).filter((p): p is string => p !== null)),
  ].map((p) => p.replace(/\d/, '').replace('#', '♯').replace('b', '♭'));
  const rhythm = item.skills.some((id) => skillKind(id) === 'rhythm' || skillKind(id) === 'meter');
  if (item.block === 'warm-up')
    return 'Something easy to start: notes you know, a little slower than usual.';
  if (notes.length > 0) return `This one brings back ${notes.slice(0, 4).join(', ')}.`;
  return rhythm ? 'This one brings back a rhythm you have learned.' : 'A short review.';
}

export function createSessionView(ctx: AppContext, scroller: HTMLElement): View {
  const session = ctx.session;
  if (!session) {
    // Nothing in progress (for example after a reload): Home starts a new one.
    const el = h('div', { className: 'home' });
    queueMicrotask(() => ctx.navigate('/'));
    return { el, bottomEl: null, destroy() {} };
  }
  const { plan } = session;
  const item = plan.items[session.index];
  document.title = 'Session · Malcotron';

  const bar = h('progress', {
    className: 'step-progress',
    id: 'session-progress',
    max: plan.items.length,
    value: Math.min(session.index + 1, plan.items.length),
  });
  const head = h(
    'div',
    { className: 'lesson-head' },
    h('a', { className: 'crumb', href: '#/', id: 'leave-session', textContent: '‹ Leave session' }),
    h('h2', {
      id: 'session-title',
      textContent: item ? `Session: ${BLOCK_NAMES[item.block]}` : 'Session complete',
    }),
    h('span', {
      className: 'muted step-count',
      id: 'session-count',
      textContent: item ? `${session.index + 1} of ${plan.items.length}` : '',
    }),
    bar,
  );

  const advance = () => {
    session.index++;
    ctx.navigate('/session');
  };
  const next = h('button', {
    type: 'button',
    className: 'btn btn-primary',
    id: 'next',
    textContent: 'Next',
  });
  next.addEventListener('click', advance);
  const nav = h('div', { className: 'step-nav' }, h('div', { className: 'spacer' }), next);

  // --- The end ---------------------------------------------------------------------
  if (!item) {
    ctx.engine.finishSession();
    const summary = ctx.engine.summary();
    const takes = session.accuracies;
    const average = takes.length
      ? Math.round((100 * takes.reduce((a, b) => a + b, 0)) / takes.length)
      : null;
    ctx.session = null;
    const home = h('button', {
      type: 'button',
      className: 'btn btn-primary btn-large',
      id: 'session-home',
      textContent: 'Done',
    });
    home.addEventListener('click', () => ctx.navigate('/'));
    const card = h(
      'section',
      { className: 'card hero done', id: 'session-done' },
      h('p', { className: 'eyebrow', textContent: 'Session complete' }),
      h('h2', {
        textContent:
          average === null
            ? 'Nicely done'
            : `${average}% of notes right across ${takes.length} take${takes.length === 1 ? '' : 's'}`,
      }),
      h('p', {
        className: 'muted',
        id: 'session-summary',
        textContent: `${summary.mastered} skills mastered, ${summary.learning} being learned, ${summary.due} due for review.`,
      }),
      h('div', { className: 'done-actions' }, home),
    );
    return { el: h('div', { className: 'home' }, head, card), bottomEl: null, destroy() {} };
  }

  // --- The next lesson ---------------------------------------------------------------
  if (item.kind === 'lesson') {
    const start = h('button', {
      type: 'button',
      className: 'btn btn-primary btn-large',
      id: 'session-lesson',
      textContent: 'Start the lesson',
    });
    start.addEventListener('click', () => ctx.navigate(`/lesson/${item.lessonId}/1`));
    const skip = h('button', {
      type: 'button',
      className: 'btn',
      id: 'session-skip',
      textContent: 'Not today',
    });
    skip.addEventListener('click', advance);
    const card = h(
      'section',
      { className: 'card hero done' },
      h('p', { className: 'eyebrow', textContent: 'Something new' }),
      h('h2', { textContent: item.title }),
      h('p', {
        className: 'muted',
        textContent:
          'The next lesson in the course. You will come back to the session when it is done.',
      }),
      h('div', { className: 'done-actions' }, start, skip),
    );
    return { el: h('div', { className: 'home' }, head, card), bottomEl: null, destroy() {} };
  }

  // --- An exercise or a piece ---------------------------------------------------------
  const piece =
    item.kind === 'exercise'
      ? generatePiece(item.spec)
      : ctx.pieces.find((p) => p.id === item.pieceId)!;
  const panel = new ScorePanel(ctx, scroller);
  const text = h(
    'div',
    { className: 'step-text', id: 'step-text' },
    h(
      'div',
      { className: 'step-heading' },
      h('span', { className: 'kind', textContent: BLOCK_NAMES[item.block] }),
      h('h3', { id: 'step-title', textContent: item.title }),
    ),
    h('p', {
      textContent:
        item.kind === 'exercise'
          ? `${describe(item)} Press Your turn when you are ready.`
          : `A piece to finish with: ${piece.composer}. Every note and rhythm in it is one you have met.`,
    }),
  );
  const body = h(
    'div',
    { className: 'step' },
    text,
    h('div', { className: 'sheet sheet-lesson' }, panel.scoreEl),
    panel.resultEl,
  );
  panel.load({
    piece,
    tempo: item.kind === 'exercise' ? item.spec.tempo : piece.suggestedTempo,
    // The markers fade as the learner improves (spec section 2).
    fingering: FINGERING.levels[ctx.engine.state.dials.markers] ?? 'all',
    showTab: false,
    yourTurn: true,
    fingeringControl: false,
    practice: 'scheduled',
    trackPiece: item.kind === 'piece',
    onOutcome: (outcome) => {
      const accuracy =
        outcome.accuracy ??
        (outcome.selfCheck === 'got-it' ? ENGINE.selfCheckGotIt : ENGINE.selfCheckAgain);
      session.accuracies.push(accuracy);
    },
  });
  const bottom = h('div', { className: 'lesson-bottom' }, panel.controlsEl, nav);
  return {
    el: h('div', { className: 'lesson', id: 'session' }, head, body),
    bottomEl: bottom,
    panel,
    handleKey(event) {
      if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        if (!event.repeat) advance();
        return true;
      }
      return panel.handleKey(event);
    },
    redraw: () => panel.draw(),
    destroy: () => panel.destroy(),
  };
}
