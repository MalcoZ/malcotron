# Malcotron — Milestone 2 Build Brief: Listen

**For:** Fable 5.2
**Read first:** `SPEC.md` revision 2, sections 5 (listening), 6 (playback), 2 (core loop), 10 (M2 checklist).
Where this brief and the spec differ, this brief wins for M2; note it in `DECISIONS.md`.

## Goal

The app listens. In a practice or check step the learner presses Your turn, plays into the mic, sees
each note marked as it is heard, and gets a sentence saying what to fix. Without a mic the M1
self-check still works. The five problems raised at the end of M1 are solved along the way.

## Problems carried over from M1 (solve these)

1. **The click and the mic.** The mic will hear the metronome on speakers. Filter the mic signal so
   the click (above 2.5 kHz) cannot start a note or be read as a pitch, and prove it with a test.
2. **Self-check hand-over.** Grading replaces "How did it go?" when the mic is on; the result is
   saved with the lesson. The self-check stays as the no-mic fallback.
3. **Count-in timing.** The grader gets every time from the clock (`clock.beatAt(audioTime)`),
   which is negative during the count-in. Nothing else converts audio time to beats.
4. **Home scrolls.** Home fits one screen: compact "next up", chapters that fold, pieces folded.
5. **Compound meters.** The metronome pulse comes from the meter (dotted quarter in 6/8, 9/8,
   12/8), tested, even though no content uses those meters yet.

## Tasks

1. **Listening core** in `src/listen`, pure TypeScript with no browser dependencies so the browser
   and the test harness run the same code: pre-filter, McLeod pitch detection (75 to 1,400 Hz,
   clarity threshold), note segmentation (energy onsets and pitch changes over 40 ms), sequence
   alignment (pitch and timing), grading with the spec's tolerances, octave forgiveness, tuning
   offset, tempo fit for takes with no click. Every number in `config.ts`.
2. **Synthetic guitar and tests.** A plucked-string synthesizer for tests. Unit tests: pitch
   accuracy across E2 to B5; clean takes of all four content pieces grade 100%; wrong, missed,
   extra, early and late notes are graded as such; repeated notes are separated; clicks and noise
   in the signal do not create notes.
3. **Detection harness** (`npm run harness`): runs the pipeline over WAV files with a small JSON
   file each naming the piece, and reports notes graded correctly. The 95% target on the product
   owner's recordings cannot be checked until those recordings exist; report that plainly.
4. **Mic capture:** `getUserMedia` with echo cancellation, noise suppression and auto gain off, an
   AudioWorklet feeding the core, times taken from the audio clock. Audio is never stored or sent.
5. **Mic setup screen:** turn the mic on; noise gate from 2 s of silence; play the six open
   strings and see each detected; tuning offset; a tuner; latency calibration against 8 clicks.
   Stored per browser.
6. **Graded Your turn:** live note colouring; at the end green / amber / red with a mark as well as
   a colour, the wrong note named, a sentence of feedback, tap a mark to flip it, Again, and Hear
   what I played. Check steps save the result.
7. **Transport:** three more tones (lazy-loaded, licenses in `ASSETS.md`), metronome subdivisions,
   visual metronome, bar band, select bars to play from there or loop them.
8. **Tests:** unit tests as above; end-to-end with a simulated learner feeding synthetic audio
   through the real pipeline (perfect take, a wrong note, flip, hear what I played, saved result),
   the mic setup screen, tones, loop, Home fitting one screen.

## Acceptance

- [ ] lint, unit tests, validation, build and Playwright pass locally and in CI.
- [ ] Synthetic takes: pitch within 10 cents across the range; clean takes of all content grade
      100%; each kind of mistake is reported as that mistake.
- [ ] Clicks mixed into a take create no notes.
- [ ] A graded Your turn works end to end in the browser with the simulated learner.
- [ ] No-mic fallback works. Mic denied does not break anything.
- [ ] Four tones; loop plays the selected bars repeatedly with no gap; bar band and visual
      metronome follow the clock.
- [ ] Home fits 1280 × 720 without scrolling.
- [ ] Not checkable here, and to be reported as open: 95% on real recordings; behaviour with a real
      guitar, real room and real laptop mic.

Stop after M2 and report. Do not start M3.
