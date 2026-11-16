/**
 * Detection test harness: `npm run harness` (spec section 5).
 *
 * Runs the listening pipeline over the WAV files in /recordings and reports
 * how many notes were graded correctly. With no recordings it runs a built-in
 * set of synthesized takes instead, so the pipeline is still exercised.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTimeline } from '../src/audio/timeline';
import type { Piece } from '../src/content/types';
import { buildPiece } from '../src/content/validate';
import { expectedNotes, fitToOwnTempo, gradeTake, toleranceFor } from '../src/listen/grade';
import { analyseSamples } from '../src/listen/pipeline';
import { renderTake } from '../src/listen/synth';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGET = 0.95;

interface Mistake {
  bar: number;
  note: number;
  kind: 'wrong' | 'missed';
}
interface TakeInfo {
  piece: string;
  tempo: number;
  mistakes?: Mistake[];
}

function loadPieces(): Map<string, Piece> {
  const pieces = new Map<string, Piece>();
  for (const dir of ['pieces', 'phrases']) {
    for (const name of readdirSync(join(root, 'content', dir))) {
      if (!name.endsWith('.json')) continue;
      const file = `${dir}/${name}`;
      const piece = buildPiece(JSON.parse(readFileSync(join(root, 'content', file), 'utf8')), file);
      pieces.set(piece.id, piece);
    }
  }
  return pieces;
}

/** Read a PCM or float WAV file as mono samples. */
export function readWav(data: Buffer): { samples: Float32Array; sampleRate: number } {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let format = 1;
  let channels = 1;
  let sampleRate = 44100;
  let bits = 16;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = data.readUInt16LE(body);
      channels = data.readUInt16LE(body + 2);
      sampleRate = data.readUInt32LE(body + 4);
      bits = data.readUInt16LE(body + 14);
      if (format === 0xfffe) format = data.readUInt16LE(body + 24); // extensible: real format follows
    } else if (id === 'data') {
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, data.length - body) / (bytes * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const at = body + (i * channels + c) * bytes;
          if (format === 3) sum += bits === 64 ? data.readDoubleLE(at) : data.readFloatLE(at);
          else if (bits === 16) sum += data.readInt16LE(at) / 32768;
          else if (bits === 24) sum += data.readIntLE(at, 3) / 8388608;
          else if (bits === 32) sum += data.readInt32LE(at) / 2147483648;
          else if (bits === 8) sum += (data.readUInt8(at) - 128) / 128;
          else throw new Error(`unsupported bit depth ${bits}`);
        }
        samples[i] = sum / channels;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('no audio data found');
}

interface TakeResult {
  name: string;
  total: number;
  correct: number;
  detail: string[];
}

function gradeOneTake(
  name: string,
  samples: Float32Array,
  sampleRate: number,
  info: TakeInfo,
  pieces: Map<string, Piece>,
): TakeResult {
  const piece = pieces.get(info.piece);
  if (!piece) throw new Error(`unknown piece "${info.piece}"`);
  const expected = expectedNotes(buildTimeline(piece));
  const fitted = fitToOwnTempo(expected, analyseSamples(samples, sampleRate), info.tempo);
  const grade = gradeTake(expected, fitted.heard, fitted.bpm, toleranceFor(piece));
  const mistakes = new Map(
    (info.mistakes ?? []).map((m) => [`${m.bar - 1}:${m.note - 1}`, m.kind]),
  );
  const detail: string[] = [];
  let correct = 0;
  for (const note of grade.notes) {
    const where = `bar ${note.expected.barIndex + 1} note ${note.expected.noteIndex + 1}`;
    const played = mistakes.get(`${note.expected.barIndex}:${note.expected.noteIndex}`) ?? 'right';
    const verdict = note.pitchCorrect ? 'right' : note.reason === 'missed' ? 'missed' : 'wrong';
    if (played === verdict) correct++;
    else detail.push(`${where}: played ${played}, graded ${verdict}`);
  }
  detail.unshift(
    `tempo found ${fitted.bpm.toFixed(1)} BPM, ${fitted.heard.length} notes heard, ${grade.extras.length} extra`,
  );
  return { name, total: grade.notes.length, correct, detail };
}

function syntheticSet(pieces: Map<string, Piece>): TakeResult[] {
  const results: TakeResult[] = [];
  const rate = 44100;
  let seed = 1;
  for (const piece of pieces.values()) {
    for (const bpm of [60, 90, 120]) {
      const beat = 60 / bpm;
      const timeline = buildTimeline(piece);
      const struck = timeline.events.filter((e) => !e.isRest && !e.tiedFromPrevious);
      const wrongAt = (seed * 7) % struck.length;
      const missedAt = (seed * 11 + 3) % struck.length;
      const mistakes: Mistake[] = [];
      const notes = struck.flatMap((e, i) => {
        const at = { bar: e.barIndex + 1, note: e.noteIndex + 1 };
        if (i === missedAt && missedAt !== wrongAt) {
          mistakes.push({ ...at, kind: 'missed' });
          return [];
        }
        let midi = e.soundingMidi!;
        if (i === wrongAt) {
          mistakes.push({ ...at, kind: 'wrong' });
          midi += 2;
        }
        return [
          {
            // A human is never exactly on the grid: up to 25 ms either way.
            time:
              0.8 +
              (e.startBeat.n / e.startBeat.d) * beat +
              (((seed * 31 + i * 17) % 50) - 25) / 1000,
            midi: midi + (((seed + i) % 7) - 3) / 50,
            duration: (e.soundingBeats.n / e.soundingBeats.d) * beat * 0.9,
          },
        ];
      });
      const seconds = 1.6 + (timeline.totalBeats.n / timeline.totalBeats.d) * beat;
      const samples = renderTake(notes, rate, seconds, { noise: 0.003, ring: 0.15, seed: seed++ });
      results.push(
        gradeOneTake(
          `synthetic: ${piece.id} at ${bpm}`,
          samples,
          rate,
          { piece: piece.id, tempo: bpm, mistakes },
          pieces,
        ),
      );
    }
  }
  return results;
}

function main(): void {
  const pieces = loadPieces();
  const dir = join(root, 'recordings');
  const wavs = existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => /\.wav$/i.test(n))
        .sort()
    : [];
  const results: TakeResult[] = [];
  const real = wavs.length > 0;
  if (real) {
    for (const wav of wavs) {
      const infoPath = join(dir, wav.replace(/\.wav$/i, '.json'));
      try {
        if (!existsSync(infoPath)) throw new Error(`no ${basename(infoPath)} beside it`);
        const info = JSON.parse(readFileSync(infoPath, 'utf8')) as TakeInfo;
        const { samples, sampleRate } = readWav(readFileSync(join(dir, wav)));
        results.push(gradeOneTake(wav, samples, sampleRate, info, pieces));
      } catch (e) {
        console.log(`SKIP ${wav}: ${(e as Error).message}`);
      }
    }
  } else {
    console.log('No recordings found in /recordings: running the built-in synthesized takes.\n');
    results.push(...syntheticSet(pieces));
  }

  let total = 0;
  let correct = 0;
  for (const r of results) {
    total += r.total;
    correct += r.correct;
    const pct = r.total ? ((100 * r.correct) / r.total).toFixed(0) : '-';
    console.log(
      `${r.correct === r.total ? 'ok  ' : 'MISS'} ${r.name}: ${r.correct}/${r.total} (${pct}%)`,
    );
    for (const line of r.detail.slice(r.correct === r.total ? 1 : 0)) console.log(`       ${line}`);
  }
  const share = total ? correct / total : 0;
  console.log(
    `\n${results.length} take(s), ${correct} of ${total} notes graded correctly: ${(share * 100).toFixed(1)}% ` +
      `(target ${TARGET * 100}%).`,
  );
  if (!real) {
    console.log(
      'These are synthesized takes. The 95% target applies to real recordings, which are still needed.',
    );
  }
  process.exit(total > 0 && share >= TARGET ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
