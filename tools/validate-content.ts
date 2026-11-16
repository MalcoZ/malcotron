/**
 * Content validator CLI: `npm run validate`.
 * Checks every piece and phrase, every lesson and the curriculum under
 * /content, and exits with code 1 if anything has an error. Run in CI before
 * the build. With file arguments, checks just those files as pieces.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PieceFile } from '../src/content/types';
import { findDuplicateIds, validatePiece, type Issue } from '../src/content/validate';
import { validateCourse } from '../src/course/lessons';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentDir = join(root, 'content');

function jsonFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(dir, name));
}

let errorCount = 0;
let warningCount = 0;

function print(kind: 'error' | 'warning', issues: readonly Issue[]): void {
  for (const i of issues) console.log(`  ${kind}: ${i.message}`);
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.log(`FAIL ${label}`);
    console.log(`  error: ${label}: not valid JSON (${(e as Error).message})`);
    errorCount++;
    return undefined;
  }
}

// --- Pieces and phrases -----------------------------------------------------
const args = process.argv.slice(2);
const piecePaths =
  args.length > 0
    ? args.map((a) => resolve(a))
    : [...jsonFilesIn(join(contentDir, 'pieces')), ...jsonFilesIn(join(contentDir, 'phrases'))];
if (piecePaths.length === 0) {
  console.error('No content files found.');
  process.exit(1);
}

const loaded: { file: string; raw: unknown }[] = [];
for (const path of piecePaths) {
  const inContent = !relative(contentDir, path).startsWith('..');
  const file = inContent ? relative(contentDir, path) : relative(root, path);
  const raw = readJson(path, file);
  if (raw === undefined) continue;
  loaded.push({ file, raw });
  const result = validatePiece(raw, file);
  const stages = result.computed
    ? ` (needs ${result.computed.pitchStage ?? '?'}, ${result.computed.rhythmStage ?? '?'})`
    : '';
  console.log(`${result.errors.length > 0 ? 'FAIL' : 'ok  '} ${file}${stages}`);
  print('error', result.errors);
  print('warning', result.warnings);
  errorCount += result.errors.length;
  warningCount += result.warnings.length;
}
const duplicates = findDuplicateIds(loaded);
print('error', duplicates);
errorCount += duplicates.length;

// --- Lessons and curriculum ---------------------------------------------------
let lessonCount = 0;
if (args.length === 0) {
  const pieces = new Map(
    loaded
      .filter((l) => typeof (l.raw as PieceFile | null)?.id === 'string')
      .map((l) => [(l.raw as PieceFile).id, l.raw as PieceFile]),
  );
  const lessonFiles = jsonFilesIn(join(contentDir, 'lessons'))
    .map((path) => {
      const file = relative(contentDir, path);
      return { file, raw: readJson(path, file) };
    })
    .filter((l) => l.raw !== undefined);
  lessonCount = lessonFiles.length;
  const curriculum = readJson(join(contentDir, 'curriculum.json'), 'curriculum.json');
  const result = validateCourse(curriculum, lessonFiles, pieces);
  for (const { file } of lessonFiles) {
    const mine = result.errors.filter((e) => e.location.file === file);
    console.log(`${mine.length > 0 ? 'FAIL' : 'ok  '} ${file}`);
    print('error', mine);
  }
  const rest = result.errors.filter((e) => e.location.file === 'curriculum.json');
  console.log(`${rest.length > 0 ? 'FAIL' : 'ok  '} curriculum.json`);
  print('error', rest);
  errorCount += result.errors.length;
  if (result.course) {
    const steps = result.course.lessons.reduce((n, l) => n + l.steps.length, 0);
    console.log(
      `\nCourse: ${result.course.chapters.length} chapter(s), ${result.course.lessons.length} lessons, ${steps} steps.`,
    );
  }
}

console.log(
  `\n${piecePaths.length} piece file(s) and ${lessonCount} lesson file(s) checked: ` +
    `${errorCount} error(s), ${warningCount} warning(s).`,
);
process.exit(errorCount > 0 ? 1 : 0);
