import { expect, test } from '@playwright/test';
import {
  allNoteKeys,
  highlights,
  openPiece,
  recordHighlights,
  setTempo,
  trackErrors,
  waitForSound,
} from './helpers';

/**
 * The four M0 content files have no ties, rests, accidentals or sixteenths.
 * This piece has all of them, so those drawing and playback paths are covered
 * before real content needs them.
 */
/** Every music-font glyph drawn as part of a note: noteheads, rests, dots, accidentals. */
const GLYPHS = '.malco-note .vf-notehead text[font-size="30pt"]';

const FEATURES = {
  id: 'feature-check',
  title: 'Feature check',
  composer: 'Test',
  source: 'Test piece for the renderer',
  key: 'C',
  time: '4/4',
  position: 0,
  suggestedTempo: 100,
  requires: { pitchStage: 'P5', rhythmStage: 'R5' },
  bars: [
    'C5/q r/q F#4/8 G4/8 F#4/q',
    'Bb4/q. A4/8 G4/h_',
    'G4/q r/8 E4/8 C5/16 D5/16 E5/16 F5/16 G5/q_',
    'G5/h r/h',
    'F4/q F#4/q F4/q E4/q_',
    'E4/w',
  ],
};

test('ties, rests, accidentals, dots and sixteenths draw and play', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1024, height: 800 }); // forces a tie across a system break
  await openPiece(page);
  await waitForSound(page);
  await page.evaluate((raw) => (window as any).malcotron.show(raw), FEATURES);
  await expect(page.locator('.piece-title')).toHaveText('Feature check');

  const total = 23;
  await expect(page.locator('.malco-note')).toHaveCount(total);
  const report = await page.evaluate(() => {
    const { renderer, player } = (window as any).malcotron;
    const handles = [...renderer.handles.values()];
    return {
      handles: handles.length,
      rests: handles.filter((h: any) => h.isRest).length,
      restsWithTab: handles.filter((h: any) => h.isRest && h.tabEl).length,
      notesWithoutTab: handles.filter((h: any) => !h.isRest && !h.tabEl?.isConnected).length,
      systems: renderer.systems.length,
      struck: player.currentTimeline.events.filter((e: any) => !e.isRest && !e.tiedFromPrevious)
        .length,
    };
  });
  expect(report).toMatchObject({ handles: total, rests: 3, restsWithTab: 0, notesWithoutTab: 0 });
  expect(report.systems).toBeGreaterThanOrEqual(2);
  expect(report.struck).toBe(total - 3 - 3); // 3 rests, 3 tied continuations

  // Accidentals: F#4 once in bar 1 (not repeated), Bb4 in bar 2, then F# and F natural in bar 5.
  // Music glyphs inside the notes: 23 noteheads and rests, 1 dot, 4 accidentals.
  await page.locator('#fingering-level').selectOption('none');
  await expect(page.locator(GLYPHS)).toHaveCount(23 + 1 + 4);
  await page.locator('#fingering-level').selectOption('all');
  // Tied notes show their fret in brackets in the tab.
  const tiedFret = await page.evaluate(
    () => (window as any).malcotron.renderer.getHandle(2, 0).tabEl.textContent,
  );
  expect(tiedFret.trim()).toBe('(0)');
  // Three ties; the one over the system break is drawn as two halves.
  expect(await page.locator('#score svg .vf-stavetie').count()).toBeGreaterThanOrEqual(3);

  // It plays through: the highlight visits every written note and rest in order.
  await setTempo(page, 220);
  await recordHighlights(page);
  const expected = await allNoteKeys(page);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await expect(page.locator('#play')).toHaveText('Play', { timeout: 20_000 });
  expect(await highlights(page)).toEqual(expected);
  expect(errors).toEqual([]);
});

test('an invalid piece is refused with the validator message', async ({ page }) => {
  await openPiece(page);
  const message = await page.evaluate((raw) => {
    try {
      (window as any).malcotron.show({ ...raw, bars: ['C5/q D5/q'] });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, FEATURES);
  expect(message).toContain('feature-check.json, bar 1: bar adds up to 1/2 of a whole note');
});
