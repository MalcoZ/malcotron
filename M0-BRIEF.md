# Malcotron — Milestone 0 Build Brief: Foundations

**For:** Fable 5.2
**Read first:** `SPEC.md` (the full v1 spec) in this repo. This brief narrows it to M0. Where they conflict, this brief wins for M0; note the conflict in `DECISIONS.md`.
**Relevant spec sections:** 3 (notation convention, stages), 7 (content format), 8 (themes, design), 9 (stack, layout), 10 (M0 checklist).

## Goal

A deployed web page that loads a piece from a content file, draws it as guitar notation with fingering and position markers, reveals matching tab on demand, and plays the piece in one guitar tone with a playhead following along, in light and dark themes. No mic, learning engine or storage yet. M0 sets the foundations every later milestone builds on, so correctness of the music core (parsing, fingering, validation) and of the timing model matters more than UI polish.

## Out of scope for M0

Extra guitar tones, metronome, count-in, looping, play-from-here, mic, grading, skills/FSRS, sessions, placement, IndexedDB storage, Home/Library/Progress screens. (All of these are M1 or later.)

## Tasks (in order)

### 1. Repo scaffold

- Vite `vanilla-ts` template, TypeScript `strict: true`, no UI framework.
- ESLint + Prettier, Vitest, Playwright. Pin Node in `.nvmrc` (current LTS).
- Create the folder layout from spec section 9 (empty folders get a short `README.md`).
- `src/config.ts` holds every tunable value used so far (fingering display levels, staff zoom, layout widths).
- Add `DECISIONS.md` (dated entries: decision, reason) and `ASSETS.md` (third-party assets and licenses; empty table for now).
- `README.md`: what the project is, `npm` scripts, how to deploy.
- Dependencies allowed in M0: `vexflow` (v5), `tone`, plus dev tooling above. Anything else goes in `DECISIONS.md` with a reason. Check and record each dependency's license.

### 2. Deploy

- GitHub Actions workflow: on push to `main`, run lint, unit tests, content validation, build, then deploy to GitHub Pages.
- Vite `base: '/malcotron/'`. Target URL: `https://malcoz.github.io/malcotron/`.
- CI fails if any content file fails validation.

### 3. Music core (`src/content/music.ts` and friends)

- **Pitch:** parse written pitch strings (`C4`, `F#4`, `Bb3`, `E5`); convert to MIDI; written → sounding is −12 semitones (guitar treble clef 8vb). Grading later uses sounding pitch, display uses written.
- **Keys:** key signatures for C, G, D, A, E, F, Bb, Eb and relative minors. A note's accidental is drawn only when it differs from the key signature (or from an earlier accidental in the same bar).
- **Durations:** `w h q 8 16`, dot suffix (`q.`), `t` suffix for triplets, `r` pitch for rests, `_` suffix to tie into the next note. Express durations as exact fractions of a whole note (no floats).
- **Token grammar:** `pitch/duration[@string-fret][~finger]`, for example `F#4/8@4-4~3`, `r/q`, `G4/h_`. Write a small parser with clear errors (file, bar number, token).

### 4. Fingering function (`src/content/fingering.ts`)

Given written pitch, position and key, return `{ string, fret, finger }`.

- Standard tuning, written pitches of open strings: 6 = E3, 5 = A3, 4 = D4, 3 = G4, 2 = B4, 1 = E5.
- **Open position (0):** frets 0 to 4. Open strings get finger 0; fret f gets finger f (fret 4 → finger 4). Prefer an open string over the same pitch fretted at 5 on the next lower string.
- **Position N (N ≥ 1):** home frets N to N+3, finger = fret − N + 1. Stretches allowed to N−1 (finger 1) and N+4 (finger 4). Prefer a home-fret option over a stretch; if two home options exist, prefer the higher string number (the lower-pitched string). No open strings in positions ≥ 1 unless the content overrides.
- Content overrides (`@string-fret`, `~finger`) always win; the validator checks the override is physically valid (fret 0 to 19, pitch matches string + fret).
- A pitch that can't be reached in the given position is a validation error.
- Unit tests: a table of at least 30 cases across positions 0, 2, 5, 7 and 9, including stretches, overrides and unreachable notes.

### 5. Content: schema, loader, validator, files

- TypeScript types for the piece format in spec section 7 (`id, title, composer, source, key, time, position, suggestedTempo, requires {pitchStage, rhythmStage}, bars[]`).
- Loader: imports JSON from `/content` at build time (Vite glob import).
- Validator (`tools/validate-content.ts`, run via `npm run validate` and in CI):
  - Every token parses.
  - Every bar's total duration equals the meter (ties don't change the total). Pickup bars come later (R9); reject them for now.
  - Every pitch is reachable in the declared position.
  - **Stage check:** compute the lowest stages the piece actually needs and compare them with `requires`. Error if `requires` is lower than needed; warning if higher.
    - Rhythm (M0 covers R1 to R5): `w h q` and their rests in 4/4 → R1; dotted half, 2/4 or 3/4 → R2; eighths and eighth rests → R3; dotted quarter or any tie → R4; sixteenths → R5. Anything beyond (triplets, 6/8 and so on) → error "stage not supported yet".
    - Pitch (M0 covers P1 to P5, open position only): key C and all pitches G4 to G5 with no accidentals → P1; key C, all pitches E3 to F4, no accidentals → P2; key C, E3 to G5, no accidentals → P3; key G, F, Em or Dm with no extra accidentals → P4; any accidental outside the key, or key D or Am → P5. Positions other than 0 → error "stage not supported yet".
- Content files to add (already arranged; do not change notes without noting why in `DECISIONS.md`):

`content/pieces/ode-to-joy.json`
```json
{
  "id": "ode-to-joy",
  "title": "Ode to Joy",
  "composer": "Ludwig van Beethoven",
  "source": "Symphony No. 9, Op. 125 (1824), theme; arranged for this app, rhythm simplified for R1",
  "key": "C", "time": "4/4", "position": 0,
  "suggestedTempo": 80,
  "requires": { "pitchStage": "P1", "rhythmStage": "R1" },
  "bars": [
    "E5/q E5/q F5/q G5/q",
    "G5/q F5/q E5/q D5/q",
    "C5/q C5/q D5/q E5/q",
    "E5/q D5/q D5/h",
    "E5/q E5/q F5/q G5/q",
    "G5/q F5/q E5/q D5/q",
    "C5/q C5/q D5/q E5/q",
    "D5/q C5/q C5/h"
  ]
}
```

`content/phrases/p1-first-steps.json` (original)
```json
{
  "id": "p1-first-steps",
  "title": "First Steps",
  "composer": "Original (Malcotron)",
  "source": "Original exercise",
  "key": "C", "time": "4/4", "position": 0,
  "suggestedTempo": 60,
  "requires": { "pitchStage": "P1", "rhythmStage": "R1" },
  "bars": [
    "C5/q D5/q E5/h",
    "F5/q E5/q D5/h",
    "E5/q D5/q B4/q G4/q",
    "C5/w"
  ]
}
```

`content/phrases/p2-low-strings.json` (original; uses ledger lines below the staff)
```json
{
  "id": "p2-low-strings",
  "title": "Down Low",
  "composer": "Original (Malcotron)",
  "source": "Original exercise",
  "key": "C", "time": "4/4", "position": 0,
  "suggestedTempo": 60,
  "requires": { "pitchStage": "P2", "rhythmStage": "R1" },
  "bars": [
    "C4/q B3/q A3/q G3/q",
    "F3/q E3/q F3/q G3/q",
    "A3/q B3/q C4/q D4/q",
    "C4/w"
  ]
}
```

`content/phrases/p4-g-waltz.json` (original; key signature, 3/4, eighths, dotted rhythms)
```json
{
  "id": "p4-g-waltz",
  "title": "Little Waltz in G",
  "composer": "Original (Malcotron)",
  "source": "Original exercise",
  "key": "G", "time": "3/4", "position": 0,
  "suggestedTempo": 72,
  "requires": { "pitchStage": "P4", "rhythmStage": "R4" },
  "bars": [
    "G4/q B4/8 A4/8 B4/q",
    "D5/q C5/8 B4/8 A4/q",
    "F#4/8 G4/8 A4/8 B4/8 C5/q",
    "D5/q. C5/8 A4/q",
    "B4/q A4/8 F#4/8 A4/q",
    "G4/h."
  ]
}
```

Tokens always carry the sounding letter and accidental (`F#4` in G major). The renderer hides accidentals already covered by the key signature.

Also add 3 deliberately broken fixtures under `tests/fixtures/` (wrong bar length, unreachable pitch, `requires` too low) and test that the validator rejects each with a useful message.

### 6. Notation renderer (`src/notation/`)

- VexFlow 5, SVG output.
- Treble clef with the 8vb marking; key and time signatures on the first system; ledger lines handled by VexFlow.
- Responsive layout: bars flow into systems that fit the score area width; redraw on resize (debounced, about 150 ms) and on theme change. Staff zoom 80% to 160% from `config.ts` (a dev control is fine for now).
- **Fingering markers**, three levels from `config.ts` and a dev toggle: `all` (finger number on every note, circled string number on every note, position label at the start), `first-of-bar` (on the first note of each bar only), `none`.
- **Position label:** "Open" for position 0, roman numerals otherwise ("Pos. V"), shown above the first bar of each system when markers are not `none`.
- **Peek tab:** a tab stave under each notation stave, with the same notes and frets from the fingering function, aligned note for note. Hidden by default; toggled by a button and the `T` key. Toggling must not shift the notation's horizontal layout (reserve the tab's space in layout, or lay out both staves together and hide the tab).
- **Note handles:** keep a map from `(barIndex, noteIndex)` to the rendered SVG element for each note (and its tab counterpart). M1 colors notes and moves a playhead using these, so make the map part of the renderer's public API, with a small test that every note in a piece has one.

### 7. Basic playback (`src/audio/`)

M1 adds the metronome, count-in, looping, more tones and the mic on top of this, all sharing one clock. Design the timing layer for that now, even though M0 uses only part of it.

- **Timeline:** a pure function turns a piece into a list of note events `{ barIndex, noteIndex, startBeat, durationBeats, soundingMidi, tiedFromPrevious }`, in beats (exact fractions), independent of tempo. Tied notes sound once for their combined length; rests produce no sound but keep their place. Unit-test it on all 4 content files.
- **Clock:** one module (`src/audio/clock.ts`) wraps Tone.js `Transport`. Everything that needs time (playback now; playhead, metronome and mic grading later) asks this module, never `setTimeout`, `setInterval` or `Date.now()`. It converts beats ↔ seconds at the current tempo and exposes the current beat position.
- **Tone:** one sampled **nylon classical guitar** voice via Tone.js `Sampler`, from an openly licensed General MIDI soundfont packaged for the web. Confirm the license allows redistribution in a public repo, record it in `ASSETS.md`, and add attribution in a small About link in the footer. Load only the samples for sounding E2 to about B5. Show a loading state until samples are ready.
- **Controls:** Play/Stop button and `Space` key; a tempo slider from 30 to 220 BPM (quarter note), with a numeric readout, defaulting to the piece's `suggestedTempo`. Changing tempo during playback takes effect smoothly without restarting. Playback stops at the end of the piece and resets to the start.
- **Playhead:** a thin vertical line in the accent color moves across the current system in time with the audio, and the sounding note gets a soft highlight (the glow from spec section 8, simplified: highlight color plus about 1.08× scale). When playback reaches the next system, the playhead moves there; if the score is taller than the window, scroll smoothly to keep the current system in view. Drive all of it from the clock via Tone.js `Draw` (or `requestAnimationFrame` reading the clock), using the note-handle map from task 6.
- **Peek tab and playback together:** the playhead and highlight also cover the tab note when tab is shown.
- **Audio unlock:** audio starts only after a user gesture (the first Play press).
- Under `prefers-reduced-motion`, keep the note highlight but jump the playhead between notes instead of gliding.

### 8. UI shell

- One page: header (app name, theme toggle), a dev-only piece picker (lists all content), the score area, and a control row with **Play/Stop**, the **tempo slider**, **Peek tab** and the fingering-level toggle.
- Clean, modern, readable: one UI font (system font stack or Inter, self-hosted if used), CSS custom properties for every color, generous whitespace, score area at least 60% of the window height.
- **Themes:** light and dark. Follow `prefers-color-scheme` by default; a manual toggle overrides it and is remembered in `localStorage` (the IndexedDB store comes in M3; note this in `DECISIONS.md`). Notation is redrawn in theme colors (staff, notes and text in high-contrast ink), never CSS-inverted.
- Minimum supported width 1024 px; below it show a short "best on a larger screen" note above the score.
- Respect `prefers-reduced-motion` from the start (see task 7 for the playhead).

### 9. Tests

- Unit (Vitest): pitch parsing and MIDI, written vs sounding, key signature accidental display logic, duration math, token parser errors, fingering table, validator (good files pass, the 3 broken fixtures fail), stage computation for each content file, timeline events for each content file (start beats, durations, ties, rests), beat ↔ seconds conversion at several tempos.
- End to end (Playwright, Chromium): the page loads; Ode to Joy renders 8 bars as SVG; Peek tab shows and hides the tab stave and the notation's x-positions don't change; the theme toggle switches colors and survives a reload; each of the 4 content files renders without console errors; pressing Play starts playback, the highlighted note advances in order, and playback ends on the last note (use Tone.js offline or a mocked clock if real audio is unavailable in CI).

## Acceptance criteria (M0 is done when all pass)

- [ ] `npm run lint`, `npm test`, `npm run validate`, `npm run build` and the Playwright suite all pass locally and in CI.
- [ ] The site is live at `https://malcoz.github.io/malcotron/` and deploys automatically from `main`.
- [ ] All 4 content files render correctly: guitar treble clef with 8vb, right key and time signatures, correct ledger lines in "Down Low", F# shown by the key signature (no stray accidentals) in "Little Waltz in G".
- [ ] Fingering markers work at all three levels; position label shows "Open".
- [ ] Peek tab shows frets that match the fingering rules (spot check: Ode to Joy's G5 is string 1 fret 3; "Down Low"'s E3 is string 6 open; the waltz's F#4 is string 4 fret 4).
- [ ] Peek tab toggles with button and `T` without shifting the notation.
- [ ] Light and dark themes both meet WCAG AA contrast for text and notation.
- [ ] The renderer exposes a note-handle map covering every note.
- [ ] All 4 pieces play in the nylon tone with correct pitches (sounding an octave below written), rhythms, ties and rests, at 30, 80 and 220 BPM.
- [ ] The playhead and note highlight stay in time with the audio for the whole piece at any tempo, including after a tempo change mid-playback, and follow onto the next system.
- [ ] All timing goes through the clock module (no `setTimeout`/`setInterval`/`Date.now()` for musical timing anywhere).
- [ ] The sample license is recorded in `ASSETS.md` and credited in the About link.
- [ ] `DECISIONS.md` and `ASSETS.md` are up to date.

## When you finish

Stop after M0 and report:

1. A short summary of what was built and anything left undone.
2. Screenshots of Ode to Joy and "Little Waltz in G" in light and dark, with tab hidden and shown.
3. The `DECISIONS.md` entries added.
4. Anything in the spec that looked wrong, unclear or likely to cause trouble in M1 (especially around VexFlow note handles, layout stability, the clock module and how the mic will share it).

Do not start M1.
