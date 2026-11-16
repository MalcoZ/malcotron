/** One sentence saying what to try next, built from a graded take (spec section 2). */
import { allLocations } from '../content/fingering';
import type { Piece } from '../content/types';
import { summarise, type NoteGrade, type TakeGrade } from './grade';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Name of a sounding MIDI pitch, as the learner reads it. */
export function soundingName(midi: number): string {
  return NAMES[((Math.round(midi) % 12) + 12) % 12]!;
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

function fretPhrase(fret: number): string {
  return fret === 0 ? 'open' : `${ordinal(fret)} fret`;
}

function wrongNote(grade: NoteGrade, piece: Piece): string {
  const written = piece.bars[grade.expected.barIndex]?.[grade.expected.noteIndex];
  const bar = grade.expected.barIndex + 1;
  const want = soundingName(grade.expected.midi);
  const got = soundingName(grade.heardMidi!);
  const fingering = written?.fingering;
  if (fingering) {
    // If the note played is on the same string, say which fret was meant and which was played.
    const played = allLocations(grade.heardMidi! + 12).find((l) => l.string === fingering.string);
    if (played && played.fret <= 12) {
      return `Bar ${bar}: the ${want} was played as ${got}. It is the ${fretPhrase(fingering.fret)} on the ${ordinal(fingering.string)} string, not the ${fretPhrase(played.fret)}.`;
    }
    return `Bar ${bar}: the ${want} was played as ${got}. ${want} is the ${fretPhrase(fingering.fret)} on the ${ordinal(fingering.string)} string.`;
  }
  return `Bar ${bar}: the ${want} was played as ${got}.`;
}

export function feedbackFor(grade: TakeGrade, piece: Piece): string {
  const { total, pitchCorrect, onTime } = summarise(grade);
  const missed = grade.notes.filter((n) => n.reason === 'missed');
  const wrong = grade.notes.filter((n) => n.reason === 'wrong');
  if (total > 0 && missed.length > total / 2) {
    return 'Most of the notes were not heard. Check the mic is on and close to the guitar, then try again.';
  }
  if (wrong.length > 0) {
    const more = wrong.length + missed.length - 1;
    return wrongNote(wrong[0]!, piece) + (more > 0 ? ` ${more} more to fix after that.` : '');
  }
  if (missed.length > 0) {
    const first = missed[0]!;
    const name = soundingName(first.expected.midi);
    const rest = missed.length > 1 ? ` (and ${missed.length - 1} more)` : '';
    return `Bar ${first.expected.barIndex + 1}: the ${name} was not heard${rest}. Let every note sound clearly.`;
  }
  if (onTime === total) return 'Every note right and on time.';
  const offBeat = grade.notes.filter((n) => n.status !== 'green' && n.offsetMs !== null);
  const mean = offBeat.reduce((s, n) => s + n.offsetMs!, 0) / Math.max(1, offBeat.length);
  const which = mean > 0 ? 'late' : 'early';
  const count = offBeat.length === 1 ? 'One note was' : `${offBeat.length} notes were`;
  return pitchCorrect === total
    ? `All the right notes. ${count} a little ${which}: listen for the click and count along.`
    : `${count} a little ${which}.`;
}
