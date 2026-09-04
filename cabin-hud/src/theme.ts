/**
 * Single source of truth for HUD colours.
 *
 * Both React components and the radar <canvas> read from here, so the panel
 * chrome and the plotted dots can never drift out of sync. Tailwind is used
 * for layout only; semantic colour comes from this file.
 */

export const COLORS = {
  bg: '#080b0f',
  panel: '#111820',
  panelEdge: '#1e2a36',
  grid: '#1b2530',
  ring: '#2a3947',
  text: '#e6edf3',
  textDim: '#8b9bab',

  safe: '#22d37f',
  caution: '#f5b73d',
  danger: '#ff3b30',
  lost: '#5c6b7a',

  accent: '#4ea3ff',
} as const;

export type ThreatLevel = 'SAFE' | 'CAUTION' | 'DANGER' | 'LOST';

export const THREAT_COLOR: Record<ThreatLevel, string> = {
  SAFE: COLORS.safe,
  CAUTION: COLORS.caution,
  DANGER: COLORS.danger,
  LOST: COLORS.lost,
};

/** Human-facing label for each threat level, shown on the HUD. */
export const THREAT_LABEL: Record<ThreatLevel, string> = {
  SAFE: 'CLEAR',
  CAUTION: 'CAUTION',
  DANGER: 'BRAKE',
  LOST: 'SEARCHING',
};
