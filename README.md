# Malcotron

Malcotron is a laptop-first web app that teaches guitarists who read tab to read standard notation,
pitch and rhythm, in every position. The learner plays real guitar into the mic; the app listens,
checks each note and adapts what comes next.

- Full specification: [`SPEC.md`](SPEC.md)
- Current milestone brief: [`M0-BRIEF.md`](M0-BRIEF.md)
- Choices made while building: [`DECISIONS.md`](DECISIONS.md)
- Third-party assets and licenses: [`ASSETS.md`](ASSETS.md)

**Status: milestone 0 (foundations).** The app loads a piece from a content file, draws it as guitar
notation with fingering and position markers, shows matching tab on demand, and plays it in a nylon
guitar tone with a playhead, in light and dark themes. The mic, the learning engine and saved
progress come in later milestones.

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
/content       piece and phrase JSON files
/public        static files (guitar samples)
/src
  /content     music core, fingering function, stage check, validator, loader
  /notation    VexFlow rendering, note handles, playhead
  /audio       timeline, clock, guitar tone, playback
  /listen      mic pipeline (M1)
  /engine      skills and scheduling (M2)
  /ui          app shell, themes
  /store       saved progress (M3)
  config.ts    every tunable number
/tools         content validator CLI
/tests         unit, end-to-end, fixtures
```

## Adding content

Add a JSON file under `content/pieces` or `content/phrases` in the format described in `SPEC.md`
section 7, then run `npm run validate`. The validator checks that every token parses, every bar
matches the meter, every pitch can be reached in the declared position, and `requires` is not lower
than the stages the notes and rhythms need. Only public-domain compositions and original exercises
may be added.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`: lint, unit tests, content validation, build,
end-to-end tests, then a deploy to GitHub Pages. A failed check, including a content file that does
not validate, stops the deploy. Other branches and pull requests run the same checks without
deploying.

One-time setup in the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub
Actions**.

The site is served from `/malcotron/`, set as `base` in `vite.config.ts`.
