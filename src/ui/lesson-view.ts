/**
 * The lesson screen: one step at a time. Text above the score, the controls
 * the step needs, and Back / Next (spec section 2, M1 brief task 5).
 */
import { parseInline } from '../course/lessons';
import { nextLesson } from '../course/loader';
import type { Lesson, Step } from '../course/types';
import type { AppContext, View } from './context';
import { h } from './dom';
import { ScorePanel, type TurnOutcome } from './score-panel';

const STEP_KIND: Record<Step['type'], string> = {
  explain: 'Read',
  example: 'Example',
  practice: 'Practice',
  check: 'Check',
};

function paragraph(text: string): HTMLParagraphElement {
  const p = h('p');
  for (const run of parseInline(text)) {
    p.append(run.bold ? h('strong', { textContent: run.text }) : run.text);
  }
  return p;
}

/** Results on practice and check steps this visit, kept while the learner moves between steps. */
const outcomes = new Map<string, TurnOutcome>();

export function createLessonView(
  ctx: AppContext,
  lesson: Lesson,
  stepIndex: number,
  scroller: HTMLElement,
): View {
  const step = lesson.steps[Math.min(stepIndex, lesson.steps.length - 1)]!;
  const lessonNumber = ctx.course.lessons.findIndex((l) => l.id === lesson.id) + 1;
  const isLast = step.index === lesson.steps.length - 1;
  const canPlay = step.type === 'practice' || step.type === 'check';
  ctx.progress.visit(lesson.id, step.index);
  document.title = `${lesson.title} · Malcotron`;

  // --- Head: where you are ---------------------------------------------------
  const bar = h('progress', {
    className: 'step-progress',
    id: 'step-progress',
    max: lesson.steps.length,
    value: step.index + 1,
  });
  bar.setAttribute('aria-label', 'Progress through this lesson');
  const head = h(
    'div',
    { className: 'lesson-head' },
    h('a', { className: 'crumb', href: '#/', textContent: '‹ All lessons' }),
    h('h2', { id: 'lesson-title', textContent: `Lesson ${lessonNumber}: ${lesson.title}` }),
    h('span', {
      className: 'muted step-count',
      id: 'step-count',
      textContent: `Step ${step.index + 1} of ${lesson.steps.length}`,
    }),
    bar,
  );

  // --- The step ----------------------------------------------------------------
  const text = h('div', { className: 'step-text', id: 'step-text' });
  text.append(
    h(
      'div',
      { className: 'step-heading' },
      h('span', { className: `kind kind-${step.type}`, textContent: STEP_KIND[step.type] }),
      h('h3', { id: 'step-title', textContent: step.title ?? lesson.title }),
    ),
    ...step.text.map(paragraph),
  );

  let panel: ScorePanel | null = null;
  const body = h('div', { className: 'step', dataset: { type: step.type } }, text);
  const answerKey = `${lesson.id}:${step.index}`;

  if (step.piece) {
    panel = new ScorePanel(ctx, scroller);
    body.append(h('div', { className: 'sheet sheet-lesson' }, panel.scoreEl), panel.resultEl);
    panel.load({
      piece: step.piece,
      tempo: step.tempo,
      fingering: step.fingering,
      labels: step.labels,
      showTab: step.showTab,
      yourTurn: canPlay,
      fingeringControl: false,
      practice: 'scheduled',
      // The mic's grade, or the learner's own answer without a mic. The best result is kept.
      onOutcome: (outcome) => {
        const before = outcomes.get(answerKey);
        outcomes.set(answerKey, {
          accuracy:
            outcome.accuracy === null
              ? (before?.accuracy ?? null)
              : Math.max(outcome.accuracy, before?.accuracy ?? 0),
          selfCheck:
            before?.selfCheck === 'got-it'
              ? 'got-it'
              : (outcome.selfCheck ?? before?.selfCheck ?? null),
        });
      },
    });
  } else {
    body.classList.add('step-text-only');
  }

  // --- Back / Next -------------------------------------------------------------------
  const back = h('button', { type: 'button', className: 'btn', id: 'back', textContent: 'Back' });
  back.disabled = step.index === 0;
  const next = h('button', {
    type: 'button',
    className: 'btn btn-primary',
    id: 'next',
    textContent: isLast ? 'Finish lesson' : 'Next',
  });
  const goBack = () => ctx.navigate(`/lesson/${lesson.id}/${step.index}`);
  const goNext = () => {
    if (!isLast) {
      ctx.navigate(`/lesson/${lesson.id}/${step.index + 2}`);
      return;
    }
    const outcome = outcomes.get(answerKey);
    ctx.progress.complete(lesson.id, outcome?.selfCheck ?? null, outcome?.accuracy ?? null);
    // Everything the lesson used is now being learned.
    ctx.engine.completeLesson(lesson);
    ctx.navigate(`/lesson/${lesson.id}/done`);
  };
  back.addEventListener('click', goBack);
  next.addEventListener('click', goNext);

  const nav = h('div', { className: 'step-nav' }, back, h('div', { className: 'spacer' }), next);
  const bottom = h('div', { className: 'lesson-bottom' });
  if (panel) bottom.append(panel.controlsEl);
  bottom.append(nav);

  const el = h('div', { className: 'lesson', id: 'lesson' }, head, body);
  return {
    el,
    bottomEl: bottom,
    panel,
    handleKey(event) {
      if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        if (!event.repeat) goNext();
        return true;
      }
      return panel?.handleKey(event) ?? false;
    },
    redraw: () => panel?.draw(),
    destroy: () => panel?.destroy(),
  };
}

/** The panel shown after the last step of a lesson. */
export function createLessonDone(ctx: AppContext, lesson: Lesson): View {
  const following = nextLesson(lesson.id);
  const lessonNumber = ctx.course.lessons.findIndex((l) => l.id === lesson.id) + 1;
  const home = h('button', {
    type: 'button',
    className: 'btn',
    id: 'done-home',
    textContent: 'All lessons',
  });
  home.addEventListener('click', () => ctx.navigate('/'));
  const actions = h('div', { className: 'done-actions' }, home);
  const session = ctx.session;
  if (session) {
    // The lesson was part of a session: carry on with it.
    const back = h('button', {
      type: 'button',
      className: 'btn btn-primary btn-large',
      id: 'back-to-session',
      textContent: 'Back to the session',
    });
    back.addEventListener('click', () => {
      session.index++;
      ctx.navigate('/session');
    });
    actions.prepend(back);
  }
  const card = h(
    'section',
    { className: 'card hero done', id: 'lesson-done' },
    h('p', { className: 'eyebrow', textContent: `Lesson ${lessonNumber} complete` }),
    h('h2', { textContent: lesson.title }),
  );
  if (following) {
    const go = h('button', {
      type: 'button',
      className: session ? 'btn' : 'btn btn-primary btn-large',
      id: 'done-next',
      textContent: 'Next lesson',
    });
    go.addEventListener('click', () => ctx.navigate(`/lesson/${following.id}/1`));
    card.append(
      h('p', { className: 'muted', textContent: `Next: ${following.title}. ${following.summary}` }),
    );
    actions.prepend(go);
  } else {
    card.append(
      h('p', {
        className: 'muted',
        textContent: 'That was the last lesson of the chapter. More chapters are on the way.',
      }),
    );
  }
  card.append(actions);
  document.title = `Lesson complete · Malcotron`;
  return {
    el: h('div', { className: 'home' }, card),
    bottomEl: null,
    handleKey(event) {
      if (event.key === 'Enter' && following && !(event.target instanceof HTMLButtonElement)) {
        ctx.navigate(`/lesson/${following.id}/1`);
        return true;
      }
      return false;
    },
    destroy() {},
  };
}
