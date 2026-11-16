/**
 * Themes. The palette lives here (not in CSS) so the notation renderer can be
 * given real colours to draw with, and so a unit test can check contrast.
 * Every colour is applied to the page as a CSS custom property.
 */
import { STORAGE_KEYS } from '../config';

export type ThemeName = 'light' | 'dark';

export interface Palette {
  /** Page background. */
  bg: string;
  /** Raised surfaces: header, control row, score sheet. */
  surface: string;
  /** Hairlines and control borders. */
  border: string;
  /** Main text and notation ink. */
  ink: string;
  /** Secondary text. */
  inkMuted: string;
  /** Staff and tab lines. */
  staff: string;
  /** The one accent: playhead, sounding note, selections, focus. */
  accent: string;
  /** Text on an accent background. */
  onAccent: string;
  /** Soft accent tint behind the sounding note. */
  accentSoft: string;
}

export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    bg: '#f3f1ec',
    surface: '#fdfcfa',
    border: '#8a8578',
    ink: '#1a1c20',
    inkMuted: '#565a63',
    staff: '#5d616a',
    accent: '#1f4fbf',
    onAccent: '#ffffff',
    accentSoft: '#d9e3fb',
  },
  dark: {
    bg: '#121419',
    surface: '#1b1e25',
    border: '#7d8494',
    ink: '#ecebe6',
    inkMuted: '#a9aebb',
    staff: '#9aa0ad',
    accent: '#8fb2ff',
    onAccent: '#0c1730',
    accentSoft: '#273552',
  },
};

const CSS_VARS: Record<keyof Palette, string> = {
  bg: '--bg',
  surface: '--surface',
  border: '--border',
  ink: '--ink',
  inkMuted: '--ink-muted',
  staff: '--staff',
  accent: '--accent',
  onAccent: '--on-accent',
  accentSoft: '--accent-soft',
};

// --- Contrast (WCAG 2.x) -----------------------------------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => channel(parseInt(h, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// --- Choosing and applying a theme ---------------------------------------------

function readStored(): ThemeName | null {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.theme);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): ThemeName {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export class ThemeController {
  private current: ThemeName;
  private listeners = new Set<(theme: ThemeName) => void>();

  constructor() {
    this.current = readStored() ?? systemTheme();
    this.apply();
    // Follow the system until the learner picks a theme by hand.
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readStored() === null) this.set(systemTheme(), false);
    });
  }

  get theme(): ThemeName {
    return this.current;
  }

  get palette(): Palette {
    return PALETTES[this.current];
  }

  /** Switch theme by hand; the choice is remembered. */
  toggle(): void {
    this.set(this.current === 'dark' ? 'light' : 'dark', true);
  }

  /** Returns a function that removes the listener. */
  onChange(listener: (theme: ThemeName) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(theme: ThemeName, remember: boolean): void {
    if (remember) {
      try {
        localStorage.setItem(STORAGE_KEYS.theme, theme);
      } catch {
        // Private browsing or storage disabled: the toggle still works for this visit.
      }
    }
    if (theme === this.current) return;
    this.current = theme;
    this.apply();
    for (const listener of this.listeners) listener(theme);
  }

  private apply(): void {
    const root = document.documentElement;
    root.dataset.theme = this.current;
    root.style.colorScheme = this.current;
    for (const [name, value] of Object.entries(this.palette)) {
      root.style.setProperty(CSS_VARS[name as keyof Palette], value);
    }
  }
}
