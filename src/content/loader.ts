/**
 * Loads every piece and phrase from /content at build time (Vite glob import)
 * and parses it. Content is validated in CI, so a failure here is a bug.
 */
import type { Piece, PieceFile } from './types';
import { buildPiece } from './validate';

const modules = import.meta.glob<unknown>(
  ['../../content/pieces/*.json', '../../content/phrases/*.json'],
  { eager: true, import: 'default' },
);

/** The raw piece and phrase files by id, as the lesson validator wants them. */
export function rawPieces(): Map<string, PieceFile> {
  return new Map(Object.values(modules).map((raw) => [(raw as PieceFile).id, raw as PieceFile]));
}

function relativePath(globPath: string): string {
  return globPath.replace(/^.*\/content\//, '');
}

let cache: Piece[] | null = null;

/** All content, pieces first, then phrases, each group in id order. */
export function loadAllPieces(): Piece[] {
  if (!cache) {
    cache = Object.entries(modules)
      .map(([path, raw]) => buildPiece(raw, relativePath(path)))
      .sort((a, b) => {
        const group = (p: Piece) => (p.file.startsWith('pieces/') ? 0 : 1);
        return group(a) - group(b) || a.id.localeCompare(b.id);
      });
  }
  return cache;
}

export function getPiece(id: string): Piece | undefined {
  return loadAllPieces().find((p) => p.id === id);
}
