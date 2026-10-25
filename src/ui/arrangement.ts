// The ways to arrange the simulator page: which of the side panel and the charts drawer show, and
// how tall the drawer is. A pure table, so the menu, the keys and the tests agree.

export type ArrangementId = 'instrument' | 'orbits-charts' | 'orbits' | 'charts';

export interface Arrangement {
  id: ArrangementId;
  title: string;
  summary: string;
  panel: boolean;
  charts: boolean;
  /** The drawer's share of the stage, when it is shown. Null leaves it as the user set it. */
  size: number | null;
}

/** The drawer's share of the stage: least, most, and what a first visit has. */
export const DRAWER_MIN = 0.18;
export const DRAWER_MAX = 0.82;
export const DRAWER_DEFAULT = 0.36;
/** From here up the drawer is the main thing on the page: "Charts focus". */
export const DRAWER_LARGE = 0.7;

export const ARRANGEMENTS: readonly Arrangement[] = [
  { id: 'instrument', title: 'Instrument', summary: 'Orbits, charts and the module panel', panel: true, charts: true, size: DRAWER_DEFAULT },
  { id: 'orbits-charts', title: 'Orbits and charts', summary: 'The module panel put away', panel: false, charts: true, size: DRAWER_DEFAULT },
  { id: 'orbits', title: 'Orbits only', summary: 'The view alone, at the full width and height', panel: false, charts: false, size: null },
  { id: 'charts', title: 'Charts focus', summary: 'Tall charts under a short view, no panel', panel: false, charts: true, size: 0.78 },
];

export function clampDrawer(size: number): number {
  return Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, Number.isFinite(size) ? size : DRAWER_DEFAULT));
}

/** Which arrangement the current state is, or null when it is a mix none of them names. */
export function currentArrangement(panel: boolean, charts: boolean, size: number): ArrangementId | null {
  if (panel && charts) return size >= DRAWER_LARGE ? null : 'instrument';
  if (panel) return null;
  if (!charts) return 'orbits';
  return size >= DRAWER_LARGE ? 'charts' : 'orbits-charts';
}
