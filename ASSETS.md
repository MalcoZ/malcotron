# Third-party assets

Everything in the repo or the built site that was not written for Malcotron. Check this file (and
the About dialog in `src/ui/about.ts`) whenever an asset is added or changed.

## Bundled assets

| Asset                                                                                                                                                                                   | Used for                                                     | Files                                                                                                                                                        | Source                                                                                                                                                                                                                              | Author                                                              | License                                                                                                                       | Changes                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Fluid (R3) General MIDI SoundFont, four guitar programs rendered to one MP3 per note: Acoustic Guitar (nylon), Acoustic Guitar (steel), Electric Guitar (clean), Electric Guitar (jazz) | The four guitar tones                                        | `public/samples/nylon`, `steel`, `clean`, `jazz`, each `40.mp3` to `83.mp3` (sounding E2 to B5; 176 files, about 3.7 MB; only the chosen tone is downloaded) | [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), folders `FluidR3_GM/acoustic_guitar_nylon-mp3`, `acoustic_guitar_steel-mp3`, `electric_guitar_clean-mp3`, `electric_guitar_jazz-mp3`, fetched 2026-11-16 | SoundFont by Frank Wen; rendered and packaged by Benjamin Gleitzman | [Creative Commons Attribution 3.0 US](https://creativecommons.org/licenses/by/3.0/us/), as stated in the source repo's README | Audio unchanged. Files renamed from note names to MIDI numbers (`E2.mp3` to `40.mp3`, and so on). |
| Bravura music font                                                                                                                                                                      | Notation glyphs (clefs, noteheads, accidentals)              | Embedded in the JavaScript bundle by the `vexflow/bravura` entry point                                                                                       | Shipped inside the `vexflow` npm package                                                                                                                                                                                            | Steinberg Media Technologies                                        | [SIL Open Font License 1.1](https://openfontlicense.org/)                                                                     | None                                                                                              |
| Academico text font                                                                                                                                                                     | Numbers and text inside the notation (fingerings, tab frets) | Embedded in the bundle, as above                                                                                                                             | Shipped inside the `vexflow` npm package                                                                                                                                                                                            | Steinberg Media Technologies                                        | [SIL Open Font License 1.1](https://openfontlicense.org/)                                                                     | None                                                                                              |

The CC BY 3.0 license allows redistribution in a public repo with attribution. The attribution is
shown in the app under **About and credits** (footer).

Note on the soundfont license: the original FluidR3 SoundFont has also been distributed under the
MIT license; the packaged audio files used here are labelled CC BY 3.0 by their packager, and this
project follows that (stricter) label.

## Runtime libraries (in the built site)

| Library                                                      | Version | License | Used for                                         |
| ------------------------------------------------------------ | ------- | ------- | ------------------------------------------------ |
| [vexflow](https://github.com/vexflow/vexflow)                | 5.0.0   | MIT     | Drawing notation and tab                         |
| [tone](https://github.com/Tonejs/Tone.js)                    | 15.1.22 | MIT     | Sampler, Transport (clock), scheduling           |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 5.4.2   | MIT     | Review scheduling (FSRS) for the learning engine |

## Development tools (not shipped)

| Tool                   | Version         | License    |
| ---------------------- | --------------- | ---------- |
| vite                   | 8.3.8           | MIT        |
| typescript             | 6.0.3           | Apache-2.0 |
| vitest                 | 5.1.0           | MIT        |
| @playwright/test       | 1.63.0          | Apache-2.0 |
| eslint, @eslint/js     | 10.15.0, 10.0.1 | MIT        |
| typescript-eslint      | 8.72.2          | MIT        |
| eslint-config-prettier | 10.1.8          | MIT        |
| globals                | 17.14.0         | MIT        |
| prettier               | 3.10.1          | MIT        |
| tsx                    | 4.23.15         | MIT        |
| @types/node            | 22.20.5         | MIT        |

## Music

All pieces are public-domain compositions newly arranged for this app, or original exercises. Each
content file records its source in its `source` field.
