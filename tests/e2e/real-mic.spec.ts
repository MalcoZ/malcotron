import { expect, test } from '@playwright/test';
import { openRoute, setTempo, trackErrors, waitForSound } from './helpers';

// Chromium's built-in fake microphone: exercises getUserMedia and the AudioWorklet for real.
test.use({
  launchOptions: {
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});

test.describe('with a (fake) mic device', () => {
  test('the mic turns on, shows a level, and can be turned off', async ({ page }) => {
    const errors = trackErrors(page);
    await openRoute(page, '/mic');
    await expect(page.locator('#mic-status')).toHaveText('The mic is off.');
    await expect(page.locator('#measure-noise')).toBeDisabled();
    await page.locator('#mic-toggle').click();
    await expect(page.locator('#mic-status')).toContainText('The mic is on');
    await expect(page.locator('#mic-link')).toHaveText('Mic: on');
    await expect(page.locator('#measure-noise')).toBeEnabled();
    // Samples are arriving from the worklet: the level meter moves (the fake mic beeps).
    await expect
      .poll(
        () =>
          page.evaluate(
            () => parseFloat(document.querySelector<HTMLElement>('#mic-level')!.style.width) || 0,
          ),
        { timeout: 10_000, intervals: [50] },
      )
      .toBeGreaterThan(20);
    await page.locator('#mic-toggle').click();
    await expect(page.locator('#mic-status')).toHaveText('The mic is off.');
    await expect(page.locator('#mic-link')).toHaveText('Mic: off');
    expect(errors).toEqual([]);
  });

  test('a Your turn pass listens through the real mic path and ends with a grade', async ({
    page,
  }) => {
    await openRoute(page, '/mic');
    await page.locator('#mic-toggle').click();
    await expect(page.locator('#mic-status')).toContainText('The mic is on');
    await page.evaluate(() => (location.hash = '#/lesson/r1-the-beat/4'));
    await waitForSound(page);
    await setTempo(page, 200);
    await page.locator('#turn').click();
    // The fake device only beeps, so the grade will be poor; what matters is that one is produced.
    await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#take-score')).toContainText('of 8 notes right');
    await expect(page.locator('.mark')).toHaveCount(8);
  });
});

test('if the mic cannot be opened, the app says so and Your turn falls back to the self-check', async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  const errors = trackErrors(page);
  await openRoute(page, '/mic');
  await page.locator('#mic-toggle').click();
  await expect(page.locator('#mic-status')).toContainText('Mic access was refused');
  await expect(page.locator('#mic-link')).toHaveText('Mic: off');

  await page.evaluate(() => (location.hash = '#/lesson/r1-the-beat/4'));
  await waitForSound(page);
  await setTempo(page, 200);
  await page.locator('#turn').click();
  await expect(page.locator('#self-check')).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
