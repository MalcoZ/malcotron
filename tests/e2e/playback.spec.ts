import { expect, test } from '@playwright/test';
import {
  allNoteKeys,
  highlights,
  openPiece,
  PIECES,
  recordHighlights,
  setTempo,
  trackErrors,
  waitForSound,
} from './helpers';

/** Record each note's exact audio time as it is handed to the audio engine. */
async function recordNoteTimes(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const log: { beat: number; midi: number; seconds: number; time: number }[] = [];
    Object.assign(window, { __notes: log });
    const { player, clock } = (window as any).malcotron;
    player.onNote((event: any, audioTime: number) => {
      log.push({
        beat: event.startBeat.n / event.startBeat.d,
        midi: event.soundingMidi,
        seconds: clock.beatsToSeconds(event.soundingBeats),
        time: audioTime,
      });
    });
  });
}

const noteTimes = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () =>
      (window as any).__notes as { beat: number; midi: number; seconds: number; time: number }[],
  );

test('Play shows a loading state, then plays Ode to Joy to the end', async ({ page }) => {
  const errors = trackErrors(page);
  await openPiece(page);
  const play = page.locator('#play');
  await waitForSound(page);
  await expect(play).toBeEnabled();
  await expect(play).toHaveText('Play');
  await expect(page.locator('#tempo-readout')).toHaveText('80'); // the piece's suggested tempo

  await setTempo(page, 220);
  await recordHighlights(page);
  await recordNoteTimes(page);
  const expected = await allNoteKeys(page);

  await play.click();
  await expect(play).toHaveText('Stop');
  await expect(page.locator('.playhead')).toBeVisible();

  // 32 beats at 220 BPM is under 9 seconds.
  await expect(play).toHaveText('Play', { timeout: 20_000 });

  // The highlight visited every note, in order, and finished on the last one.
  const seen = await highlights(page);
  expect(seen).toEqual(expected);
  expect(seen.at(-1)).toBe('7:2');

  // Afterwards the playhead and highlight are gone and the clock is back at the start.
  await expect(page.locator('.playhead')).toHaveCount(0);
  await expect(page.locator('.is-current')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).malcotron.clock.beat)).toBe(0);

  // Notes were scheduled on an exact grid: beat * 60 / 220 seconds after the first.
  const notes = await noteTimes(page);
  expect(notes).toHaveLength(30);
  for (const note of notes) {
    expect(note.time - notes[0]!.time).toBeCloseTo((note.beat * 60) / 220, 3);
  }
  // Sounding pitch is an octave below written: E5 E5 F5 G5 sounds E4 E4 F4 G4.
  expect(notes.slice(0, 4).map((n) => n.midi)).toEqual([64, 64, 65, 67]);
  expect(errors).toEqual([]);
});

for (const piece of PIECES.slice(1)) {
  test(`${piece.title} plays through with every note highlighted in order`, async ({ page }) => {
    const errors = trackErrors(page);
    await openPiece(page, piece.id);
    await waitForSound(page);
    await setTempo(page, 220);
    await recordHighlights(page);
    await recordNoteTimes(page);
    const expected = await allNoteKeys(page);

    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveText('Stop');
    await expect(page.locator('#play')).toHaveText('Play', { timeout: 20_000 });

    expect(await highlights(page)).toEqual(expected);
    const notes = await noteTimes(page);
    expect(notes).toHaveLength(piece.notes);
    for (const note of notes) {
      expect(note.time - notes[0]!.time).toBeCloseTo((note.beat * 60) / 220, 3);
    }
    expect(errors).toEqual([]);
  });
}

for (const bpm of [30, 80]) {
  test(`note timing and length are right at ${bpm} BPM`, async ({ page }) => {
    await openPiece(page, 'p1-first-steps');
    await waitForSound(page);
    await setTempo(page, bpm);
    await recordNoteTimes(page);
    await page.locator('#play').click();
    // C5/q D5/q E5/h: wait for the third note, then stop.
    await expect.poll(async () => (await noteTimes(page)).length, { timeout: 15_000 }).toBe(3);
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveText('Play');

    const notes = await noteTimes(page);
    const beat = 60 / bpm;
    expect(notes[1]!.time - notes[0]!.time).toBeCloseTo(beat, 3);
    expect(notes[2]!.time - notes[0]!.time).toBeCloseTo(2 * beat, 3);
    expect(notes.map((n) => n.seconds)).toEqual([beat, beat, 2 * beat]);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64]);
  });
}

test('the highlight is on the note that is sounding', async ({ page }) => {
  await openPiece(page, 'p1-first-steps');
  await waitForSound(page);
  await setTempo(page, 120);
  // Sample the clock and the highlighted note together on every animation frame.
  await page.evaluate(() => {
    const samples: { beat: number; key: string | null; x: number | null }[] = [];
    Object.assign(window, { __samples: samples });
    const { clock } = (window as any).malcotron;
    const sample = () => {
      if (clock.state === 'running') {
        const el = document.querySelector<SVGGElement>('.malco-note.is-current');
        const line = document.querySelector<HTMLElement>('.playhead');
        samples.push({
          beat: clock.beat,
          key: el ? `${el.dataset.bar}:${el.dataset.note}` : null,
          x: line ? line.getBoundingClientRect().x : null,
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Stop');
  await expect(page.locator('#play')).toHaveText('Play', { timeout: 20_000 });

  const { samples, starts } = await page.evaluate(() => {
    const events = (window as any).malcotron.player.currentTimeline.events;
    return {
      samples: (window as any).__samples as { beat: number; key: string | null; x: number }[],
      starts: events.map((e: any) => ({
        key: `${e.barIndex}:${e.noteIndex}`,
        beat: e.startBeat.n / e.startBeat.d,
      })) as { key: string; beat: number }[],
    };
  });
  expect(samples.length).toBeGreaterThan(50);
  // The sample is taken just after the frame that drew the highlight, so allow
  // the highlight to trail the clock by a small part of a beat, never to lead it.
  const tolerance = 0.2;
  let checked = 0;
  for (const s of samples) {
    if (s.beat < 0 || s.key === null) continue;
    const index = starts.findIndex((e) => e.key === s.key);
    const start = starts[index]!.beat;
    const end = starts[index + 1]?.beat ?? 16;
    expect(s.beat).toBeGreaterThanOrEqual(start);
    expect(s.beat).toBeLessThan(end + tolerance);
    checked++;
  }
  expect(checked).toBeGreaterThan(50);
  // The playhead only ever moves forwards (this piece fits on one system).
  const xs = samples.filter((s) => s.x !== null && s.beat >= 0).map((s) => s.x);
  for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 0.01);
});

test('a tempo change during playback takes effect without a restart', async ({ page }) => {
  await openPiece(page, 'ode-to-joy');
  await waitForSound(page);
  await setTempo(page, 60);
  await recordHighlights(page);
  await recordNoteTimes(page);
  const expected = await allNoteKeys(page);

  await page.locator('#play').click();
  await expect.poll(async () => (await noteTimes(page)).length, { timeout: 15_000 }).toBe(3);
  await setTempo(page, 220);
  await expect(page.locator('#play')).toHaveText('Stop'); // still playing
  await expect(page.locator('#play')).toHaveText('Play', { timeout: 20_000 });

  // No restart: every note was struck exactly once, in order.
  expect(await highlights(page)).toEqual(expected);
  const notes = await noteTimes(page);
  expect(notes.map((n) => n.beat)).toEqual(
    await page.evaluate(() =>
      (window as any).malcotron.player.currentTimeline.events.map(
        (e: any) => e.startBeat.n / e.startBeat.d,
      ),
    ),
  );
  // One second apart at 60 BPM, then 60/220 s apart once the new tempo is in force.
  expect(notes[1]!.time - notes[0]!.time).toBeCloseTo(1, 3);
  expect(notes[20]!.time - notes[19]!.time).toBeCloseTo(60 / 220, 3);
});

test('the playhead follows onto the next system and scrolls it into view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await openPiece(page, 'ode-to-joy');
  await waitForSound(page);
  await page.locator('#peek-tab').click(); // taller systems: the second one starts off screen
  await setTempo(page, 220);

  const systemOfPlayhead = () =>
    page.evaluate(
      () => document.querySelector<HTMLElement>('.playhead')?.parentElement?.dataset.system ?? null,
    );
  await page.locator('#play').click();
  await expect.poll(systemOfPlayhead).toBe('0');
  // Tab notes are highlighted along with the notation.
  await expect(page.locator('.malco-tabnote.is-current')).toHaveCount(1);
  await expect.poll(systemOfPlayhead, { timeout: 15_000 }).toBe('1');
  await expect(page.locator('.system[data-system="1"]')).toBeInViewport({ ratio: 0.95 });
  await expect(page.locator('#play')).toHaveText('Play', { timeout: 20_000 });
});

test('Space starts and stops playback; Stop returns to the start', async ({ page }) => {
  await openPiece(page, 'ode-to-joy');
  await waitForSound(page);
  const play = page.locator('#play');
  await page.locator('body').press('Space');
  await expect(play).toHaveText('Stop');
  await expect(page.locator('.malco-note.is-current')).toHaveCount(1);
  await page.locator('body').press('Space');
  await expect(play).toHaveText('Play');
  await expect(page.locator('.is-current')).toHaveCount(0);
  await expect(page.locator('.playhead')).toHaveCount(0);

  // With the Play button focused, Space still toggles exactly once.
  await play.focus();
  await page.keyboard.press('Space');
  await expect(play).toHaveText('Stop');
  await page.keyboard.press('Space');
  await expect(play).toHaveText('Play');
});

test('tempo slider covers 30 to 220 BPM', async ({ page }) => {
  await openPiece(page);
  const slider = page.locator('#tempo');
  await expect(slider).toHaveAttribute('min', '30');
  await expect(slider).toHaveAttribute('max', '220');
  await setTempo(page, 30);
  await setTempo(page, 220);
  expect(await page.evaluate(() => (window as any).malcotron.clock.tempo)).toBeCloseTo(220);
});

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the playhead jumps from note to note instead of gliding', async ({ page }) => {
    await openPiece(page, 'p1-first-steps');
    await waitForSound(page);
    await setTempo(page, 120);
    await page.evaluate(() => {
      const xs = new Set<number>();
      Object.assign(window, { __xs: xs });
      const sample = () => {
        const line = document.querySelector<HTMLElement>('.playhead');
        if (line) xs.add(Math.round(line.getBoundingClientRect().x));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveText('Stop');
    await expect(page.locator('.malco-note.is-current')).toHaveCount(1); // highlight is kept
    await expect(page.locator('#play')).toHaveText('Play', { timeout: 20_000 });
    const positions = await page.evaluate(() => (window as any).__xs.size as number);
    // 11 notes: the playhead rests at 11 places at most, not hundreds.
    expect(positions).toBeGreaterThanOrEqual(8);
    expect(positions).toBeLessThanOrEqual(11);
  });
});
