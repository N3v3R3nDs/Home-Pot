/** Visual themes — driven by CSS variables defined in index.css. */

export type ThemeId = 'felt-green' | 'midnight' | 'burgundy' | 'vegas-neon' | 'crimson' | 'platinum';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  blurb: string;
  /** Three swatches for the picker preview: bg, surface, accent. */
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'felt-green',
    label: 'Felt Green',
    blurb: 'The classic poker room.',
    swatch: ['#06190d', '#0a2e17', '#d8a920'],
  },
  {
    id: 'midnight',
    label: 'Midnight Royal',
    blurb: 'Deep navy with champagne accents.',
    swatch: ['#080f28', '#0f193c', '#d4af37'],
  },
  {
    id: 'burgundy',
    label: 'Burgundy',
    blurb: 'Wine cellar and brass.',
    swatch: ['#21060a', '#350c11', '#d7b623'],
  },
  {
    id: 'vegas-neon',
    label: 'Vegas Neon',
    blurb: 'Hot pink on black.',
    swatch: ['#0e0e14', '#1a1a24', '#ec4899'],
  },
  {
    id: 'crimson',
    label: 'Crimson Casino',
    blurb: 'Red velvet, copper trim.',
    swatch: ['#160404', '#2e0808', '#ec9020'],
  },
  {
    id: 'platinum',
    label: 'Platinum (light)',
    blurb: 'Sun-up lobby.',
    swatch: ['#fcfdfe', '#ebf0f3', '#c89116'],
  },
];

/** Apply a theme by setting documentElement[data-theme]. */
export function applyTheme(id: ThemeId) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = id;
  }
}
