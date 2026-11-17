# Handoff: milestone 3 in progress

> **Superseded (2026-11-17):** milestone 3 was finished and deployed after this note was
> written; see `DECISIONS.md` entries 109 to 120. Kept for the record.

Written 2026-11-17 for a fresh session. Read this, then `SPEC.md` (revision 2) and `M3-BRIEF.md`.
`DECISIONS.md` (entries 1 to 108) has the reasoning behind everything built so far.

## Where things stand

- **Live site** (https://malcoz.github.io/malcotron/, deploys from `main`): milestones 0, 1, 2 and the
  mic fixes up to commit `a4fadc6`. CI green.
- **Branch `claude/optimistic-mccarthy-4mpquy`**: that, plus milestone 3 work in progress. **Not on
  `main`.** The user has said: *deploy to `main` without asking once checks pass.* Checks have not
  passed yet, so nothing from M3 has been deployed.
- Deploy = fast-forward `main` to the branch (`git push origin <branch>:main`), then watch the
  "Check and deploy" workflow (4 to 5 minutes; use the GitHub Actions MCP tools to read results).
- Commit trailers: use the attribution lines given in the current system reminder.

## Milestone 3: what is done

Committed (`f2f11a3`): `src/engine/` with `skills.ts`, `state.ts`, `generator.ts`, `session.ts`,
`engine.ts`, and `tests/unit/engine.test.ts` (25 tests, all passing, including both simulated-learner
tests from the spec). `ts-fsrs` 5.4.2 added (MIT). Config in `src/config.ts` (`ENGINE`).

Uncommitted, saved in the working tree (47 files changed):

- **Interleaving rule** in `src/course/lessons.ts` (`checkInterleaving`) and `src/course/types.ts`
  (`introduces`, `bootstrap`): nothing used before it is taught; a lesson introduces pitch material or
  rhythm material, not both; first lessons may be marked `bootstrap`.
- **Content:** lessons for chapters 2 to 8 (27 new lessons, 37 in all, 146 steps), `content/pieces/
  twinkle.json`, `content/curriculum.json` with 8 chapters, `introduces` added to Chapter 1 lessons.
  `npm run validate` passes with 0 errors.
- **Wiring:** `src/ui/session-view.ts` (new), `home.ts` (Start session + skill summary),
  `score-panel.ts` (takes update the engine; `practice: 'scheduled' | 'free'`; peeks logged),
  `lesson-view.ts` (completing a lesson calls `engine.completeLesson`; back to session),
  `piece-view.ts` (free practice, tracks the piece), `router.ts` (`#/session`), `app.ts`
  (engine created, `ctx.engine`, `ctx.session`, reset clears the engine), `context.ts`.
- `M3-BRIEF.md`, added to `.prettierignore`.

## Known state of the checks (last run before the pause)

- `npx tsc --noEmit` and `npm run lint`: were clean.
- `npm run validate`: passes.
- Unit tests: all passed except `tests/unit/course.test.ts`, which was written for a one-chapter
  course. Fixes applied but **not yet re-run**: its piece list now reads every file under
  `content/pieces` and `content/phrases`; the "Chapter 1" block is scoped to `chapters[0]`; the
  synthetic test lessons got `bootstrap: true`. Run `npx vitest run` first and fix anything left.
- **Playwright has not been run since the M3 wiring.** Expect failures in `tests/e2e/course.spec.ts`
  and `listen.spec.ts` (they assume 10 lessons / 1 chapter, "Next up" hero, `.lesson-list li` count of
  10, Home fitting one screen with 8 chapters folded, step counts of 48). Update them for the new
  course; the "every step fits 1280x720 without scrolling" test now covers 146 steps and may find
  steps that are too tall (check the new lessons' text length and bar counts).

## Still to do for M3

1. Get `npx vitest run` green, then the full check list: `npm run lint`, `npm test`,
   `npm run validate`, `npm run harness`, `npm run build`, `npx playwright test`.
2. Update/extend Playwright: Home shows a session button once skills exist; a session runs start to
   finish (warm-up, review, lesson hand-off, piece, summary); skill state survives a reload
   (`localStorage` key `malcotron.engine`); lessons tick off across the new chapters; the fit test.
   The simulated learner is `window.malcotron.simulateLearner(...)`. `engine` is exposed on
   `window.malcotron`.
3. Check the new lessons by reading them in the browser (screenshots at 1280x720): text is my first
   draft, 60 words or fewer per step, addressed to a tab reader. Several scores are 8 bars; confirm
   they fit.
4. Add DECISIONS.md entries (next number is 109) for: ts-fsrs dependency and license; interleaving
   rule and `bootstrap`; self-check stands for 0.92 / 0.5 accuracy; free practice is unscheduled;
   confusion keys are `writtenSounding>playedSounding`; session planner choices (backlog rule,
   warm-up from mastered or known skills, confusion drill first in reviews, piece chosen if every
   skill met); generated exercises declare P5/R5 `requires` but the stage check is computed; dials
   move tempo to +16, then length, interval, markers.
5. Update `ASSETS.md` (ts-fsrs, MIT), `README.md` status line, `SPEC.md` is fine as is.
6. Commit in small steps, push, merge to `main`, confirm the deploy, report to the user in the format
   of the earlier milestone reports (what was built, what is unverified, decisions to overrule,
   trouble for M4). Do not start M4.

## Things to be honest about in the report

- **No real-guitar verification.** All listening tests use synthesized audio. The user reported the
  mic initially heard nothing; fixes (follow-the-room noise gate, longer frame, timing bias removal,
  cleaner replay, mic switch) are deployed and the user has not yet reported back. The 95% harness
  target on real recordings is unmet and unmeasured (no recordings; `recordings/README.md`).
- **Lesson text is an unreviewed first draft.** The spec gives wording review to Opus and the user.
- **Teaching logic** (mastery, scheduling, session mix, dial order) has not been reviewed by Opus;
  the spec asks for that review for M3. Offer it.
- **Nothing has been tried by a learner over several days.**
- Not built in M3 (per `M3-BRIEF.md` scope): the placement test and Progress screen (M4), export /
  import (M4), IndexedDB (M4).

## User preferences learned this session

- Wants a guided, book-like course with instructional text; every step should fit the screen, and
  the app scrolls for them where it cannot.
- Wants fixes deployed without asking once checks pass; wants to be told when it is live.
- Reports from a real guitar are the best signal; ask for the mic-screen numbers and a test
  recording ("Record a test take" on the Mic setup screen) when listening misbehaves.
- Pronouns: use they/them for the user.

## Useful commands

- `npm run dev` (http://localhost:5173/malcotron/), `npm run build`, `npm run preview -- --port 4173`
- `npx playwright test` builds first locally; in CI the build is a separate step.
- Scratchpad for screenshots and scripts: `/tmp/claude-0/-home-user-malcotron/*/scratchpad`.
