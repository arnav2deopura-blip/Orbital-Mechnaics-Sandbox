// Per-viewer layout preferences: which modules are open, the width of the dock and which of its
// tabs is up, whether the charts show and how tall their drawer is, and whether the welcome card
// has been seen. Kept in localStorage, which can be
// missing or throw (private windows, blocked storage): then the defaults are used and nothing is kept.

import { clampDrawer, DRAWER_DEFAULT } from './arrangement';

export interface ModulePrefs {
  shown: boolean;
  collapsed: boolean;
}

export interface Prefs {
  modules: Record<string, ModulePrefs>;
  dockWidth: number;
  dockHidden: boolean;
  /** The id of the open tab of the side panel. */
  dockTab: string;
  charts: boolean;
  /** The charts drawer's share of the stage's height. */
  chartsSize: number;
  welcomed: boolean;
  /** The preset last used with two bodies and with three, by id. */
  lastPresets: Partial<Record<'2' | '3', string>>;
}

const KEY = 'three-body-sandbox.layout.v1';

export const DEFAULT_DOCK_WIDTH = 420;

export function defaultPrefs(): Prefs {
  return { modules: {}, dockWidth: DEFAULT_DOCK_WIDTH, dockHidden: false, dockTab: 'system', charts: true, chartsSize: DRAWER_DEFAULT, welcomed: false, lastPresets: {} };
}

export function loadPrefs(): Prefs {
  const prefs = defaultPrefs();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return prefs;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    if (saved.modules && typeof saved.modules === 'object') prefs.modules = saved.modules;
    if (typeof saved.dockWidth === 'number' && Number.isFinite(saved.dockWidth)) prefs.dockWidth = saved.dockWidth;
    if (typeof saved.dockHidden === 'boolean') prefs.dockHidden = saved.dockHidden;
    if (typeof saved.dockTab === 'string') prefs.dockTab = saved.dockTab;
    if (typeof saved.charts === 'boolean') prefs.charts = saved.charts;
    if (typeof saved.chartsSize === 'number') prefs.chartsSize = clampDrawer(saved.chartsSize);
    if (typeof saved.welcomed === 'boolean') prefs.welcomed = saved.welcomed;
    for (const key of ['2', '3'] as const) {
      const id = saved.lastPresets?.[key];
      if (typeof id === 'string') prefs.lastPresets[key] = id;
    }
  } catch {
    // unreadable: keep the defaults
  }
  return prefs;
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked or full: the layout just is not remembered
  }
}
