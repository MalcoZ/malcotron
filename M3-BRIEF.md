# Malcotron — Milestone 3 Build Brief: Learning engine

**For:** Fable 5.2. **Read first:** `SPEC.md` revision 2, sections 2 (mastery), 3 (curriculum,
interleaving), 4 (adaptive engine), 7 (generated exercises), 10 (M3 checklist). Where this brief
and the spec differ, this brief wins for M3; note it in `DECISIONS.md`.

## Goal

The app remembers how well the learner knows each note and rhythm, decides what to practise, and
brings things back on a schedule. Home offers a session: warm-up, reviews, the next lesson, a piece.
Seven more chapters take the course through open position, key signatures and accidentals, and
through eighth notes, dotted rhythms and ties.

## Tasks

1. **Skills** (`src/engine`): derive skill ids from any piece (pitch note, key signature,
   accidental, rhythm value, meter, piece). Work out each skill's accuracy from a graded take, map
   it to an FSRS rating (spec section 4), and keep per-skill state: new, learning, mastered; FSRS
   card (`ts-fsrs`, default parameters, retention 0.9); attempts; accuracy history; peeks.
   Mastery: 90% or better in 3 sessions on 3 different days; a failed review drops it to learning.
2. **Confusions:** count which wrong pitch was played for each written pitch.
3. **Generator:** seeded, reproducible 2 to 8 bar exercises from a pool of known pitches and
   rhythm values, weighted towards the skills to practise and confusion pairs, following the
   musical rules in spec section 7. Every exercise must pass the content validator.
4. **Difficulty dials:** tempo, length, interval size, markers; step up after 3 exercises above
   95%, down after 2 below 70%.
5. **Session builder:** warm-up, reviews, new (the next lesson), apply (a piece), with the backlog
   rule. Reviews are due skills first, then skills still being learned, so mastery is reachable.
6. **Wiring:** graded takes in lessons and sessions update skills; free practice updates stats but
   is not a scheduled review; without a mic the self-check stands in for a grade. Finishing a
   lesson puts the skills it introduces into "learning". Peeks at tab are logged per skill.
   State is saved in the browser behind a versioned interface.
7. **Session screen and Home:** "Start session" with estimated minutes and reviews due; a session
   runs its items one at a time and ends with a short summary.
8. **Content:** chapters for P2, R2, P3, R3, P4, R4 and P5 as lessons, in book order. Each lesson
   declares what it introduces; the validator enforces the interleaving rule: nothing is used
   before it is taught, and a lesson introduces pitches or rhythms, not both.
9. **Tests:** unit tests for all of the above, including the two simulated-learner tests from the
   spec; end-to-end tests for a session and for skill state surviving a reload.

## Acceptance

- [ ] lint, unit tests, validation, harness, build and Playwright pass locally and in CI.
- [ ] Every generated exercise validates; the same seed gives the same exercise.
- [ ] A scripted learner who always misses one note is given more of that note; a perfect learner
      finishes Chapter 1 and masters 80% of its skills within the number of daily sessions set in
      config.
- [ ] The validator rejects a lesson that uses something before it is taught.
- [ ] A session can be run start to finish in the browser; skill state survives a reload.
- [ ] Still open and to be reported: the teaching logic has not been reviewed by Opus; lesson text
      is a first draft; nothing has been tried by a learner over several days.

Stop after M3 and report. Do not start M4.
