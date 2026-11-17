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

test('the header button turns the mic on and off, and the mic is only open during a take', async ({
  page,
}) => {
  const micState = () => page.evaluate(() => (window as any).malcotron.mic.state as string);
  await openRoute(page, '/lesson/r1-the-beat/4');
  await waitForSound(page);
  const button = page.locator('#mic-link');
  await expect(button).toHaveText('Mic: off');

  // On: permission is asked for, then the device is let go until it is needed.
  await button.click();
  await expect(button).toHaveText('Mic: on');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(micState).toBe('off');
  await expect(button).not.toHaveClass(/is-live/);

  // During a take the mic is open (and the button shows it); afterwards it is released.
  await setTempo(page, 200);
  await page.locator('#turn').click();
  await expect(button).toHaveClass(/is-live/);
  expect(await micState()).toBe('on');
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#take-score')).toBeVisible();
  await expect.poll(micState).toBe('off');
  await expect(button).not.toHaveClass(/is-live/);

  // Stopping a take early releases it too.
  await page.locator('#turn').click();
  await expect(button).toHaveClass(/is-live/);
  await page.locator('#turn').click();
  await expect.poll(micState).toBe('off');

  // Off: the next take is self-checked, and the mic is never opened.
  await button.click();
  await expect(button).toHaveText('Mic: off');
  await page.locator('#turn').click();
  await expect(page.locator('#self-check')).toBeVisible({ timeout: 15_000 });
  expect(await micState()).toBe('off');

  // The choice is remembered.
  await button.click();
  await expect(button).toHaveText('Mic: on');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#mic-link')).toHaveText('Mic: on');
});

test('leaving the mic setup screen releases the mic', async ({ page }) => {
  await openRoute(page, '/mic');
  await page.locator('#mic-toggle').click();
  await expect(page.locator('#mic-status')).toContainText('The mic is on');
  await page.locator('#home-link').click();
  await expect(page.locator('#home')).toBeVisible();
  expect(await page.evaluate(() => (window as any).malcotron.mic.state)).toBe('off');
  await expect(page.locator('#mic-link')).toHaveText('Mic: on');
  // Coming back opens it again without another click.
  await page.locator('#mic-setup').click();
  await expect(page.locator('#mic-status')).toContainText('The mic is on');
});
