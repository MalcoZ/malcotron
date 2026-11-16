/** Home: what comes next, the chapter list, and pieces for free practice. */
import type { AppContext, View } from './context';
import { h } from './dom';

export function createHome(ctx: AppContext): View {
  const { course, progress } = ctx;
  const ids = course.lessons.map((l) => l.id);
  const next = progress.next(ids);
  const nextLesson = next ? course.lessons.find((l) => l.id === next.lesson) : undefined;
  const started = progress.completedCount > 0 || progress.current !== null;

  const hero = h('section', { className: 'card hero' });
  if (nextLesson && next) {
    const number = ids.indexOf(nextLesson.id) + 1;
    const button = h('button', {
      type: 'button',
      className: 'btn btn-primary btn-large',
      id: 'continue',
      textContent: started ? 'Continue' : 'Start',
    });
    button.addEventListener('click', () =>
      ctx.navigate(`/lesson/${nextLesson.id}/${next.step + 1}`),
    );
    hero.append(
      h('p', { className: 'eyebrow', textContent: started ? 'Next up' : 'Start here' }),
      h('h2', { id: 'next-title', textContent: `Lesson ${number}: ${nextLesson.title}` }),
      h('p', { className: 'muted', textContent: nextLesson.summary }),
      button,
    );
  } else {
    hero.append(
      h('p', { className: 'eyebrow', textContent: 'All done' }),
      h('h2', { id: 'next-title', textContent: 'You have finished every lesson so far' }),
      h('p', {
        className: 'muted',
        textContent: 'More chapters are on the way. Any lesson can be read again below.',
      }),
    );
  }

  const chapters = course.chapters.map((chapter) => {
    const done = chapter.lessons.filter((l) => progress.isCompleted(l.id)).length;
    const list = h('ol', { className: 'lesson-list' });
    for (const lesson of chapter.lessons) {
      const completed = progress.isCompleted(lesson.id);
      const isNext = lesson.id === nextLesson?.id;
      const item = h(
        'li',
        { className: completed ? 'is-done' : isNext ? 'is-next' : '' },
        h(
          'a',
          { href: `#/lesson/${lesson.id}/1`, dataset: { lesson: lesson.id } },
          h('span', { className: 'lesson-title', textContent: lesson.title }),
          h('span', { className: 'lesson-summary', textContent: lesson.summary }),
          h('span', {
            className: 'lesson-state',
            textContent: completed ? '✓ Done' : isNext ? 'Next' : '',
          }),
        ),
      );
      list.append(item);
    }
    return h(
      'section',
      { className: 'card chapter', dataset: { chapter: chapter.id } },
      h(
        'div',
        { className: 'chapter-head' },
        h('h3', { textContent: chapter.title }),
        h('span', {
          className: 'muted chapter-count',
          textContent: `${done} of ${chapter.lessons.length} lessons done`,
        }),
      ),
      h('p', { className: 'muted', textContent: chapter.summary }),
      list,
    );
  });

  const pieceList = h('ul', { className: 'piece-list' });
  for (const piece of ctx.pieces) {
    pieceList.append(
      h(
        'li',
        {},
        h(
          'a',
          { href: `#/piece/${piece.id}`, dataset: { piece: piece.id } },
          h('span', { className: 'lesson-title', textContent: piece.title }),
          h('span', { className: 'lesson-summary', textContent: piece.composer }),
        ),
      ),
    );
  }
  const pieces = h(
    'section',
    { className: 'card' },
    h('h3', { textContent: 'Pieces and exercises' }),
    h('p', {
      className: 'muted',
      textContent: 'Open any of these to practise freely, at any tempo.',
    }),
    pieceList,
  );

  const el = h('div', { className: 'home', id: 'home' }, hero, ...chapters, pieces);
  return { el, bottomEl: null, destroy() {} };
}
