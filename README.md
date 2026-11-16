# Malcotron

Malcotron is a laptop-first web app that teaches guitarists who read tab to read standard notation,
pitch and rhythm, in every position. The learner plays real guitar into the mic; the app listens,
checks each note and adapts what comes next.

- Full specification: [`SPEC.md`](SPEC.md)
- Milestone briefs: [`M0-BRIEF.md`](M0-BRIEF.md), [`M1-BRIEF.md`](M1-BRIEF.md), [`M2-BRIEF.md`](M2-BRIEF.md)
- Choices made while building: [`DECISIONS.md`](DECISIONS.md)
- Third-party assets and licenses: [`ASSETS.md`](ASSETS.md)

**Status: milestone 2 (listen).** Opening the site starts a guided course. Chapter 1 takes a tab
reader from the five lines of the staff to playing Ode to Joy, in ten short lessons: each step
explains one idea, shows it on the staff with labels, and has you play it with a count-in and click.
With the mic on, the app listens while you play, marks every note right, late or wrong, and says
what to fix. Without a mic you check yourself. The listening has been tested on synthesized guitar
only; it still needs real recordings (see `recordings/README.md`).

Live site: <https://malcoz.github.io/malcotron/>

## Getting started

Needs Node 22 (see `.nvmrc`).

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5173/malcotron/>.

## Scripts

| Command            | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `npm run dev`      | Start the development server                          |
| `npm run build`    | Type-check, then build the site into `dist/`          |
| `npm run preview`  | Serve the built site locally                          |
| `npm run lint`     | ESLint and Prettier check                             |
| `npm run format`   | Format everything with Prettier                       |
| `npm test`         | Unit tests (Vitest)                                   |
| `npm run validate` | Validate every content file in `content/`             |
| `npm run e2e`      | End-to-end tests (Playwright, Chromium); builds first |

First-time setup for the end-to-end tests:

```bash
npx playwright install chromium
```

## Layout

```
/content       pieces, phrases, lessons and curriculum.json
/public        static files (guitar samples)
/src
  /content     music core, fingering function, stage check, validator, loader
  /notation    VexFlow rendering, note handles, playhead
  /audio       timeline, clock, guitar tone, playback
  /listen      mic input, pitch detection, segmentation, alignment, grading, calibration
  /course      lesson model, validator, progress
  /engine      skills and scheduling (M3)
  /ui          app shell, Home, lesson and piece screens, themes
  /store       saved progress (M4)
  config.ts    every tunable number
/recordings    test takes for the detection harness (not committed)
/tools         content validator and detection harness
/tests         unit, end-to-end, fixtures
```

## Adding content

- **Pieces and phrases:** add a JSON file under `content/pieces` or `content/phrases` in the format
  in `SPEC.md` section 7.
- **Lessons:** add a JSON file under `content/lessons` (format in `SPEC.md` section 7, "Lesson
  format") and list its id in `content/curriculum.json`.

Then run `npm run validate`. It checks that every token parses, every bar matches the meter, every
pitch can be reached in its position, nothing needs a higher stage than it declares, lesson text is
within the length limit, each lesson explains before it asks and ends with a check, and every lesson
is listed in the curriculum once. Only public-domain compositions and original exercises and wording
may be added.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`: lint, unit tests, content validation, build,
end-to-end tests, then a deploy to GitHub Pages. A failed check, including a content file that does
not validate, stops the deploy. Other branches and pull requests run the same checks without
deploying.

One-time setup in the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub
Actions**.

The site is served from `/malcotron/`, set as `base` in `vite.config.ts`.
