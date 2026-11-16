# src/listen

The listening pipeline: mic input, pre-filter and pitch detection (`frames.ts`, `pitch.ts`), note
segmentation, alignment and grading, the feedback sentence, mic calibration, and a synthesized
guitar and simulated learner for tests. Everything except `mic.ts` is free of browser APIs, so the
detection harness in `/tools` runs the same code.
