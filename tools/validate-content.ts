/**
 * Content validator CLI: `npm run validate`.
 * Checks every JSON file under /content (or the files given as arguments) and
 * exits with code 1 if any has an error. Run in CI before the build.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDuplicateIds, validatePiece, type Issue } from '../src/content/validate';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentDir = join(root, 'content');

function jsonFilesUnder(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return jsonFilesUnder(path);
      return name.endsWith('.json') ? [path] : [];
    });
}

const args = process.argv.slice(2);
const paths = args.length > 0 ? args.map((a) => resolve(a)) : jsonFilesUnder(contentDir);
if (paths.length === 0) {
  console.error('No content files found.');
  process.exit(1);
}

let errorCount = 0;
let warningCount = 0;
const loaded: { file: string; raw: unknown }[] = [];

function print(kind: 'error' | 'warning', issues: readonly Issue[]): void {
  for (const i of issues) console.log(`  ${kind}: ${i.message}`);
}

for (const path of paths) {
  const inContent = !relative(contentDir, path).startsWith('..');
  const file = inContent ? relative(contentDir, path) : relative(root, path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.log(`FAIL ${file}`);
    console.log(`  error: ${file}: not valid JSON (${(e as Error).message})`);
    errorCount++;
    continue;
  }
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

console.log(
  `\n${paths.length} file(s) checked: ${errorCount} error(s), ${warningCount} warning(s).`,
);
process.exit(errorCount > 0 ? 1 : 0);
