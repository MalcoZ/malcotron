import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Piece } from '../../src/content/types';
import { buildPiece } from '../../src/content/validate';

export const CONTENT_FILES = [
  'pieces/ode-to-joy.json',
  'phrases/p1-first-steps.json',
  'phrases/p2-low-strings.json',
  'phrases/p4-g-waltz.json',
] as const;

export function readJson(relativeToRepo: string): unknown {
  const path = fileURLToPath(new URL(`../../${relativeToRepo}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readContent(file: string): unknown {
  return readJson(`content/${file}`);
}

export function loadPiece(file: string): Piece {
  return buildPiece(readContent(file), file);
}

/** Build a piece from bar strings, with sensible defaults, for tests. */
export function makeRaw(bars: string[], overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'test-piece',
    title: 'Test',
    composer: 'Test',
    source: 'Test',
    key: 'C',
    time: '4/4',
    position: 0,
    suggestedTempo: 60,
    requires: { pitchStage: 'P5', rhythmStage: 'R5' },
    bars,
    ...overrides,
  };
}
