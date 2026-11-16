import { expect, test } from '@playwright/test';
import { noteXs, openPiece, PIECES, trackErrors } from './helpers';

test('the page loads and draws Ode to Joy as 8 bars of SVG', async ({ page }) => {
  const errors = trackErrors(page);
  await openPiece(page);
  await expect(page).toHaveTitle(/Ode to Joy/);
  await expect(page.locator('.piece-title')).toHaveText('Ode to Joy');
  await expect(page.locator('#score svg').first()).toBeVisible();

  // One notation stave per bar (the tab staves live in their own hidden group).
  const staves = page.locator('#score svg .vf-stave:not(.malco-tab .vf-stave)');
  await expect(staves).toHaveCount(8);
  const bars = await page
    .locator('.malco-note')
    .evaluateAll((els) => new Set(els.map((el) => (el as SVGGElement).dataset.bar)).size);
  expect(bars).toBe(8);
  await expect(page.locator('.malco-note')).toHaveCount(30);
  expect(errors).toEqual([]);
});

for (const piece of PIECES) {
  test(`${piece.title} renders without console errors and every note has a handle`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openPiece(page, piece.id);
    await expect(page.locator('.piece-title')).toHaveText(piece.title);
    await expect(page.locator('.malco-note')).toHaveCount(piece.notes);

    const report = await page.evaluate(() => {
      const { renderer, player } = (window as any).malcotron;
      const events = player.currentTimeline.events as { barIndex: number; noteIndex: number }[];
      const handles = [...renderer.handles.values()];
      return {
        events: events.length,
        handles: handles.length,
        bars: new Set(handles.map((h: any) => h.barIndex)).size,
        missing: events.filter((e) => !renderer.getHandle(e.barIndex, e.noteIndex)).length,
        detached: handles.filter((h: any) => !h.el.isConnected).length,
        withoutTab: handles.filter((h: any) => !h.isRest && !h.tabEl?.isConnected).length,
        badX: handles.filter((h: any) => !(h.x > 0)).length,
        systems: renderer.systems.length,
      };
    });
    expect(report).toMatchObject({
      events: piece.notes,
      handles: piece.notes,
      bars: piece.bars,
      missing: 0,
      detached: 0,
      withoutTab: 0,
      badX: 0,
    });
    expect(report.systems).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

test('Peek tab shows and hides the tab without moving the notation', async ({ page }) => {
  await openPiece(page);
  const tab = page.locator('.malco-tab').first();
  const button = page.locator('#peek-tab');
  await expect(tab).toBeHidden();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const before = await noteXs(page);
  expect(before).toHaveLength(30);
  expect(new Set(before).size).toBeGreaterThan(10); // real positions, not one repeated value

  await button.click();
  await expect(tab).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.malco-tabnote').first()).toBeVisible();
  expect(await noteXs(page)).toEqual(before);

  // The T key toggles it too.
  await page.locator('body').press('t');
  await expect(tab).toBeHidden();
  expect(await noteXs(page)).toEqual(before);
  await page.locator('body').press('t');
  await expect(tab).toBeVisible();
  expect(await noteXs(page)).toEqual(before);
});

test('tab frets follow the fingering rules', async ({ page }) => {
  const fretOf = (bar: number, note: number) =>
    page.evaluate(
      ([b, n]) => (window as any).malcotron.renderer.getHandle(b, n).tabEl.textContent.trim(),
      [bar, note],
    );
  await openPiece(page, 'ode-to-joy');
  expect(await fretOf(0, 3)).toBe('3'); // G5: string 1, fret 3
  expect(await fretOf(0, 0)).toBe('0'); // E5: string 1, open
  await openPiece(page, 'p2-low-strings');
  expect(await fretOf(1, 1)).toBe('0'); // E3: string 6, open
  await openPiece(page, 'p4-g-waltz');
  expect(await fretOf(2, 0)).toBe('4'); // F#4: string 4, fret 4
});

test('fingering markers have three levels and the position label reads "Open"', async ({
  page,
}) => {
  await openPiece(page);
  // Finger numbers and string numbers are the bold text items inside each note.
  const marks = () => page.locator('.malco-note text[font-weight="bold"]').count();
  const label = page.locator('#score svg text', { hasText: /^Open$/ });

  expect(await marks()).toBe(30 * 2);
  await expect(label).toHaveCount(await page.locator('.system').count());

  await page.locator('#fingering-level').selectOption('first-of-bar');
  expect(await marks()).toBe(8 * 2);
  await expect(label.first()).toBeVisible();

  await page.locator('#fingering-level').selectOption('none');
  expect(await marks()).toBe(0);
  await expect(label).toHaveCount(0);
});

test('the waltz shows F sharp in the key signature and no accidentals on notes', async ({
  page,
}) => {
  await openPiece(page, 'p4-g-waltz');
  await expect(page.locator('#score svg .vf-keysignature').first()).toBeAttached();
  // With markers off, the only music glyphs in the notes are 21 noteheads and the dots of
  // the two dotted notes: no accidental is drawn on any F sharp.
  await page.locator('#fingering-level').selectOption('none');
  await expect(page.locator('.malco-note .vf-notehead text[font-size="30pt"]')).toHaveCount(21 + 2);
  await expect(page.locator('.piece-meta')).toHaveText('Key of G · 3/4');
});

test('the theme toggle switches colours and survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openPiece(page);
  const html = page.locator('html');
  const bodyColor = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const inkColor = () =>
    page.evaluate(() => document.querySelector('.malco-note')!.getAttribute('fill'));

  await expect(html).toHaveAttribute('data-theme', 'light');
  const lightBg = await bodyColor();
  const lightInk = await inkColor();

  await page.locator('#theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await bodyColor()).not.toBe(lightBg);
  // The notation is redrawn in the new ink colour, not inverted.
  expect(await inkColor()).not.toBe(lightInk);
  const filters = await page.evaluate(() =>
    [document.documentElement, document.body, document.querySelector('#score')!].map(
      (el) => getComputedStyle(el).filter,
    ),
  );
  expect(filters).toEqual(['none', 'none', 'none']);

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await inkColor()).not.toBe(lightInk);

  await page.locator('#theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await bodyColor()).toBe(lightBg);
});

test('follows the system colour scheme until a theme is chosen', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openPiece(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the score is redrawn to fit when the window is resized or the staff is zoomed', async ({
  page,
}) => {
  await openPiece(page);
  const systems = page.locator('.system');
  const svgWidth = () =>
    page.evaluate(() => document.querySelector('.system svg')!.getBoundingClientRect().width);
  const scoreWidth = () => page.evaluate(() => document.querySelector('#score')!.clientWidth);
  expect(await svgWidth()).toBe(await scoreWidth());
  const wide = await svgWidth();

  // Narrower window: redrawn (after the debounce) at the new width, nothing lost.
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect.poll(svgWidth).toBeLessThan(wide);
  expect(await svgWidth()).toBe(await scoreWidth());
  await expect(page.locator('.malco-note')).toHaveCount(30);
  await expect(page.locator('#narrow-note')).toBeHidden();
  const lastBarEnd = await page.evaluate(() => (window as any).malcotron.renderer.systems[0].endX);
  expect(lastBarEnd).toBeLessThanOrEqual(await scoreWidth());

  // Larger staff: fewer bars fit on a line, so the bars flow onto more systems.
  const before = await systems.count();
  const height = async () => (await systems.first().boundingBox())!.height;
  const beforeHeight = await height();
  await page.locator('#zoom-select').selectOption({ label: '160%' });
  expect(await systems.count()).toBeGreaterThan(before);
  expect(await height()).toBeGreaterThan(beforeHeight);
  await expect(page.locator('.malco-note')).toHaveCount(30);
});

test('shows a note on screens narrower than 1024 px', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openPiece(page);
  await expect(page.locator('#narrow-note')).toBeVisible();
  await expect(page.locator('#narrow-note')).toContainText('larger screen');
});

test('the score area takes at least 60% of the window height', async ({ page }) => {
  await openPiece(page);
  const box = (await page.locator('#score-area').boundingBox())!;
  expect(box.height / 800).toBeGreaterThanOrEqual(0.6);
});

test('the About link credits the sample license', async ({ page }) => {
  await openPiece(page);
  await page.locator('#about-link').click();
  const dialog = page.locator('#about-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Fluid (R3) General MIDI SoundFont');
  await expect(dialog).toContainText('Creative Commons Attribution 3.0');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('fret, finger and string numbers are drawn in the UI font, not the music font', async ({
  page,
}) => {
  await openPiece(page, 'p4-g-waltz');
  await page.locator('#peek-tab').click();
  const fonts = await page.evaluate(() => {
    const family = (el: Element) => getComputedStyle(el).fontFamily;
    return {
      tab: [...document.querySelectorAll('.malco-tabnote text')].map(family),
      marks: [...document.querySelectorAll('.malco-note text[font-weight="bold"]')].map(family),
      texts: [...document.querySelectorAll('.malco-tabnote text')].map((el) => el.textContent),
    };
  });
  expect(fonts.tab).toHaveLength(21);
  for (const family of [...fonts.tab, ...fonts.marks]) {
    expect(family).toContain('system-ui');
    expect(family).not.toContain('Bravura');
  }
  // Every fret is a plain number.
  for (const text of fonts.texts) expect(text).toMatch(/^\d+$/);
});

test('a one-line piece with its tab fits a laptop screen without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const id of ['p1-first-steps', 'p2-low-strings']) {
    await openPiece(page, id);
    await page.locator('#peek-tab').click();
    const { view, content } = await page.evaluate(() => {
      const area = document.querySelector('#score-area')!;
      return { view: area.clientHeight, content: area.scrollHeight };
    });
    expect(content).toBeLessThanOrEqual(view);
  }
});

test('systems are only as tall as their notes need, and nothing is clipped', async ({ page }) => {
  await openPiece(page, 'p2-low-strings');
  await page.locator('#peek-tab').click();
  const low = (await page.locator('.system').first().boundingBox())!.height;
  // Every stem, marker and tab number lies inside its system (systems clip what overflows).
  const outside = async () =>
    page.evaluate(() => {
      let count = 0;
      for (const system of document.querySelectorAll('.system')) {
        const box = system.getBoundingClientRect();
        // Stems and numbers: music glyphs are left out, as their text boxes are much taller
        // than what is drawn.
        for (const el of system.querySelectorAll(
          '.vf-stem, .malco-tabnote text, .malco-note text[font-weight="bold"]',
        )) {
          const r = el.getBoundingClientRect();
          if (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5) count++;
        }
      }
      return count;
    });
  expect(await outside()).toBe(0);
  await openPiece(page, 'ode-to-joy');
  await page.locator('#peek-tab').click();
  expect(await outside()).toBe(0);
  // Ledger lines below the staff make the low piece's system taller than Ode to Joy's.
  expect(low).toBeGreaterThan((await page.locator('.system').first().boundingBox())!.height);
});
