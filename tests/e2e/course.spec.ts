import { expect, test, type Page } from '@playwright/test';
import { openRoute, setTempo, trackErrors, waitForSound } from './helpers';

test.use({ viewport: { width: 1280, height: 720 } });

/** Record metronome clicks and melody notes with their exact audio times. */
async function recordAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log = { clicks: [] as { beat: number; accent: boolean; time: number }[], notes: 0 };
    Object.assign(window, { __audio: log });
    const { player } = (window as any).malcotron;
    player.onClick((click: any, time: number) => log.clicks.push({ ...click, time }));
    player.onNote(() => log.notes++);
  });
}

const audio = (page: Page) =>
  page.evaluate(
    () =>
      (window as any).__audio as {
        clicks: { beat: number; accent: boolean; time: number }[];
        notes: number;
      },
  );

const overflow = (page: Page) =>
  page.evaluate(() => {
    const area = document.querySelector('#score-area')!;
    return area.scrollHeight - area.clientHeight;
  });

test('Home says where to start and lists the chapter', async ({ page }) => {
  const errors = trackErrors(page);
  await openRoute(page);
  await expect(page.locator('#next-title')).toHaveText('Lesson 1: Reading from the staff');
  await expect(page.locator('#continue')).toHaveText('Start');
  await expect(page.locator('.chapter h3')).toHaveText('Chapter 1: First notes');
  await expect(page.locator('.lesson-list li')).toHaveCount(10);
  await expect(page.locator('.chapter-count')).toHaveText('0 of 10 lessons done');
  await expect(page.locator('.lesson-list li.is-next .lesson-title')).toHaveText(
    'Reading from the staff',
  );
  await expect(page.locator('.piece-list li')).toHaveCount(4);

  await page.locator('#continue').click();
  await expect(page).toHaveURL(/#\/lesson\/p1-the-staff\/1$/);
  await expect(page.locator('#lesson-title')).toHaveText('Lesson 1: Reading from the staff');
  await expect(page.locator('#step-title')).toHaveText('Welcome');
  await expect(page.locator('#step-count')).toHaveText('Step 1 of 5');
  // A text-only step has no score and no playback controls, only Back and Next.
  await expect(page.locator('#score')).toHaveCount(0);
  await expect(page.locator('#play')).toHaveCount(0);
  await expect(page.locator('#back')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('a lesson is read one step at a time with Next, Back and Enter', async ({ page }) => {
  const errors = trackErrors(page);
  await openRoute(page, '/lesson/p1-open-strings/1');
  await waitForSound(page);
  await expect(page.locator('#step-title')).toHaveText('Three notes to start');
  await expect(page.locator('#step-text strong').first()).toHaveText('3rd');
  // An explain step: Listen and Peek tab, but no Your turn or click.
  await expect(page.locator('#play')).toHaveText('Listen');
  await expect(page.locator('#turn')).toBeHidden();
  await expect(page.locator('#metronome')).toBeHidden();
  // Letter names sit under the notes, and this step shows its tab.
  await expect(page.locator('.malco-labels text')).toHaveText(['G', 'B', 'E', 'B']);
  await expect(page.locator('.malco-tab').first()).toBeVisible();

  await page.locator('#next').click();
  await expect(page).toHaveURL(/p1-open-strings\/2$/);
  await expect(page.locator('#step-count')).toHaveText('Step 2 of 5');
  await expect(page.locator('.malco-labels text')).toHaveText([
    '2nd line',
    'middle line',
    'top space',
  ]);
  await expect(page.locator('.malco-tab').first()).toBeHidden();
  await expect(page.locator('#step-progress')).toHaveJSProperty('value', 2);

  // Enter is Next.
  await page.locator('body').press('Enter');
  await expect(page.locator('#step-title')).toHaveText('Up and down');
  await expect(page.locator('#turn')).toBeVisible();
  await expect(page.locator('#metronome')).toBeVisible();

  // Listening works after moving between steps without a page load.
  await setTempo(page, 220);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await expect(page.locator('#turn')).toBeDisabled();
  await expect(page.locator('.malco-note.is-current')).toHaveCount(1);
  await expect(page.locator('#play')).toHaveText('Listen', { timeout: 15_000 });

  await page.locator('#back').click();
  await expect(page.locator('#step-title')).toHaveText('Where they sit');
  // The browser's own Back button works too.
  await page.goBack();
  await expect(page.locator('#step-title')).toHaveText('Up and down');
  expect(errors).toEqual([]);
});

test('moving to another step stops playback', async ({ page }) => {
  await openRoute(page, '/lesson/p1-string-3/4');
  await waitForSound(page);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await page.locator('#next').click();
  await expect(page.locator('#step-title')).toHaveText('G and A');
  await expect(page.locator('#play')).toHaveText('Listen');
  expect(await page.evaluate(() => (window as any).malcotron.clock.state)).toBe('stopped');
  await expect(page.locator('.is-current')).toHaveCount(0);
});

test('every step of every lesson draws without errors and fits the screen without scrolling', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openRoute(page);
  const lessons = await page.evaluate(() =>
    (window as any).malcotron.course.lessons.map((l: any) => ({
      id: l.id,
      steps: l.steps.map((s: any) => ({
        title: s.title,
        notes: s.piece ? s.piece.bars.flat().length : 0,
        labels: s.labels.size,
      })),
    })),
  );
  expect(lessons).toHaveLength(10);
  let steps = 0;
  const tooTall: string[] = [];
  for (const lesson of lessons as {
    id: string;
    steps: { title: string; notes: number; labels: number }[];
  }[]) {
    for (const [i, step] of lesson.steps.entries()) {
      await page.evaluate((hash) => (location.hash = hash), `#/lesson/${lesson.id}/${i + 1}`);
      await expect(page.locator('#step-count')).toHaveText(
        `Step ${i + 1} of ${lesson.steps.length}`,
      );
      await expect(page.locator('#step-title')).toHaveText(step.title);
      await expect(page.locator('.malco-note')).toHaveCount(step.notes);
      await expect(page.locator('.malco-labels text')).toHaveCount(step.labels);
      const extra = await overflow(page);
      if (extra > 0) tooTall.push(`${lesson.id} step ${i + 1}: ${extra}px too tall`);
      // Nothing is cut off sideways either.
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(wide, `${lesson.id} step ${i + 1}`).toBeLessThanOrEqual(0);
      steps++;
    }
  }
  expect(tooTall).toEqual([]);
  expect(steps).toBe(48);
  expect(errors).toEqual([]);
});

test('note labels are drawn in the UI font, inside their system, in both themes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openRoute(page, '/lesson/r1-long-notes/3');
  const check = () =>
    page.evaluate(() => {
      const system = document.querySelector('.system')!.getBoundingClientRect();
      return [...document.querySelectorAll('.malco-labels text')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent,
          inside: r.top >= system.top && r.bottom <= system.bottom + 0.5,
          font: getComputedStyle(el).fontFamily.includes('system-ui'),
          fill: getComputedStyle(el).fill,
        };
      });
    });
  const dark = await check();
  expect(dark.map((l) => l.text)).toEqual(['1', '2', '3', '4', '1 2', '3 4', '1 2 3 4']);
  expect(dark.every((l) => l.inside && l.font)).toBe(true);
  await page.locator('#theme-toggle').click();
  const light = await check();
  expect(light.every((l) => l.inside && l.font)).toBe(true);
  expect(light[0]!.fill).not.toBe(dark[0]!.fill);
});

test('Your turn counts in for a bar, clicks through the exercise and plays no melody', async ({
  page,
}) => {
  await openRoute(page, '/lesson/r1-the-beat/4');
  await waitForSound(page);
  await setTempo(page, 200);
  await recordAudio(page);
  await expect(page.locator('#self-check')).toBeHidden();

  // Watch the count-in display and the highlight while it runs.
  await page.evaluate(() => {
    const seen = { counts: [] as string[], highlightDuringCountIn: false };
    Object.assign(window, { __seen: seen });
    const sample = () => {
      const { clock } = (window as any).malcotron;
      const count = document.querySelector('#count-in')!.textContent ?? '';
      if (count && seen.counts.at(-1) !== count) seen.counts.push(count);
      if (clock.state === 'running' && clock.beat < -0.1 && document.querySelector('.is-current')) {
        seen.highlightDuringCountIn = true;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.locator('body').press('r');
  await expect(page.locator('#turn')).toHaveText('Stop');
  await expect(page.locator('#play')).toBeDisabled();
  // 4 beats of count-in and 8 of music at 200 BPM is under 4 seconds.
  await expect(page.locator('#self-check')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#turn')).toHaveText('Your turn');

  const log = await audio(page);
  expect(log.notes).toBe(0); // the melody stays silent while the learner plays
  expect(log.clicks.map((c) => c.beat)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]);
  expect(log.clicks.filter((c) => c.accent).map((c) => c.beat)).toEqual([-4, 0, 4]);
  for (const click of log.clicks) {
    expect(click.time - log.clicks[0]!.time).toBeCloseTo(((click.beat + 4) * 60) / 200, 3);
  }
  const seen = await page.evaluate(() => (window as any).__seen);
  expect(seen.counts).toEqual(['1', '2', '3', '4']);
  expect(seen.highlightDuringCountIn).toBe(false);
  await expect(page.locator('#count-in')).toHaveText('');

  // "Again" runs another pass; "Got it" points to Next.
  await page.locator('#again').click();
  await expect(page.locator('#turn')).toHaveText('Stop');
  await expect(page.locator('#self-check')).toBeHidden();
  await expect(page.locator('#self-check')).toBeVisible({ timeout: 15_000 });
  await page.locator('#got-it').click();
  await expect(page.locator('#self-check-result')).toContainText('Press Next');
});

test('stopping Your turn early does not ask how it went', async ({ page }) => {
  await openRoute(page, '/lesson/r1-the-beat/4');
  await waitForSound(page);
  await page.locator('#turn').click();
  await expect(page.locator('#turn')).toHaveText('Stop');
  await page.locator('#turn').click();
  await expect(page.locator('#turn')).toHaveText('Your turn');
  await expect(page.locator('#self-check')).toBeHidden();
});

test('the click can be switched on for Listen, in time with the notes', async ({ page }) => {
  await openRoute(page, '/piece/p4-g-waltz');
  await waitForSound(page);
  await setTempo(page, 220);
  await recordAudio(page);
  const noteTimes: number[] = [];
  await page.evaluate(() => {
    const times: number[] = [];
    Object.assign(window, { __noteTimes: times });
    (window as any).malcotron.player.onNote((_e: unknown, t: number) => times.push(t));
  });
  await expect(page.locator('#metronome')).toHaveText('Click: off');
  await page.locator('body').press('m');
  await expect(page.locator('#metronome')).toHaveText('Click: on');
  await expect(page.locator('#metronome')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await expect(page.locator('#play')).toHaveText('Listen', { timeout: 15_000 });
  const log = await audio(page);
  noteTimes.push(...(await page.evaluate(() => (window as any).__noteTimes as number[])));
  // 3/4: 18 beats, no count-in when listening, accents every three beats.
  expect(log.clicks.map((c) => c.beat)).toEqual([...Array(18).keys()]);
  expect(log.clicks.filter((c) => c.accent).map((c) => c.beat)).toEqual([0, 3, 6, 9, 12, 15]);
  expect(log.notes).toBe(21);
  // The first click and the first note land at the same instant, and clicks stay on the grid.
  expect(log.clicks[0]!.time).toBeCloseTo(noteTimes[0]!, 4);
  for (const click of log.clicks) {
    expect(click.time - log.clicks[0]!.time).toBeCloseTo((click.beat * 60) / 220, 3);
  }
});

for (const bpm of [30, 80]) {
  test(`count-in clicks are on the beat at ${bpm} BPM, and follow a tempo change`, async ({
    page,
  }) => {
    await openRoute(page, '/lesson/r1-the-beat/4');
    await waitForSound(page);
    await setTempo(page, bpm);
    await recordAudio(page);
    await page.locator('#turn').click();
    await expect.poll(async () => (await audio(page)).clicks.length, { timeout: 15_000 }).toBe(3);
    await setTempo(page, 220);
    // The rest runs at the new tempo, to the end, without a restart.
    await expect(page.locator('#self-check')).toBeVisible({ timeout: 15_000 });
    const { clicks } = await audio(page);
    expect(clicks[1]!.time - clicks[0]!.time).toBeCloseTo(60 / bpm, 3);
    expect(clicks[2]!.time - clicks[1]!.time).toBeCloseTo(60 / bpm, 3);
    expect(clicks).toHaveLength(12);
    expect(clicks[8]!.time - clicks[7]!.time).toBeCloseTo(60 / 220, 3);
  });
}

test('finishing a lesson ticks it off, moves Continue on, and survives a reload', async ({
  page,
}) => {
  await openRoute(page, '/lesson/p1-the-staff/1');
  for (let step = 1; step < 5; step++) {
    await expect(page.locator('#step-count')).toHaveText(`Step ${step} of 5`);
    await page.locator('#next').click();
  }
  await expect(page.locator('#step-count')).toHaveText('Step 5 of 5');
  await expect(page.locator('#next')).toHaveText('Finish lesson');
  await page.locator('#next').click();

  await expect(page).toHaveURL(/p1-the-staff\/done$/);
  const done = page.locator('#lesson-done');
  await expect(done).toContainText('Lesson 1 complete');
  await expect(done).toContainText('Next: Three open strings: G, B and E');
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.locator('#done-home').click();
  await expect(page.locator('#next-title')).toHaveText('Lesson 2: Three open strings: G, B and E');
  await expect(page.locator('#continue')).toHaveText('Continue');
  await expect(page.locator('.chapter-count')).toHaveText('1 of 10 lessons done');
  await expect(page.locator('.lesson-list li').first().locator('.lesson-state')).toHaveText(
    '✓ Done',
  );

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.chapter-count')).toHaveText('1 of 10 lessons done');
  await expect(page.locator('#next-title')).toHaveText('Lesson 2: Three open strings: G, B and E');

  // Continue returns to the step the learner was on.
  await page.locator('#continue').click();
  await page.locator('#next').click();
  await page.locator('#next').click();
  await expect(page.locator('#step-count')).toHaveText('Step 3 of 5');
  await page.locator('#home-link').click();
  await page.locator('#continue').click();
  await expect(page).toHaveURL(/p1-open-strings\/3$/);
});

test('the lesson-complete panel leads to the next lesson', async ({ page }) => {
  await openRoute(page, '/lesson/p1-the-staff/done');
  await page.locator('#done-next').click();
  await expect(page.locator('#lesson-title')).toHaveText(
    'Lesson 2: Three open strings: G, B and E',
  );
  await openRoute(page, '/lesson/piece-ode-to-joy/done');
  await expect(page.locator('#lesson-done')).toContainText('last lesson of the chapter');
  await expect(page.locator('#done-next')).toHaveCount(0);
});

test('progress can be reset from the About dialog', async ({ page }) => {
  await openRoute(page, '/lesson/p1-the-staff/5');
  await page.locator('#next').click();
  await page.locator('#done-home').click();
  await expect(page.locator('.chapter-count')).toHaveText('1 of 10 lessons done');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('#about-link').click();
  await page.locator('#reset-progress').click();
  await expect(page.locator('.chapter-count')).toHaveText('0 of 10 lessons done');
  await expect(page.locator('#continue')).toHaveText('Start');
});

test('damaged saved progress is ignored', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('malcotron.progress', '{broken'));
  const errors = trackErrors(page);
  await openRoute(page);
  await expect(page.locator('#continue')).toHaveText('Start');
  expect(errors).toEqual([]);
});

test('links go straight to a step, and unknown addresses go Home', async ({ page }) => {
  await openRoute(page, '/lesson/p1-string-1/2');
  await expect(page.locator('#step-title')).toHaveText('Steps on the staff');
  await openRoute(page, '/lesson/p1-string-1/99');
  await expect(page.locator('#step-count')).toHaveText('Step 5 of 5');
  for (const route of ['/lesson/no-such-lesson/1', '/piece/no-such-piece', '/somewhere-else']) {
    await openRoute(page, route);
    await expect(page.locator('#home')).toBeVisible();
  }
});

test('pieces stay available for free practice, with their source shown', async ({ page }) => {
  await openRoute(page);
  await page.locator('.piece-list a[data-piece="ode-to-joy"]').click();
  await expect(page).toHaveURL(/#\/piece\/ode-to-joy$/);
  await expect(page.locator('.piece-title')).toHaveText('Ode to Joy');
  await expect(page.locator('#piece-source')).toContainText('Symphony No. 9');
  await expect(page.locator('.malco-note')).toHaveCount(30);
  await expect(page.locator('#turn')).toBeVisible();
  await expect(page.locator('#fingering-level')).toBeVisible();
  // Arrow keys change the tempo by 5.
  await page.locator('body').press('ArrowRight');
  await expect(page.locator('#tempo-readout')).toHaveText('85');
  await page.locator('body').press('ArrowLeft');
  await page.locator('body').press('ArrowLeft');
  await expect(page.locator('#tempo-readout')).toHaveText('75');
  await page.locator('#home-link').click();
  await expect(page.locator('#home')).toBeVisible();
});

test('the final check of Chapter 1 plays the whole of Ode to Joy and the page follows', async ({
  page,
}) => {
  await openRoute(page, '/lesson/piece-ode-to-joy/5');
  await waitForSound(page);
  await expect(page.locator('.malco-note')).toHaveCount(30);
  await expect(page.locator('.system')).toHaveCount(2);
  await page.locator('#peek-tab').click(); // with tab the second line starts off screen
  await setTempo(page, 220);
  await page.locator('#play').click();
  const systemOfPlayhead = () =>
    page.evaluate(
      () => document.querySelector<HTMLElement>('.playhead')?.parentElement?.dataset.system ?? null,
    );
  await expect.poll(systemOfPlayhead, { timeout: 15_000 }).toBe('1');
  await expect(page.locator('.system[data-system="1"]')).toBeInViewport({ ratio: 0.95 });
  await expect(page.locator('#play')).toHaveText('Listen', { timeout: 15_000 });
});
