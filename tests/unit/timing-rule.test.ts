import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M0 brief: all musical timing goes through src/audio/clock.ts. No source file
 * may use setTimeout, setInterval, Date.now() or performance.now(), with one
 * listed exception that is not musical timing.
 */
const ALLOWED: Record<string, RegExp[]> = {
  // Debounce for redrawing the score after a window resize.
  'ui/app.ts': [/setTimeout/],
};

const FORBIDDEN = [/\bsetTimeout\b/, /\bsetInterval\b/, /\bDate\.now\b/, /\bperformance\.now\b/];
const src = fileURLToPath(new URL('../../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

describe('timing rule', () => {
  it('no timers or wall-clock reads outside the clock module', () => {
    const offences: string[] = [];
    for (const path of sourceFiles(src)) {
      const file = relative(src, path);
      const code = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
      for (const [i, line] of code.entries()) {
        for (const pattern of FORBIDDEN) {
          if (!pattern.test(line)) continue;
          if (ALLOWED[file]?.some((ok) => ok.source === pattern.source.replace(/\\b/g, '')))
            continue;
          offences.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('the clock is the only module that touches the Tone.js Transport', () => {
    const users = sourceFiles(src)
      .filter((path) =>
        /getTransport|Transport\b/.test(
          readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''),
        ),
      )
      .map((path) => relative(src, path));
    expect(users).toEqual(['audio/clock.ts']);
  });
});
