// Per-viewer layout preferences: which modules are open, the width of the dock, whether the
// charts show, and whether the welcome card has been seen. Kept in localStorage, which can be
// missing or throw (private windows, blocked storage): then the defaults are used and nothing is kept.

export interface ModulePrefs {
  shown: boolean;
  collapsed: boolean;
}

export interface Prefs {
  modules: Record<string, ModulePrefs>;
  dockWidth: number;
  dockHidden: boolean;
  charts: boolean;
  welcomed: boolean;
  /** The preset last used with two bodies and with three, by id. */
  lastPresets: Partial<Record<'2' | '3', string>>;
}

const KEY = 'three-body-sandbox.layout.v1';

export const DEFAULT_DOCK_WIDTH = 380;

export function defaultPrefs(): Prefs {
  return { modules: {}, dockWidth: DEFAULT_DOCK_WIDTH, dockHidden: false, charts: true, welcomed: false, lastPresets: {} };
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
    if (typeof saved.charts === 'boolean') prefs.charts = saved.charts;
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
