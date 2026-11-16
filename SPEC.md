# Malcotron — Build Spec (v1)

Last updated 2026-11-15. Source of truth: the Malcotron spec doc on claude.ai; this file is a copy for the repo.

## 1. Overview

Malcotron is a laptop-first web app that teaches guitarists who read tab to read standard notation, pitch and rhythm, in every position. The learner plays real guitar into the mic; the app listens, checks each note against what was written, and adapts what comes next.

### Target learner

- Guitarists who can read tab and play single-note lines, from open-position beginners to experienced players (the product owner is one).
- They already know the fretboard by fret number. What they lack is the link from a note on the staff to a fret, and the ability to read rhythm.

### v1 goals

1. Teach pitch reading from open position in C up through higher positions and other keys.
2. Teach rhythm reading from whole/half/quarter notes up through syncopation.
3. Listen through the mic and grade each note for pitch, and loosely for timing.
4. Play any exercise back in a realistic guitar tone, with metronome, looping and a wide tempo range.
5. Adapt difficulty to the learner and bring mastered material back on a spaced-repetition schedule.
6. Place new learners with a placement test so experienced players skip what they know.

### Non-goals for v1

- Double stops and chords (designed for, built later).
- Importing sheet music, or transcribing Spotify/YouTube audio.
- Mobile layouts, accounts, cloud sync, streaks, XP or leaderboards.

### How to use this spec (for Fable 5.2)

- Build milestone by milestone (section 10). Each milestone ends with acceptance criteria; stop and report when they pass.
- Where this spec gives a default (a number, a threshold, a library), use it, but keep it in one config file so it can be tuned.
- Where something is ambiguous, pick the simplest option that keeps the learning model intact, and list the choice in a DECISIONS.md file in the repo.
- Never copy melodies from copyrighted sources. Only public-domain compositions and original exercises (section 7).

## 2. Learning model

The learner reads notation, plays it, and gets graded by ear; tab is a free, hidden safety net, never the default view.

### The core loop (one exercise)

1. **Preview.** Notation appears with key, time signature, tempo and (in early stages) position marker and fingering numbers. Tab is hidden.
2. **Optional listen.** The learner may press Play to hear the exercise first. Listening first is always free.
3. **Count-in and play.** A one-bar metronome count-in, then the learner plays while the app listens. A playhead moves through the score.
4. **Feedback.** Each note turns green (right pitch, on time), amber (right pitch, timing off), or red (wrong or missed pitch). Wrong notes show what was played as a ghost note.
5. **Compare.** The learner can play back the correct version, loop the bar with the error, or slow it down.
6. **Retry or move on.** One retry is offered on a miss; both attempts are recorded.

### Bridging from tab

- **Peek at tab:** a button (and keyboard shortcut) reveals tab under the staff for the current exercise. Peeking is free and never lowers a grade.
- The app still logs peeks per skill as a private signal: if a skill is peeked at on most attempts, the adaptive engine offers more practice on it. No penalty, no message to the learner.
- **Fingering and position markers** (finger numbers, position label like "Pos. V", string numbers in circles) appear in early lessons and fade out: shown for a new position, shown only on the first note of each bar once the learner is accurate, then hidden.

### Which fret is right

The same pitch exists in several places on the neck. Every exercise belongs to a position, and the fingering and tab shown are the ones inside that position. The mic hears pitch, not location, so the right pitch played anywhere counts as correct. v1 does not grade which fret was used.

### Hints

| Help | Cost |
| --- | --- |
| Peek at tab | Free (logged privately only) |
| Listen before playing | Free |
| Slow down | Free; attempts at any tempo count |

### Mastery

A skill is **mastered** when the learner has played it correctly in at least 3 separate sessions on 3 different days, at any tempo, with accuracy of 90% or more of notes in each. Mastered skills keep coming back on the review schedule (section 4); a failed review drops the skill back to "learning".

## 3. Curriculum

The curriculum runs on two tracks, pitch (P) and rhythm (R), that advance separately; each new exercise introduces only one new thing.

**Interleaving rule:** an exercise that teaches a new pitch skill uses only rhythms the learner has mastered, and an exercise that teaches a new rhythm uses only mastered pitches. Phrases and melodies combine mastered skills from both tracks.

**Notation convention:** guitar treble clef with the small 8 below (sounds an octave lower than written). Grading compares sounding pitch.

### Pitch track

| Stage | Content | Range / notes | Fingering shown |
| --- | --- | --- | --- |
| P1 | Open position, strings 1 to 3, key of C | Written G4 to G5 (open G string to 3rd fret high E) | Yes |
| P2 | Open position, strings 4 to 6, key of C | Written E3 to F4, ledger lines below the staff | Yes |
| P3 | Full open position, string crossings | E3 to G5 | Fading |
| P4 | Key signatures: G major / E minor, F major / D minor | Open position | Fading |
| P5 | Accidentals (sharp, flat, natural), enharmonics; keys D major, A minor | Open position, all 12 pitches up to 4th fret | Fading |
| P6 | 5th position: C major, A minor, G major | Frets 5 to 8 (plus stretch to 4 and 9) | New position: yes, then fading |
| P7 | 2nd position: D major, A major, B minor | Frets 2 to 5 | Same as P6 |
| P8 | 7th position: D, G, E minor | Frets 7 to 10, ledger lines above the staff | Same as P6 |
| P9 | 9th and 12th positions; flat keys Bb, Eb | Up to written A6 | Light |
| P10 | Shifts between positions within a phrase | Whole neck | Shift points only |
| P11 (post-v1) | Double stops: 3rds, 6ths, octaves | Positions already mastered | Yes, then fading |

### Rhythm track

| Stage | Content | Meter |
| --- | --- | --- |
| R1 | Whole, half, quarter notes and their rests | 4/4 |
| R2 | Dotted half; 3/4 and 2/4 | 2/4, 3/4, 4/4 |
| R3 | Eighth-note pairs and eighth rests | Simple meters |
| R4 | Dotted quarter + eighth; ties within a bar | Simple meters |
| R5 | Sixteenth notes in groups of four | 2/4, 4/4 |
| R6 | Syncopation: eighth–quarter–eighth, ties across the beat and barline | 4/4 |
| R7 | Eighth and sixteenth combinations; dotted eighth + sixteenth | 4/4 |
| R8 | Triplets; compound meter | 6/8, 3/8, 12/8 |
| R9 | Pickups, mixed meters, rests on strong beats | Mixed |

### Within a stage

Each stage moves through four kinds of exercise:

1. **Single notes:** one note on the staff, play it. Untimed at first, then with a pulse.
2. **Patterns:** generated 2 to 4 bar exercises (scale fragments, arpeggios, interval jumps) that target the stage's new notes.
3. **Phrases:** 4 to 8 bar original melodies using the stage's skills.
4. **Pieces:** public-domain melodies unlocked when all their notes and rhythms are at least "learning" (section 7).

A stage is complete when 80% of its skills are mastered; the next stage on that track unlocks then.

### Placement test

- Runs on first launch (skippable, retakeable from Settings), about 5 to 10 minutes.
- Pitch and rhythm are placed separately. It starts at P1 and R1 with short items and climbs a stage at a time.
- Each stage gets 3 to 5 items. Pass = 80% of notes correct. Two failed stages in a row ends that track's test.
- Skills in passed stages are marked **placed**: treated as mastered, but scheduled for an early check review within the first week. A failed check sends the skill back to learning.
- Before the test, a 30-second mic check and timing calibration run (section 5).

## 4. Adaptive engine and spaced repetition

The app tracks small skills, grades each from the notes the mic heard, and schedules them with the FSRS algorithm; exercises are generated to cover whatever skills are due.

### Skill units

| Skill type | Key example | Graded from |
| --- | --- | --- |
| Pitch note | `pos0/str3/A4` (written A4, 3rd string, open position) | Every occurrence of that note in an exercise |
| Key signature | `key/G` | Notes altered by that key signature |
| Accidental | `acc/sharp/F4` | Notes carrying that accidental |
| Rhythm cell | `rhy/dotted-quarter-eighth` | Onset timing of the notes in that cell |
| Meter | `meter/6-8` | Exercises in that meter, overall timing |
| Shift | `shift/pos2-pos5` | Notes right after the shift |
| Piece | `piece/minuet-g-bach` | Whole-piece accuracy |

One exercise grades many skills at once: an 8-bar phrase might update 12 pitch notes and 3 rhythm cells.

### Grading a skill from one attempt

For each skill touched, compute accuracy over its notes, then map to an FSRS rating:

| Rating | Rule |
| --- | --- |
| Again | Accuracy below 60% |
| Hard | 60% to 89%, or passed only on retry |
| Good | 90% to 99% |
| Easy | 100% on first try |

Skill states: **new → learning → mastered** (section 2 rules), plus **placed** from the placement test. FSRS sets the next review date; use the open-source `ts-fsrs` library with default parameters and a target retention of 0.9.

### Adapting difficulty

- **Target success rate: about 85%** of notes correct across a session. Above 95% for 3 exercises in a row → step up; below 70% for 2 in a row → step down.
- Dials, in this order: tempo (±8 BPM steps), exercise length (2 → 4 → 8 bars), interval size (steps → skips → leaps), fingering markers (shown → first-of-bar → hidden).
- No tempo gates in v1: attempts at any tempo count toward mastery. The app suggests a starting tempo (60 BPM quarter note for new material) and raises the suggestion as accuracy rises. Tempo gates can be added later in config.
- **Confusion tracking:** record which wrong pitch was played for each expected pitch (for example A4 expected, G4 played). Frequent pairs get exercises that put both notes side by side.

### Session (default about 15 minutes)

| Block | Minutes | Content |
| --- | --- | --- |
| Warm-up | 2 | Mastered material at a comfortable tempo |
| Reviews | 5 | Due skills, bundled into generated patterns and phrases |
| New | 5 | Next skills on each track, single notes → patterns → phrase |
| Apply | 3 | One unlocked piece or longer phrase |

- If more than 10 minutes of reviews are due, the New block shrinks to 2 minutes so the backlog clears.
- The learner can end early; progress saves after every exercise.
- **Free practice** mode: pick any unlocked piece, position or skill and drill it. Free-practice attempts update skill stats but do not count as scheduled reviews.

## 5. Listening system (mic)

The app checks single-note playing against the expected notes, entirely in the browser: it detects pitches and note starts, lines them up with the score, and grades each note.

### Pipeline

1. **Capture.** `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl` all turned off. Audio runs through an AudioWorklet in frames of 2048 samples with a hop of 512.
2. **Pitch detection.** McLeod Pitch Method (the MIT-licensed `pitchy` library, or YIN as an alternative). Range: 75 Hz to 1,400 Hz sounding. Ignore frames below a clarity threshold (default 0.9) or below a noise-gate level set during the mic check.
3. **Note segmentation.** A new note starts when (a) the level jumps (energy onset) or (b) the stable pitch changes by a semitone or more for over 40 ms (legato, slurs). This turns the stream into notes: pitch, onset time, duration, confidence.
4. **Alignment.** Match played notes to expected notes with a sequence alignment (Needleman–Wunsch or DTW) that weighs both pitch and timing. This handles missed notes, extra notes and restarts without shifting every later note into error.
5. **Grading.** Each expected note gets: pitch correct or wrong (with the played pitch), timing offset in milliseconds, and status green / amber / red (section 2).
6. **Live feedback.** Notes color in as they are heard (within about 150 ms), so the learner sees where they are.

### Tolerances (defaults, all in config)

| Check | Early stages | Later stages |
| --- | --- | --- |
| Pitch match | Within ±50 cents of the expected note, after tuning offset | Same |
| On time (green) | Within ±120 ms of the beat grid | Within ±70 ms |
| Off time (amber) | Up to ±250 ms | Up to ±150 ms |
| Beyond that | Timing miss (red for rhythm skills; pitch still credited) | Same |

- **Octave errors:** if the detected pitch is exactly an octave from the expected one and confidence is low, count it as correct. Keep this as a config flag and log how often it fires.
- **Tuning offset:** the mic check measures how far the guitar is from A440 overall (for example 15 cents flat) and compensates. A built-in tuner lives in Settings.
- **Tempo grid:** with the metronome on, timing is graded against the click. With it off, fit the learner's own steady tempo to the attempt and grade against that.

### Calibration and mic check

- **Mic check (first run, and from Settings):** play the open strings; confirm all six are detected; set the noise gate from 2 seconds of silence; measure tuning offset.
- **Latency calibration:** the learner plays along with 8 clicks; the median offset becomes this device's latency correction. Stored per browser.

### Hearing itself

- During a graded attempt the app never plays the melody, only the count-in and optional metronome.
- The app recommends headphones. On speakers, the click uses a short, high, non-pitched sound, and a **visual metronome** (pulsing beat marker) is offered as a click-free option.

### When the mic gets it wrong

- Every graded note can be tapped and flipped ("I played this right" / "I missed this"). Flips correct the grade and are logged so tolerances can be tuned.
- **No-mic mode:** if mic access is denied or fails, fall back to self-grading: after playing, the learner taps the notes they missed.

### Privacy

Audio is processed in memory and never stored or sent anywhere. A developer-only option can keep the last attempt locally for debugging; it is off by default.

### Detection test harness

Build a script that runs the pipeline on WAV files with known expected notes and reports accuracy. The product owner will record a test set (about 20 short takes of open and 5th position lines, 60 to 120 BPM, played into the laptop mic). **Target: 95% or more of notes graded correctly** on that set before milestone 2 passes.

## 6. Playback and audio

Playback is rendered from the note data with sampled guitar tones, so any tempo works without pitch change and no audio stretching is needed.

### Tones

- At least four voices: **nylon classical, steel acoustic, clean electric, jazz electric**. Selected in the transport bar; remembered per learner.
- Samples come from openly licensed General MIDI soundfonts (for example the FluidR3 or MusyngKite sets packaged for the web). **Before bundling, confirm each set's license allows redistribution in a public repo and add attribution to an About screen.** Record the license in `ASSETS.md`.
- Load only the needed range (E2 to about B5 sounding) and lazy-load voices other than the default, to keep first load small.

### Transport controls

| Control | Spec |
| --- | --- |
| Play / pause / stop | Space bar toggles play/pause |
| Tempo | 30 to 220 BPM, slider plus ±1 / ±5 buttons; shows the suggested tempo as a mark on the slider |
| Loop | Drag across bars to select; loops seamlessly, optional count-in before each pass |
| Play from here | Click any note to start there |
| Metronome | On/off, volume, accent on beat 1, optional subdivisions (eighths, sixteenths, triplets) |
| Visual metronome | Pulsing beat marker above the staff, usable with the click off |
| Count-in | 1 or 2 bars, default 1 |
| Hear what I played | After an attempt, synthesizes the notes the mic detected, in the same tone, so the learner can compare with the correct version |
| Mix | Separate volume for melody and click |

### Audio engine

- Use Tone.js (Transport for timing, Sampler for tones), scheduled with look-ahead so playback, click and the score playhead stay in sync.
- Audio starts only after a user gesture (browser rule); the first Play or Start press unlocks it.
- The playhead and note highlighting are driven from the audio clock, never from separate timers, so they cannot drift.

## 7. Content

v1 ships with about 15 public-domain melodies, newly arranged as single-note lines for this app, plus a generator for original exercises.

### Copyright rules

- Only compositions in the public domain (composer died long ago, or traditional). Arrangements are written fresh for the app in the content format below; never copy a modern published edition or a tab site.
- Melodies may be transposed or simplified to fit a stage. Record the original key and any changes in the piece's metadata.

### Starter repertoire

| Piece | Composer | Key (as arranged) | Meter | Unlocks around |
| --- | --- | --- | --- | --- |
| Ode to Joy | Beethoven | C major | 4/4 | P1, R1 |
| Ah vous dirai-je (Twinkle) | Traditional | C major | 4/4 | P1–P2, R1 |
| Lullaby (Wiegenlied) | Brahms | C major | 3/4 | P3, R2 |
| Simple Gifts | Traditional (Shaker) | F major | 2/4 | P4, R3 |
| Minuet in G | Petzold (long credited to Bach) | G major | 3/4 | P4, R3 |
| Eine kleine Nachtmusik, theme | Mozart | G major | 4/4 | P4, R5 |
| Scarborough Fair | Traditional | A Dorian | 3/4 | P5, R2 |
| Greensleeves | Traditional | A minor | 6/8 | P5, R8 |
| Canon in D, melody | Pachelbel | D major | 4/4 | P7, R5 |
| Musette in D | Anon. (Anna Magdalena Notebook) | D major | 2/4 | P7, R3 |
| Londonderry Air (Danny Boy) | Traditional | C major | 4/4 | P6, R4 |
| In the Hall of the Mountain King | Grieg | B minor | 4/4 | P7–P8, R3 |
| Für Elise, opening | Beethoven | A minor | 3/8 | P5–P6, R8 |
| Drowsy Maggie (reel) | Traditional | E minor / D | 4/4 | P8, R7 |
| Caprice No. 24, theme | Paganini | A minor | 2/4 | P9–P10, R7 |

Longer pieces can be split into sections, each its own item, then joined once each section is mastered.

### Generated exercises

- A generator builds 2 to 8 bar exercises from the skills to practice (due reviews, new skills, confusion pairs) and the rhythms allowed by the interleaving rule.
- Pattern types: scale fragments, sequences (for example 1-2-3, 2-3-4), broken thirds, arpeggios, interval drills, call-and-response phrases (2 bars + 2 bars).
- Musical rules: start and end on a chord tone of the key; mostly steps; a leap larger than a 4th is followed by a step back; phrases end on a long note.
- Use a seeded random generator so any exercise can be reproduced from its seed (needed for bug reports and tests).

### Content format

Pieces and hand-written phrases are JSON files in `/content`. Example:

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
    "E5/q D5/q D5/h"
  ]
}
```

- Note token: `pitch/duration`, written pitch, with optional `@string-fret` and `~finger` overrides (for example `F#4/8@4-4~3`). Durations: `w h q 8 16`, a dot for dotted, `t` suffix for triplets, `r` as the pitch for rests, `_` to tie into the next note.
- String, fret and finger are computed from pitch and position by a fingering function unless overridden.
- A validator checks every content file at build time: bar lengths match the meter, pitches fit the position, `requires` stages match the notes and rhythms actually used.

## 8. UI and UX

The interface is clean, modern and built around a large, readable score, with one main action per screen, light and dark themes, and motion only where it helps the learner keep their place.

### Design principles

- **The score is the hero.** On the practice screen it takes at least 60% of the window. Staff size is adjustable (zoom 80% to 160%).
- **Calm, not gamified.** No streaks, confetti or mascots. Progress is shown plainly.
- **Never color alone.** Grades use color plus a mark (green = check, amber = small clock, red = cross) so they work for color-blind learners.
- **Keyboard first on laptop:** Space play/pause, R start attempt, T peek at tab, L loop selection, ←/→ tempo ±5, M metronome.
- Minimum width 1024 px for v1. Below that, show a note saying a larger screen is needed.

### Screens

| Screen | Purpose | Key elements |
| --- | --- | --- |
| Home | Start today's session | "Start session" button with estimated minutes, reviews due, progress on each track, recently unlocked pieces |
| Practice | The core loop (section 2) | Score, playhead, transport bar, Peek tab, Start attempt, feedback, Retry / Next |
| Placement test | First-run leveling | Same practice view, simpler controls, progress through stages |
| Library | Free practice | Pieces and positions, locked ones shown with what unlocks them |
| Progress | See what's learned | Fretboard heat map of pitch skills by position, rhythm skill list, stage map for both tracks |
| Settings | Setup and data | Mic check, tuner, latency calibration, tone, theme, session length, export/import progress, About and licenses |

### Motion (easier lessons)

- A **playhead** glides smoothly across the staff, in time with the audio clock.
- The **current note** gets a soft glow and slight scale-up (about 1.08×); the next note is faintly highlighted.
- A **bar band** tints the current bar so the eye can find its place after looking at the fretboard.
- Notes **color in** as they are graded, with a 150 ms fade.
- At the end of an attempt, missed notes pulse once and a mini fretboard shows where they are in the current position.

### Motion (harder lessons)

Motion steps back as the learner advances, the way it would on a real music stand: from stage P6/R5 on, the playhead and note glow are off by default and only the visual beat marker remains. The learner can turn them back on in Settings.

All motion respects the system's reduce-motion setting (replace movement with simple highlights).

### Themes

- Light and dark, following the system setting by default with a manual toggle.
- Notation is redrawn in theme colors (staff and notes in high-contrast ink on each background), not inverted as an image.
- Use one accent color for the playhead and selections; grade colors are reserved for feedback only.
- Type: one clean sans-serif for the UI (for example Inter or the system font); large tabular numerals for tempo.

## 9. Technical architecture

A static single-page app with no UI framework, built with Vite and TypeScript, that saves progress in the browser and deploys to GitHub Pages.

### Stack

| Need | Choice | Why |
| --- | --- | --- |
| Build | Vite + TypeScript, no UI framework | Compiles to the same plain JavaScript, so no cost in speed or quality; types catch bugs in the engine and content format during long builds |
| Notation and tab | VexFlow 5 | Draws standard notation and tab, and allows per-note styling for grading and animation |
| Playback and timing | Tone.js | Sampler, Transport, look-ahead scheduling |
| Pitch detection | `pitchy` (McLeod) in an AudioWorklet | Small, MIT-licensed, accurate on guitar |
| Spaced repetition | `ts-fsrs` | Maintained FSRS implementation |
| Storage | IndexedDB via `idb-keyval` | Larger and sturdier than localStorage |
| Tests | Vitest (unit), Playwright (end to end) | Fast, runs in CI |
| Deploy | GitHub Actions → GitHub Pages | HTTPS (needed for the mic), free |

Confirm current versions and licenses when starting; pin them in `package.json`.

### Code layout

```
/src
  /content     piece JSON + loader + validator
  /notation    VexFlow rendering, playhead, note styling
  /audio       Tone.js playback, tones, metronome
  /listen      mic capture, AudioWorklet, pitch, segmentation, alignment, grading
  /engine      skills, FSRS scheduling, difficulty, session builder, exercise generator
  /ui          screens and components
  /store       IndexedDB, export/import, migrations
  config.ts    every tunable number in this spec
/tools         content validator, detection test harness
/tests         unit + end-to-end
```

### Data model

| Record | Main fields |
| --- | --- |
| Profile | schemaVersion, createdAt, pitch stage, rhythm stage, placement results |
| SkillState | skillId, state (new / learning / mastered / placed), FSRS card, attempts, accuracy history, peek count, last seen |
| Confusion | expected pitch, played pitch, count |
| Attempt | timestamp, exercise id or generator seed, tempo, per-note results (expected, played, timing offset, grade, flipped by learner) |
| Settings | tone, theme, session length, motion, metronome defaults |
| Calibration (per device) | latency ms, noise gate, tuning offset |

- **Export/import:** one JSON file with everything except calibration. Import asks before overwriting.
- Every store change bumps `schemaVersion` with a migration function and a test.
- Keep only the last 90 days of full attempt detail; older attempts are summarized into skill stats.

### Hosting notes

- Public repo named malcotron, on GitHub Pages (`malcoz.github.io/malcotron`). Set Vite's `base` path to match.
- No server and no analytics in v1. All audio stays in the browser.
- Local development uses `localhost`, which browsers also treat as secure for mic access.
- Progress lives in the browser it was made in; export/import moves it between machines.

## 10. Milestones

Five milestones; the mic is part of the first playable loop (M1), and every milestone ends with a test on a real guitar and a review against its checklist before the next one starts.

### Working loop per milestone

1. **Opus** turns this spec's milestone into a focused build brief and flags anything unclear.
2. **Fable 5.2** builds it in the repo, writes tests, and updates DECISIONS.md.
3. **Product owner** plays through it on guitar and notes what feels wrong.
4. **Opus** reviews the code and behavior against the checklist and writes a fix list.
5. Fable fixes; the milestone closes when every box is ticked.

### M0: Foundations (Fable)

- [ ] Vite + TypeScript repo, lint, Vitest, GitHub Actions deploy to Pages
- [ ] Content format, loader and validator; Ode to Joy and 3 test phrases load and validate
- [ ] VexFlow renders notation with guitar treble clef (8vb), fingering and position markers
- [ ] Peek tab toggles tab under the staff, computed by the fingering function
- [ ] Light and dark themes with notation redrawn in theme colors
- [ ] Basic playback: one nylon guitar tone, Play/Stop, tempo 30 to 220 BPM, playhead and note highlight driven by a single clock module that M1 builds on

### M1: Play and listen (Fable)

- [ ] Three more guitar tones (4 in all), sample licenses recorded in ASSETS.md
- [ ] Transport: metronome with accent and subdivisions, count-in, loop by bar selection, play from here
- [ ] Bar band added; playhead and glow show no drift over a 3-minute loop
- [ ] Mic check, tuner, latency calibration
- [ ] Listening pipeline: pitch, segmentation, alignment, grading, live note coloring
- [ ] Detection harness scores 95% or more on the product owner's recordings
- [ ] Tap-to-flip grade correction and no-mic self-grade fallback
- [ ] Hear what I played

### M2: Learning engine (Fable; Opus reviews the teaching logic)

- [ ] Skill model, grading-to-rating mapping, ts-fsrs scheduling
- [ ] Exercise generator with musical rules and seeds
- [ ] Difficulty dials and confusion tracking
- [ ] Session builder (warm-up, reviews, new, apply) with backlog rule
- [ ] Stages P1 to P5 and R1 to R4 with the interleaving rule enforced
- [ ] Simulated-learner tests: a scripted learner who always misses F4 gets more F4 exercises; a perfect learner advances one stage within a set number of sessions

### M3: Placement, progress and data (Fable)

- [ ] Placement test for both tracks, with placed skills and early check reviews
- [ ] Home, Library and Progress screens, including the fretboard heat map
- [ ] Settings complete; export/import with migration tests
- [ ] Progress survives reload, browser restart and import onto a second browser

### M4: Full curriculum, repertoire and polish (Opus writes content, Fable builds)

- [ ] Stages P6 to P10 and R5 to R9
- [ ] All 15 starter pieces arranged and validated (Opus drafts the content files; the validator must pass)
- [ ] Motion fades out from P6/R5; reduce-motion respected
- [ ] Accessibility pass: keyboard shortcuts, grade marks, contrast in both themes
- [ ] First load under 3 MB before lazy-loaded tones; practice screen stays smooth (60 fps) during playback

### Who does what

| Work | Model | Reason |
| --- | --- | --- |
| Refining the idea, this spec, milestone briefs | Opus | Planning and writing; fast iteration with you |
| Teaching logic review (mastery, grading, sequence) | Opus | Judgment calls more than code |
| Arranging melodies into content files | Opus | Musical text work, checked by the validator |
| Building M0 to M4 | Fable 5.2 | Long, multi-file builds with tests |
| Listening pipeline and timing | Fable 5.2 | The hardest technical part; needs careful iteration against the harness |
| Code review against checklists, small fixes | Opus | Quick and cheaper than a full build session |
| Post-v1: polyphonic detection, transcription, sheet import | Fable 5.2 | Research-heavy and hard |

## 11. Future roadmap and decisions

### After v1

| Feature | Notes |
| --- | --- |
| Double stops (P11) | Needs two-note detection; start with 3rds, 6ths and octaves where the expected pair is known |
| Sheet music import | MusicXML first (clean data, adds tab and playback automatically); scanned PDF/photo recognition later, and only for public-domain or the learner's own scores |
| Learn from recordings | Spotify and YouTube don't allow audio analysis, so the input would be an audio file the learner supplies, or the mic while a song plays; transcribe the melody, then teach it |
| Tablet layout | An iPad in landscape is the likely first mobile target; phones may not fit enough score |
| Sync across devices | Needs a small backend and sign-in; export/import covers it until then |
| Alternate tunings, 7-string, other clefs | Out of scope for v1, which assumes standard tuning |

### Decisions from the product owner

- **Name:** Malcotron. Repo `malcotron`, served at `malcoz.github.io/malcotron`.
- **Test recordings:** laptop mic only for v1, about 20 short takes. Audio-interface input can be tested later.
- **TypeScript:** approved, as long as it costs nothing in quality. It compiles to plain JavaScript, so it doesn't.
- **Thresholds:** no tempo gates to start. Mastery uses accuracy across separate days only; more thresholds can be added later in config.
- **Hints:** peeking at tab and listening first are both always free.
