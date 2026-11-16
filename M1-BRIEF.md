# Malcotron — Milestone 1 Build Brief: Guided lessons

**For:** Fable 5.2
**Read first:** `SPEC.md` revision 2 (2026-11-16). This brief narrows it to M1. Where they conflict, this brief wins for M1; note the conflict in `DECISIONS.md`.
**Relevant spec sections:** 2 (the lesson, the core loop), 3 (book order, interleaving, within a chapter), 7 (lesson format), 8 (screens, fit and scrolling), 10 (M1 checklist).

## Goal

Opening the site puts the learner into a guided course. Home says what comes next; a lesson explains one idea in a few sentences, shows it on the staff with labels, and has the learner play it with a count-in and click. Chapter 1 takes a tab reader from "what are these five lines" to playing Ode to Joy from notation. There is no mic yet: the learner checks themselves. M2 replaces the self-check with listening, so the practice and check steps are built so that grading can be dropped in.

## Out of scope for M1

Mic, grading, tuner, calibration, extra guitar tones, looping, play-from-here, metronome subdivisions, visual metronome, skills/FSRS, generated exercises, placement test, Progress screen, IndexedDB. Chapters after Chapter 1.

## Tasks (in order)

### 1. Lesson model, loader and validator

- Types and loader for the lesson format in spec section 7, and for `content/curriculum.json` (chapters in book order, each with a title, the stages it covers, and its ordered lesson ids).
- A step's score is either inline (`key`, `time`, `position`, `bars`) or a reference to a piece or phrase by id. Either way it becomes a normal parsed `Piece`, so the renderer, timeline and player need no special case.
- Validator, part of `npm run validate` and CI:
  - Every score validates under the existing piece rules.
  - No score needs a higher pitch or rhythm stage than the lesson's `requires`.
  - `requires` of each lesson is covered by the stages of its chapter.
  - Labels point at notes that exist. `"names"` labels need no check.
  - Text: 1 to 3 paragraphs per step, at most 60 words per step in total; `**bold**` is the only markup.
  - Every lesson has at least one `explain` or `example` step before its first `practice` or `check`, and ends with a `check`.
  - Inline scores are at most 4 bars for `explain` and `example`, 8 for `practice` and `check`.
  - Every lesson file is listed in the curriculum exactly once; every listed lesson and referenced piece exists; ids match file names.
- Broken fixtures (at least 4: unknown piece, stage too high, text too long, practice before any explanation) with tests that each is rejected with a useful message.

### 2. Chapter 1 content

Write Chapter 1, "First notes", covering P1 with R1, as about 10 lessons. Suggested order (adjust if the teaching needs it, and say why in `DECISIONS.md`):

1. How this works; the staff, the clef and its small 8
2. Three open strings: G, B and E on the staff
3. The beat: bars, the time signature, quarter notes
4. Longer notes: half and whole notes
5. 1st string: E, F, G
6. 2nd string: B, C, D
7. 3rd string: G, A
8. Rests
9. All eight notes together (check: "First Steps")
10. First piece: Ode to Joy

Rules: follow the lesson-writing rules in spec section 2. Speak to someone who knows tab. Pitch lessons use only rhythms already taught; rhythm lessons use only pitches already taught. All exercises are original; do not copy wording or exercises from method books. Keep the two existing phrase files and Ode to Joy as they are and use them where they fit.

### 3. Note labels in the renderer

- Optional labels under notes: `"names"` draws the letter name (with accidental) under every note; a list draws given text under given notes. Drawn in the UI font, in theme colours, and counted in the system height so nothing is clipped.
- Labels sit on one row under the staff. They are fixed per step, so they are drawn with the score.

### 4. Clock, metronome and count-in

- **Lead-in on the clock:** the clock can start a number of beats before beat 0. During the lead-in `clock.beat` is negative; scheduling at beat 0 still means the first note. Nothing outside the clock does this arithmetic.
- **Metronome:** a short, high, unpitched click on every beat, louder on beat 1, scheduled on the clock from a pure function (beats of a piece → click events) that is unit-tested. On/off with a button and the `M` key.
- **Count-in:** one bar of clicks before beat 0.
- **Two ways to run a score:**
  - **Listen:** melody plays, click optional, no count-in. (`Space`)
  - **Your turn:** one-bar count-in, click on, melody silent, playhead and highlight move. (`R`)
- All timing still goes through the clock module; the M0 timing-rule test stays green.

### 5. Lesson screen

- One step at a time. Lesson title, "Step 3 of 5" with a progress bar, the step's title and text, the score, and the controls the step type needs:
  - `explain` / `example`: Listen, tempo, Peek tab.
  - `practice` / `check`: Listen, Your turn, metronome, tempo, Peek tab. After a Your turn pass ends, ask "How did it go?" with **Got it** and **Again** (again repeats Your turn). `check` records the answer.
- Back / Next buttons; `Enter` is Next. The last step's Next completes the lesson and goes to a short "Lesson complete" panel offering the next lesson or Home.
- The step fits a 1280 × 720 window with no scrolling, tab hidden. Text sits above the score, in a column narrow enough to read comfortably. If something cannot fit (two systems with tab shown), the app scrolls by itself during playback.
- Leaving a step stops playback. Stepping never restarts audio by itself.

### 6. Home, pieces and navigation

- Hash routes: `#/` home, `#/lesson/<id>/<step>`, `#/piece/<id>`; unknown routes go home. Reloading or sharing a URL returns to the same place.
- **Home:** a Continue button naming the next unfinished lesson; the chapter with its lessons listed, each showing done or not; lessons are open to read in any order (no locks in M1); a short list of pieces for free practice.
- **Piece view:** the M0 screen (score, Play/Stop, tempo, Peek tab, fingering level), plus the piece's `source` line as context, plus Your turn and metronome.
- Header: app name (links home), theme toggle. The dev controls (staff size) stay available but out of the way.

### 7. Progress

- `src/course/progress.ts`: lessons completed (date, self-check answer), current lesson and step. Stored in `localStorage` behind a small versioned interface so M4 can migrate it to IndexedDB. Corrupt or missing data starts fresh without errors.
- A "Reset progress" control in the About dialog (with a confirmation).

### 8. Tests

- Unit: lesson validator (good lessons pass, fixtures fail), curriculum checks, label resolution, word counting, metronome click generation in 4/4 and 3/4, lead-in beat maths, progress store (round trip, corrupt data, version).
- End to end: Home shows Continue with lesson 1; stepping through a whole lesson with Next and Enter; **every step of every Chapter 1 lesson renders without console errors and fits 1280 × 720 without scrolling**; labels appear; Your turn gives a count-in (clicks before beat 0, no melody notes) and then asks how it went; completing a lesson ticks it on Home and survives a reload; deep links work; piece view still plays; the M0 tests still pass (updated for the new routes).

## Acceptance criteria

- [ ] `npm run lint`, `npm test`, `npm run validate`, `npm run build` and the Playwright suite pass locally and in CI.
- [ ] Chapter 1 has about 10 lessons; all validate; no step exceeds 60 words; no lesson uses a note or rhythm before it is explained.
- [ ] Every step of every lesson fits 1280 × 720 without scrolling (tab hidden).
- [ ] Home shows what is next; completing lessons updates it; progress survives a reload.
- [ ] Listen and Your turn work on practice and check steps; Your turn has a one-bar count-in with an accented first beat and plays no melody.
- [ ] The metronome stays in time with the playhead at 30, 80 and 220 BPM and after a tempo change.
- [ ] Note labels draw in both themes without clipping or strange characters.
- [ ] Ode to Joy and the phrases are still playable as pieces.
- [ ] `DECISIONS.md` is up to date.

## When you finish

Stop after M1 and report: what was built and what is left; screenshots of Home, an explain step, a practice step and the lesson-complete panel, in light and dark; the new `DECISIONS.md` entries; and anything in the spec or this brief that looked wrong or will cause trouble in M2. Do not start M2.
