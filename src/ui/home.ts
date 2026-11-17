/** Home: what comes next, the course outline, and pieces for free practice. */
import type { AppContext, View } from './context';
import { h } from './dom';

export function createHome(ctx: AppContext): View {
  const { course, progress } = ctx;
  const ids = course.lessons.map((l) => l.id);
  const next = progress.next(ids);
  const nextLesson = next ? course.lessons.find((l) => l.id === next.lesson) : undefined;
  const started = progress.completedCount > 0 || progress.current !== null;

  // Once some notes are known, the day's work is a session: reviews, then the next lesson.
  const skills = ctx.engine.summary();
  const hasSkills = skills.learning + skills.mastered > 0;
  const startSession = () => {
    const plan = ctx.engine.plan({
      nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
      pieces: ctx.pieces,
    });
    ctx.session = { plan, index: 0, accuracies: [] };
    ctx.navigate('/session');
  };

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
      h(
        'div',
        {},
        h('p', { className: 'eyebrow', textContent: started ? 'Next up' : 'Start here' }),
        h('h2', { id: 'next-title', textContent: `Lesson ${number}: ${nextLesson.title}` }),
        h('p', { className: 'muted', textContent: nextLesson.summary }),
      ),
      button,
    );
    if (hasSkills) button.className = 'btn btn-large';
  } else {
    hero.append(
      h(
        'div',
        {},
        h('p', { className: 'eyebrow', textContent: 'All done' }),
        h('h2', { id: 'next-title', textContent: 'You have finished every lesson so far' }),
        h('p', {
          className: 'muted',
          textContent: 'More chapters are on the way. Any lesson can be read again below.',
        }),
      ),
    );
  }

  if (hasSkills) {
    const plan = ctx.engine.plan({
      nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
      pieces: ctx.pieces,
    });
    const session = h('button', {
      type: 'button',
      className: 'btn btn-primary btn-large',
      id: 'start-session',
      textContent: `Start session · about ${plan.minutes} min`,
    });
    session.addEventListener('click', startSession);
    hero.append(session);
    hero.firstElementChild?.append(
      h('p', {
        className: 'muted small',
        id: 'skill-summary',
        textContent: `${skills.due} to review today · ${skills.learning} skills being learned · ${skills.mastered} mastered`,
      }),
    );
  }

  // The course outline is one card: the chapters down the left, and the lessons of
  // one chapter on the right (the one holding the next lesson, until another is
  // chosen). With eight chapters, stacking them would push Home past one screen.
  const currentChapter =
    course.chapters.find((c) => c.lessons.some((l) => l.id === nextLesson?.id)) ??
    course.chapters.at(-1)!;
  const doneIn = (chapter: (typeof course.chapters)[number]) =>
    chapter.lessons.filter((l) => progress.isCompleted(l.id)).length;
  const pane = h('div', { className: 'chapter-pane' });
  const chapterNav = h('nav', { className: 'chapter-nav', ariaLabel: 'Chapters' });
  const tabs = course.chapters.map((chapter, index) => {
    const done = doneIn(chapter);
    const all = chapter.lessons.length;
    const tab = h(
      'button',
      {
        type: 'button',
        className: 'chapter-tab',
        title: chapter.summary,
        dataset: { chapterTab: chapter.id },
      },
      h('span', { className: 'chapter-number', textContent: String(index + 1) }),
      h('span', {
        className: 'chapter-name',
        textContent: chapter.title.replace(/^Chapter \d+:\s*/, ''),
      }),
      h('span', {
        className: 'chapter-tally',
        textContent: done === all ? '✓' : done > 0 ? `${done}/${all}` : '',
      }),
    );
    tab.addEventListener('click', () => showChapter(chapter));
    chapterNav.append(tab);
    return tab;
  });

  const showChapter = (chapter: (typeof course.chapters)[number]) => {
    for (const [i, tab] of tabs.entries()) {
      tab.setAttribute('aria-pressed', String(course.chapters[i] === chapter));
    }
    // Lessons are numbered through the whole course, as on the "next up" card.
    const list = h('ol', { className: 'lesson-list' });
    const first = course.lessons.findIndex((l) => l.id === chapter.lessons[0]?.id);
    list.style.counterReset = `lesson ${Math.max(first, 0)}`;
    for (const lesson of chapter.lessons) {
      const completed = progress.isCompleted(lesson.id);
      const isNext = lesson.id === nextLesson?.id;
      const accuracy = progress.record(lesson.id)?.accuracy;
      const state = completed
        ? accuracy !== null && accuracy !== undefined
          ? `✓ Done · ${Math.round(accuracy * 100)}%`
          : '✓ Done'
        : isNext
          ? 'Next'
          : '';
      list.append(
        h(
          'li',
          { className: completed ? 'is-done' : isNext ? 'is-next' : '' },
          h(
            'a',
            { href: `#/lesson/${lesson.id}/1`, dataset: { lesson: lesson.id } },
            h('span', { className: 'lesson-title', textContent: lesson.title }),
            h('span', { className: 'lesson-summary', textContent: lesson.summary }),
            h('span', { className: 'lesson-state', textContent: state }),
          ),
        ),
      );
    }
    pane.dataset.chapter = chapter.id;
    pane.replaceChildren(
      h(
        'div',
        { className: 'chapter-head' },
        h('h3', { textContent: chapter.title }),
        h('span', {
          className: 'muted chapter-count',
          textContent: `${doneIn(chapter)} of ${chapter.lessons.length} lessons done`,
        }),
      ),
      h('p', { className: 'muted chapter-summary', textContent: chapter.summary }),
      list,
    );
  };
  showChapter(currentChapter);
  const outline = h('section', { className: 'card course', id: 'course' }, chapterNav, pane);

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
    'details',
    { className: 'card chapter', id: 'pieces' },
    h(
      'summary',
      { className: 'chapter-head' },
      h('h3', { textContent: 'Pieces and exercises' }),
      h('span', {
        className: 'muted chapter-summary',
        textContent: 'Practise freely, at any tempo.',
      }),
      h('span', { className: 'muted chapter-count', textContent: `${ctx.pieces.length} pieces` }),
    ),
    pieceList,
  );

  const el = h('div', { className: 'home', id: 'home' }, hero, outline, pieces);
  return { el, bottomEl: null, destroy() {} };
}
