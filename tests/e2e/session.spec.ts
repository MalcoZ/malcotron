import { expect, test, type Page } from '@playwright/test';
import { openRoute, setTempo, trackErrors, waitForSound } from './helpers';

test.use({ viewport: { width: 1280, height: 720 } });

/** Swap the mic for a simulated learner who plays each Your turn pass, with these mistakes. */
async function simulateLearner(page: Page, mistakes: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate((m) => void (window as any).malcotron.simulateLearner(m), mistakes);
  await expect(page.locator('#mic-link')).toHaveText('Mic: on');
}

/** Finish a lesson by jumping to its last step and pressing Finish. */
async function finishLesson(page: Page, id: string): Promise<void> {
  // Step numbers past the end open the last step.
  await openRoute(page, `/lesson/${id}/99`);
  await expect(page.locator('#next')).toHaveText('Finish lesson');
  await page.locator('#next').click();
  await expect(page).toHaveURL(new RegExp(`${id}/done$`));
}

const engineState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('malcotron.engine') ?? 'null'));

test('a session runs start to finish: warm-up, reviews, the next lesson, a piece, a summary', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  // Finishing a lesson puts the skills it uses into "learning". These lessons cover
  // every note and rhythm of First Steps, so the session can end with it.
  for (const id of [
    'p1-open-strings',
    'r1-the-beat',
    'r1-long-notes',
    'p1-string-1',
    'p1-string-2',
    'p1-string-3',
  ]) {
    await finishLesson(page, id);
  }
  await page.locator('#done-home').click();
  await expect(page.locator('#start-session')).toBeVisible();
  await expect(page.locator('#start-session')).toContainText(/Start session · about \d+ min/);
  await expect(page.locator('#skill-summary')).toContainText('being learned');
  // The session is the main action now; the next lesson is still one click away.
  await expect(page.locator('#continue')).toBeVisible();

  const before = await engineState(page);
  expect(Object.values(before.skills).some((r: any) => r.status === 'learning')).toBe(true);

  await page.locator('#start-session').click();
  await expect(page).toHaveURL(/#\/session$/);
  await waitForSound(page);
  await simulateLearner(page);

  const blocks: string[] = [];
  const total = Number(/of (\d+)/.exec((await page.locator('#session-count').textContent())!)![1]);
  for (let item = 1; item <= total; item++) {
    await expect(page.locator('#session-count')).toHaveText(`${item} of ${total}`);
    const title = (await page.locator('#session-title').textContent()) ?? '';
    blocks.push(title.replace('Session: ', ''));
    if (await page.locator('#session-lesson').isVisible()) {
      // The next lesson, read through and finished, then back to the session.
      await page.locator('#session-lesson').click();
      await expect(page.locator('#lesson-title')).toBeVisible();
      const count = (await page.locator('#step-count').textContent())!;
      const steps = Number(/of (\d+)/.exec(count)![1]);
      for (let step = 1; step <= steps; step++) {
        await expect(page.locator('#step-count')).toHaveText(`Step ${step} of ${steps}`);
        await page.locator('#next').click();
      }
      await expect(page.locator('#lesson-done')).toBeVisible();
      await page.locator('#back-to-session').click();
      continue;
    }
    // An exercise or a piece: one graded take through the simulated mic.
    await expect(page.locator('.malco-note').first()).toBeAttached();
    await setTempo(page, 220);
    await page.locator('#turn').click();
    await expect(page.locator('#take-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#take-score')).toContainText('notes right');
    await page.locator('#next').click();
  }

  expect(blocks).toHaveLength(total);
  expect(blocks[0]).toBe('Warm-up');
  expect(blocks).toContain('Review');
  expect(blocks).toContain('New');
  expect(blocks.indexOf('Warm-up')).toBeLessThan(blocks.indexOf('Review'));
  expect(blocks.indexOf('Review')).toBeLessThan(blocks.indexOf('New'));
  expect(blocks.at(-1)).toBe('Play');

  await expect(page.locator('#session-done')).toBeVisible();
  await expect(page.locator('#session-done h2')).toContainText('% of notes right across');
  await expect(page.locator('#session-summary')).toContainText('skills mastered');

  const after = await engineState(page);
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  expect(after.sessionDays).toContain(today);
  // The takes were recorded against the skills they practised.
  const attempts = (s: any) =>
    Object.values(s.skills).reduce((n: number, r: any) => n + r.attempts, 0);
  expect(attempts(after)).toBeGreaterThan(attempts(before));
  // The lesson done in the session is ticked off on Home.
  await page.locator('#session-home').click();
  await expect(page.locator('.lesson-list a[data-lesson="p1-the-staff"]')).toContainText('✓ Done');
  expect(errors).toEqual([]);
});

test('skill state survives a reload, and damaged skill data starts fresh', async ({ page }) => {
  await finishLesson(page, 'p1-string-1');
  await page.locator('#done-home').click();
  const summary = await page.locator('#skill-summary').textContent();
  const saved = await engineState(page);
  expect(saved.version).toBe(1);
  // The 1st string's notes (open position) are now being learned.
  const note = Object.keys(saved.skills).find((id) => id.startsWith('pos0/str1/'))!;
  expect(note).toBeDefined();
  expect(saved.skills[note].status).toBe('learning');

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#skill-summary')).toHaveText(summary!);
  expect(
    await page.evaluate(() => Object.keys((window as any).malcotron.engine.state.skills).length),
  ).toBe(Object.keys(saved.skills).length);

  // A free-practice take updates stats but does not move the review schedule.
  await openRoute(page, '/piece/p1-first-steps');
  await waitForSound(page);
  await simulateLearner(page);
  await setTempo(page, 220);
  await page.locator('#turn').click();
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 30_000 });
  const free = await engineState(page);
  expect(free.skills[note].card.due).toBe(saved.skills[note].card.due);
  expect(free.skills[note].attempts).toBeGreaterThan(saved.skills[note].attempts);

  // Reset from About clears skills along with lesson progress.
  page.once('dialog', (dialog) => void dialog.accept());
  await openRoute(page);
  await page.locator('#about-link').click();
  await page.locator('#reset-progress').click();
  await expect(page.locator('#start-session')).toHaveCount(0);
  expect(await engineState(page)).toBeNull();

  const errors = trackErrors(page);
  await page.addInitScript(() => localStorage.setItem('malcotron.engine', '{broken'));
  await openRoute(page);
  await expect(page.locator('#start-session')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('without a mic, the self-check stands in for a grade in a session', async ({ page }) => {
  await finishLesson(page, 'p1-open-strings');
  await page.locator('#done-home').click();
  await page.locator('#start-session').click();
  await waitForSound(page);
  await expect(page.locator('#session-title')).toHaveText('Session: Warm-up');
  const before = await engineState(page);
  await setTempo(page, 220);
  await page.locator('#turn').click();
  await expect(page.locator('#self-check')).toBeVisible({ timeout: 20_000 });
  await page.locator('#got-it').click();
  const after = await engineState(page);
  const total = (s: any) =>
    Object.values(s.skills).reduce((n: number, r: any) => n + r.attempts, 0);
  expect(total(after)).toBeGreaterThan(total(before));
  // Leaving a session goes Home; a reload of the session address starts nowhere.
  await page.locator('#leave-session').click();
  await expect(page.locator('#home')).toBeVisible();
  await openRoute(page, '/session');
  await expect(page.locator('#home')).toBeVisible();
});

test('lessons tick off across the new chapters', async ({ page }) => {
  await finishLesson(page, 'r2-dotted-half');
  await expect(page.locator('#lesson-done')).toContainText('Lesson 15 complete');
  await page.locator('#done-home').click();
  // Home still points at the first unfinished lesson, in Chapter 1.
  await expect(page.locator('.chapter-pane')).toHaveAttribute('data-chapter', 'chapter-1');
  await expect(page.locator('[data-chapter-tab="chapter-3"] .chapter-tally')).toHaveText('1/4');
  await page.locator('[data-chapter-tab="chapter-3"]').click();
  await expect(page.locator('.chapter-pane .chapter-count')).toHaveText('1 of 4 lessons done');
  await expect(
    page.locator('.lesson-list a[data-lesson="r2-dotted-half"] .lesson-state'),
  ).toHaveText('✓ Done');

  // A whole chapter done shows a tick beside it.
  for (const id of ['p2-string-4', 'p2-string-5', 'p2-string-6', 'p2-low-phrases']) {
    await finishLesson(page, id);
  }
  await page.locator('#done-home').click();
  await expect(page.locator('[data-chapter-tab="chapter-2"] .chapter-tally')).toHaveText('✓');
});
