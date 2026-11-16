import { expect, type Page } from '@playwright/test';

export const PIECES = [
  { id: 'ode-to-joy', title: 'Ode to Joy', bars: 8, notes: 30 },
  { id: 'p1-first-steps', title: 'First Steps', bars: 4, notes: 11 },
  { id: 'p2-low-strings', title: 'Down Low', bars: 4, notes: 13 },
  { id: 'p4-g-waltz', title: 'Little Waltz in G', bars: 6, notes: 21 },
] as const;

/** Collect console errors and uncaught exceptions for the life of the page. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Open a piece and wait until the notation has been drawn. */
export async function openPiece(page: Page, id?: string): Promise<void> {
  await page.goto(id ? `./?piece=${id}` : './');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
}

export async function waitForSound(page: Page): Promise<void> {
  await expect(page.locator('#app')).toHaveAttribute('data-sound', 'ready', { timeout: 30_000 });
}

export async function setTempo(page: Page, bpm: number): Promise<void> {
  await page.locator('#tempo').fill(String(bpm));
  await expect(page.locator('#tempo-readout')).toHaveText(String(bpm));
}

/** Left edge of every notation note, in page pixels, in score order. */
export async function noteXs(page: Page): Promise<number[]> {
  return page
    .locator('.malco-note')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x * 100) / 100));
}

/**
 * Start recording which note is highlighted, as "bar:note" strings in the order
 * they light up, into window.__highlights. Call before pressing Play.
 */
export async function recordHighlights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = [];
    Object.assign(window, { __highlights: log });
    const seen = () => {
      const el = document.querySelector<SVGGElement>('.malco-note.is-current');
      const key = el ? `${el.dataset.bar}:${el.dataset.note}` : null;
      if (key && log[log.length - 1] !== key) log.push(key);
    };
    new MutationObserver(seen).observe(document.querySelector('#score')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
}

export async function highlights(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __highlights: string[] }).__highlights);
}

/** Every note of the piece as "bar:note", in score order. */
export async function allNoteKeys(page: Page): Promise<string[]> {
  return page
    .locator('.malco-note')
    .evaluateAll((els) =>
      els.map((el) => `${(el as SVGGElement).dataset.bar}:${(el as SVGGElement).dataset.note}`),
    );
}
