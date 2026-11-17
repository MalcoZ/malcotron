import { expect, test, type Page } from '@playwright/test';
import { openRoute, setTempo, trackErrors, waitForSound } from './helpers';

test.use({ viewport: { width: 1280, height: 720 } });

/** Swap the mic for a simulated learner who plays each Your turn pass, with these mistakes. */
async function simulateLearner(page: Page, mistakes: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate((m) => void (window as any).malcotron.simulateLearner(m), mistakes);
  await expect(page.locator('#mic-link')).toHaveText('Mic: on');
}

const statuses = (page: Page) =>
  page.locator('.mark').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.status));

test('a clean take is graded green, note by note, and the result is saved with the lesson', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openRoute(page, '/lesson/p1-string-1/5');
  await waitForSound(page);
  await simulateLearner(page);
  await setTempo(page, 160);

  // Notes turn green while the take is still running (live colouring).
  await page.evaluate(() => {
    Object.assign(window, { __live: 0 });
    const watch = () => {
      const { clock } = (window as any).malcotron;
      if (clock.state === 'running') {
        const n = document.querySelectorAll('.malco-note.grade-green').length;
        (window as any).__live = Math.max((window as any).__live, n);
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.locator('#turn').click();
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as any).__live)).toBeGreaterThan(5);

  await expect(page.locator('#take-score')).toHaveText('12 of 12 notes right, 12 on time');
  await expect(page.locator('#take-feedback')).toHaveText('Every note right and on time.');
  expect(await statuses(page)).toEqual(Array(12).fill('green'));
  await expect(page.locator('.malco-note.grade-green')).toHaveCount(12);
  await expect(page.locator('.mark').first()).toHaveText('✓');
  // With the mic grading, the self-check question is not asked.
  await expect(page.locator('#self-check')).toHaveCount(0);

  await page.locator('#next').click();
  await page.locator('#done-home').click();
  await expect(page.locator('.lesson-list li.is-done .lesson-state')).toHaveText('✓ Done · 100%');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('malcotron.progress')!));
  expect(saved.completed['p1-string-1'].accuracy).toBe(1);
  expect(errors).toEqual([]);
});

test('a wrong note and a missed note are marked, named and explained; a mark can be flipped', async ({
  page,
}) => {
  await openRoute(page, '/lesson/p1-string-1/5');
  await waitForSound(page);
  // Bar 1 is E F G F: play the second note (F) two frets sharp, as G, and leave out note 6.
  await simulateLearner(page, { wrong: [1], missed: [5] });
  await setTempo(page, 160);
  await page.locator('body').press('r');
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });

  await expect(page.locator('#take-score')).toHaveText('10 of 12 notes right, 10 on time');
  await expect(page.locator('#take-feedback')).toHaveText(
    'Bar 1: the F was played as G. It is the 1st fret on the 1st string, not the 3rd fret. 1 more to fix after that.',
  );
  const marks = await statuses(page);
  expect(marks[1]).toBe('red');
  expect(marks[5]).toBe('red');
  expect(marks.filter((s) => s === 'green')).toHaveLength(10);
  // The wrong note's mark names what was played; grades are shown by mark as well as colour.
  await expect(page.locator('.mark').nth(1)).toHaveText('✕ G');
  await expect(page.locator('.mark').nth(5)).toHaveText('✕');
  await expect(page.locator('.malco-note.grade-red')).toHaveCount(2);
  // Marks sit under their notes.
  const aligned = await page.evaluate(() => {
    const mark = document.querySelectorAll('.mark')[3]!.getBoundingClientRect();
    const head = document.querySelectorAll('.malco-note .vf-notehead')[3]!.getBoundingClientRect();
    return Math.abs(mark.x + mark.width / 2 - (head.x + head.width / 2));
  });
  expect(aligned).toBeLessThan(12);

  // "I played this right": flip the missed note.
  await page.locator('.mark').nth(5).click();
  await expect(page.locator('#take-score')).toHaveText('11 of 12 notes right, 11 on time');
  await expect(page.locator('.mark').nth(5)).toHaveText('✓');
  await expect(page.locator('.mark').nth(5)).toHaveClass(/is-flipped/);
  // And back again.
  await page.locator('.mark').nth(5).click();
  await expect(page.locator('#take-score')).toHaveText('10 of 12 notes right, 10 on time');

  // Grades survive a redraw (theme change).
  await page.locator('#theme-toggle').click();
  await expect(page.locator('.malco-note.grade-red')).toHaveCount(2);
  await expect(page.locator('.mark')).toHaveCount(12);
});

test('a take that is evenly late is the audio path, not the player: it is graded on time', async ({
  page,
}) => {
  await openRoute(page, '/lesson/r1-the-beat/4');
  await waitForSound(page);
  await simulateLearner(page, { lateMs: 180 });
  await setTempo(page, 120);
  await page.locator('#turn').click();
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#take-score')).toHaveText('8 of 8 notes right, 8 on time');
  expect(await statuses(page)).toEqual(Array(8).fill('green'));
});

test('a note that is late against the rest gets a clock mark, and the feedback says late', async ({
  page,
}) => {
  await openRoute(page, '/lesson/r1-the-beat/4');
  await waitForSound(page);
  await simulateLearner(page, { skip: true });
  await setTempo(page, 120);
  // Play the take by hand: every note on the beat except the fifth, half a beat (250 ms) late.
  await page.evaluate(() => {
    const m = (window as any).malcotron;
    m.player.onStateChange((playing: boolean) => {
      if (!playing || m.player.currentMode !== 'turn') return;
      const notes = [...Array(8).keys()].map((beat) => ({
        beat: beat + (beat === 4 ? 0.5 : 0),
        midi: 59,
        durationBeats: beat === 3 ? 1.2 : 0.8,
      }));
      m.simulateNotes(notes);
    });
  });
  await page.locator('#turn').click();
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#take-score')).toHaveText('8 of 8 notes right, 7 on time');
  const marks = await statuses(page);
  expect(marks[4]).toBe('amber');
  await expect(page.locator('.mark').nth(4)).toHaveText('◷');
  await expect(page.locator('#take-feedback')).toContainText('One note was a little late');
});

test('a measured timing correction and the automatic one do not add up to an error', async ({
  page,
}) => {
  await openRoute(page, '/lesson/r1-the-beat/4');
  await waitForSound(page);
  await simulateLearner(page, { lateMs: 180 });
  await page.evaluate(() => (window as any).malcotron.calibration.update({ latencyMs: 180 }));
  await setTempo(page, 120);
  await page.locator('#turn').click();
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#take-score')).toHaveText('8 of 8 notes right, 8 on time');
});

test('Hear what I played plays back the notes the mic heard, and Again starts a new take', async ({
  page,
}) => {
  await openRoute(page, '/lesson/p1-string-1/5');
  await waitForSound(page);
  await simulateLearner(page, { wrong: [1] });
  await setTempo(page, 200);
  await page.locator('#turn').click();
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => {
    const heard: number[] = [];
    Object.assign(window, { __heard: heard });
    (window as any).malcotron.player.onHeardNote((n: any) => heard.push(Math.round(n.midi)));
  });
  await page.locator('#hear-me').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await expect(page.locator('#play')).toHaveText('Listen', { timeout: 20_000 });
  const heard = await page.evaluate(() => (window as any).__heard as number[]);
  // E F G F ... with the second note heard as G (67) instead of F (65).
  expect(heard.slice(0, 4)).toEqual([64, 67, 67, 65]);
  expect(heard).toHaveLength(12);
  // The grades are still showing after the playback.
  await expect(page.locator('.mark')).toHaveCount(12);

  await page.locator('#again').click();
  await expect(page.locator('#turn')).toHaveText('Stop');
  await expect(page.locator('.mark')).toHaveCount(0);
  await expect(page.locator('#take-result')).toBeVisible({ timeout: 20_000 });
});

test('without a mic the learner checks themselves and is pointed at mic setup', async ({
  page,
}) => {
  await openRoute(page, '/lesson/r1-the-beat/4');
  await waitForSound(page);
  await expect(page.locator('#mic-link')).toHaveText('Mic: off');
  await setTempo(page, 200);
  await page.locator('#turn').click();
  await expect(page.locator('#self-check')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.mark')).toHaveCount(0);
  await page.locator('#self-check .mic-hint').click();
  await expect(page).toHaveURL(/#\/mic$/);
  await expect(page.locator('#mic-view')).toBeVisible();
});

test('mic setup: room noise, six open strings with tuning, tuner and timing', async ({ page }) => {
  const errors = trackErrors(page);
  await openRoute(page);
  await simulateLearner(page);
  await page.locator('#mic-link').click();
  await expect(page.locator('#mic-status')).toContainText('The mic is on');
  await expect(page.locator('#mic-status')).toContainText('never stored or sent');
  // The whole setup screen fits without scrolling.
  expect(
    await page.evaluate(() => {
      const area = document.querySelector('#score-area')!;
      return area.scrollHeight - area.clientHeight;
    }),
  ).toBeLessThanOrEqual(0);

  // Room noise: two seconds of quiet hiss sets the gate above it.
  await page.locator('#measure-noise').click();
  await expect(page.locator('#noise-result')).toHaveText('Listening… stay quiet.');
  await page.evaluate(() => (window as any).malcotron.feedInstant([], 2.2, { noise: 0.004 }));
  await expect(page.locator('#noise-result')).toContainText('Measured.');
  const gate = await page.evaluate(() => (window as any).malcotron.calibration.value.noiseGate);
  expect(gate).toBeGreaterThan(0.003);
  expect(gate).toBeLessThan(0.05);

  // Open strings, all 20 cents flat.
  await page.evaluate(() => {
    const notes = [40, 45, 50, 55, 59, 64].map((midi, i) => ({
      time: 0.3 + i * 1.0,
      midi: midi - 0.2,
      duration: 0.8,
    }));
    (window as any).malcotron.feedInstant(notes, 6.6, { noise: 0.002 });
  });
  await expect(page.locator('#string-chips .chip.is-heard')).toHaveCount(6);
  await expect(page.locator('#tuning-result')).toContainText('about 20 cents flat');
  const cents = await page.evaluate(() => (window as any).malcotron.calibration.value.tuningCents);
  expect(cents).toBeGreaterThan(-26);
  expect(cents).toBeLessThan(-14);
  // The tuner shows the last string heard.
  await expect(page.locator('#tuner-note')).toHaveText('E');
  await expect(page.locator('#tuner-cents')).toContainText('flat');

  // Timing: play on each click, 60 ms late.
  await page.locator('#calibrate').click();
  await expect(page.locator('#calibrate')).toHaveText('Stop');
  await page.evaluate(() => {
    const notes = [...Array(8).keys()].map((beat) => ({ beat, midi: 57, durationBeats: 0.6 }));
    (window as any).malcotron.simulateNotes(notes, 60);
  });
  await expect(page.locator('#latency-result')).toContainText('Measured:', { timeout: 20_000 });
  const latency = await page.evaluate(() => (window as any).malcotron.calibration.value.latencyMs);
  expect(latency).toBeGreaterThan(40);
  expect(latency).toBeLessThan(85);

  // The settings are kept for next time.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('malcotron.calibration')!),
  );
  expect(stored.measured).toEqual({ noise: true, tuning: true, latency: true });
  expect(errors).toEqual([]);
});

test('timing calibration with nothing played says so and changes nothing', async ({ page }) => {
  await openRoute(page);
  await simulateLearner(page);
  await page.locator('#mic-link').click();
  await page.locator('#calibrate').click();
  await expect(page.locator('#latency-result')).toContainText('Not enough notes', {
    timeout: 20_000,
  });
  expect(await page.evaluate(() => (window as any).malcotron.calibration.value.latencyMs)).toBe(0);
});

test('four tones: choosing one loads it, plays with it and is remembered', async ({ page }) => {
  const errors = trackErrors(page);
  const requested: string[] = [];
  page.on('request', (r) => {
    const m = /samples\/(\w+)\/\d+\.mp3/.exec(r.url());
    if (m && !requested.includes(m[1]!)) requested.push(m[1]!);
  });
  await openRoute(page, '/piece/p1-first-steps');
  await waitForSound(page);
  await expect(page.locator('#tone-select option')).toHaveText([
    'Nylon classical',
    'Steel acoustic',
    'Clean electric',
    'Jazz electric',
  ]);
  expect(requested).toEqual(['nylon']); // the others are not fetched until chosen

  await page.locator('#tone-select').selectOption('jazz');
  await waitForSound(page);
  expect(requested).toEqual(['nylon', 'jazz']);
  expect(await page.evaluate(() => (window as any).malcotron.player.currentTone.id)).toBe('jazz');
  await setTempo(page, 220);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await expect(page.locator('#play')).toHaveText('Listen', { timeout: 15_000 });

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#tone-select')).toHaveValue('jazz');
  expect(errors).toEqual([]);
});

test('click a bar to start there; loop repeats the selected bars with no gap', async ({ page }) => {
  await openRoute(page, '/piece/ode-to-joy');
  await waitForSound(page);
  await setTempo(page, 220);
  await page.evaluate(() => {
    const log: { beat: number; time: number }[] = [];
    Object.assign(window, { __notes: log });
    (window as any).malcotron.player.onNote((e: any, time: number) =>
      log.push({ beat: e.startBeat.n / e.startBeat.d, time }),
    );
  });
  const clickBar = async (bar: number) => {
    const box = await page.evaluate((b) => {
      const { system, x, width } = (window as any).malcotron.renderer.barBox(b);
      const r = system.el.getBoundingClientRect();
      return { x: r.left + x + width / 2, y: r.top + r.height / 2 };
    }, bar);
    await page.mouse.click(box.x, box.y);
  };

  // Play from here: select bar 3 and listen. It starts at beat 8 and runs to the end of the bar.
  await clickBar(2);
  await expect(page.locator('.bar-selected')).toHaveCount(1);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await expect(page.locator('#play')).toHaveText('Listen', { timeout: 15_000 });
  let notes = await page.evaluate(
    () => (window as any).__notes as { beat: number; time: number }[],
  );
  expect(notes.map((n) => n.beat)).toEqual([8, 9, 10, 11]);

  // Drag across bars 3 and 4, switch the loop on, and let it go round.
  await page.evaluate(() => ((window as any).__notes.length = 0));
  const from = await page.evaluate(() => {
    const { system, x } = (window as any).malcotron.renderer.barBox(2);
    const r = system.el.getBoundingClientRect();
    return { x: r.left + x + 20, y: r.top + r.height / 2 };
  });
  const to = await page.evaluate(() => {
    const { system, x } = (window as any).malcotron.renderer.barBox(3);
    const r = system.el.getBoundingClientRect();
    return { x: r.left + x + 20, y: r.top + r.height / 2 };
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  await expect(page.locator('.bar-selected')).toHaveCount(2);
  await page.locator('body').press('l');
  await expect(page.locator('#loop')).toHaveText('Loop: on');
  await page.locator('#play').click();
  await expect
    .poll(async () => (await page.evaluate(() => (window as any).__notes.length)) as number, {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(16);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Listen');
  notes = await page.evaluate(() => (window as any).__notes as { beat: number; time: number }[]);
  // Bars 3 and 4 are seven notes at beats 8..14; they repeat in the same order.
  const pattern = [8, 9, 10, 11, 12, 13, 14];
  notes.slice(0, 14).forEach((n, i) => expect(n.beat).toBe(pattern[i % 7]));
  // No gap at the join: the first note of pass 2 is exactly 8 beats after the first of pass 1.
  expect(notes[7]!.time - notes[0]!.time).toBeCloseTo((8 * 60) / 220, 2);
  expect(notes[14]!.time - notes[7]!.time).toBeCloseTo((8 * 60) / 220, 2);

  // Escape clears the selection and the loop.
  await page.locator('body').press('Escape');
  await expect(page.locator('.bar-selected')).toHaveCount(0);
  await expect(page.locator('#loop')).toHaveText('Loop: off');
});

test('the bar band and the visual metronome follow the clock; subdivisions add clicks', async ({
  page,
}) => {
  await openRoute(page, '/piece/p1-first-steps');
  await waitForSound(page);
  await setTempo(page, 120);
  await page.locator('#metronome').click();
  await page.locator('#subdivision').selectOption('2');
  await page.evaluate(() => {
    const seen = {
      bars: [] as number[],
      bandOff: 0,
      pulseMax: 0,
      pulseMin: 1,
      clicks: [] as number[],
    };
    Object.assign(window, { __seen: seen });
    const { player, clock, renderer } = (window as any).malcotron;
    player.onClick((c: any) => seen.clicks.push(c.beat));
    const watch = () => {
      if (clock.state === 'running' && clock.beat >= 0) {
        const band = document.querySelector<HTMLElement>('.bar-band');
        const bar = Math.floor(clock.beat / 4);
        if (band && seen.bars.at(-1) !== bar) seen.bars.push(bar);
        const box = renderer.barBox(bar);
        // The band is drawn over the bar the clock says is playing (allowing one frame of lag).
        if (
          band &&
          box &&
          Math.abs(parseFloat(band.style.left) - box.x) > 1 &&
          clock.beat % 4 > 0.2
        ) {
          seen.bandOff++;
        }
        const opacity = Number(document.querySelector<HTMLElement>('#pulse')!.style.opacity);
        seen.pulseMax = Math.max(seen.pulseMax, opacity);
        seen.pulseMin = Math.min(seen.pulseMin, opacity);
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await expect(page.locator('#play')).toHaveText('Listen', { timeout: 20_000 });
  const seen = await page.evaluate(() => (window as any).__seen);
  expect(seen.bars).toEqual([0, 1, 2, 3]);
  expect(seen.bandOff).toBe(0);
  expect(seen.pulseMax).toBeGreaterThan(0.8);
  expect(seen.pulseMin).toBeLessThan(0.4);
  // Eighth-note clicks: 32 in four bars of 4/4.
  expect(seen.clicks).toHaveLength(32);
  expect(seen.clicks.slice(0, 4)).toEqual([0, 0.5, 1, 1.5]);
  await expect(page.locator('.bar-band')).toHaveCount(0);
});

test('Home fits one screen, with the current chapter open', async ({ page }) => {
  await openRoute(page);
  expect(
    await page.evaluate(() => {
      const area = document.querySelector('#score-area')!;
      return area.scrollHeight - area.clientHeight;
    }),
  ).toBeLessThanOrEqual(0);
  await expect(page.locator('details[data-chapter="chapter-1"]')).toHaveAttribute('open', '');
  await expect(page.locator('.lesson-list li')).toHaveCount(10);
  await expect(page.locator('.lesson-list li').last()).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#continue')).toBeInViewport({ ratio: 1 });
});

test('mic setup shows the level in numbers and can save a test recording', async ({ page }) => {
  await openRoute(page);
  await simulateLearner(page);
  await page.locator('#mic-link').click();
  await page.locator('#record').click();
  await expect(page.locator('#record')).toHaveText('Stop and save');
  // A very quiet note: the numbers appear, with advice about the level.
  await page.evaluate(() =>
    (window as any).malcotron.feedInstant([{ time: 0.2, midi: 57, duration: 1.5 }], 2, {
      gain: 0.004,
      noise: 0.00005,
    }),
  );
  await expect(page.locator('#mic-numbers')).toContainText('Loudest lately');
  await expect(page.locator('#mic-numbers')).toContainText('very quiet');
  await expect(page.locator('#tuner-note')).toHaveText('A'); // still heard, quiet as it is
  const download = page.waitForEvent('download');
  await page.locator('#record').click();
  expect((await download).suggestedFilename()).toBe('malcotron-take.wav');
  await expect(page.locator('#record-result')).toContainText('Saved 2.0 s');
});
