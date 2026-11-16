import { describe, expect, it } from 'vitest';
import { contrastRatio, PALETTES, relativeLuminance, type ThemeName } from '../../src/ui/theme';

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#ffffff', '#777777')).toBeCloseTo(4.48, 2);
  });
});

/** WCAG 2.x AA: 4.5:1 for text, 3:1 for graphics and control boundaries. */
const TEXT = 4.5;
const GRAPHIC = 3;

describe.each(Object.keys(PALETTES) as ThemeName[])('%s theme meets WCAG AA', (name) => {
  const p = PALETTES[name];
  const cases: [what: string, fg: string, bg: string, min: number][] = [
    ['text on the page background', p.ink, p.bg, TEXT],
    ['text on surfaces', p.ink, p.surface, TEXT],
    ['secondary text on the page background', p.inkMuted, p.bg, TEXT],
    ['secondary text on surfaces', p.inkMuted, p.surface, TEXT],
    ['notation ink on the score sheet', p.ink, p.surface, TEXT],
    ['staff lines on the score sheet', p.staff, p.surface, GRAPHIC],
    ['links and the sounding note', p.accent, p.surface, TEXT],
    ['links on the page background', p.accent, p.bg, TEXT],
    ['text on the Play button', p.onAccent, p.accent, TEXT],
    ['text on a pressed button', p.ink, p.accentSoft, TEXT],
    ['control borders on surfaces', p.border, p.surface, GRAPHIC],
    ['a right note and its mark', p.good, p.surface, TEXT],
    ['a late note and its mark', p.warn, p.surface, TEXT],
    ['a wrong note and its mark', p.bad, p.surface, TEXT],
    ['control borders on the page background', p.border, p.bg, GRAPHIC],
  ];
  it.each(cases)('%s', (_what, fg, bg, min) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});
