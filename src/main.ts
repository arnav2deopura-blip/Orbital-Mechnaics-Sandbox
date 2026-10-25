// Simulator entry (index.html): the layout shell, the 3D view, the controller that owns the
// simulation, the charts, the top bar, the modules and the warnings.
//
// ?offset=1e6 moves the whole system that far from the origin, which is what the floating
// origin is for: the picture must look the same.
import './ui/shell.css';
import { Controller } from './app/controller';
import { applyState, decodeShare } from './app/urlState';
import { FIGURE_EIGHT } from './presets/figureEight';
import { SceneView } from './render/scene';
import { createBanner } from './ui/banner';
import { BatchView } from './ui/batchView';
import { Charts, expectedEnergyBehavior } from './ui/charts';
import { REFRESH_MS } from './ui/modules/common';
import { bodiesModule, compareModule, perturbModule } from './ui/modules/bodies';
import { batchModule, exportModule, numbersModule, performanceModule } from './ui/modules/data';
import { methodModule, timeModule } from './ui/modules/method';
import { systemModule } from './ui/modules/system';
import { viewModule } from './ui/modules/view';
import { loadPrefs, savePrefs } from './ui/prefs';
import { Shell } from './ui/shell';
import { createTopBar } from './ui/topbar';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app mount point');

const rawOffset = Number(new URLSearchParams(location.search).get('offset') ?? 0);
const offset = Number.isFinite(rawOffset) ? rawOffset : 0;

const prefs = loadPrefs();
const shell = new Shell(root, prefs);
const view = new SceneView(shell.viewport);
const controller = new Controller(view, FIGURE_EIGHT, { offset });
// A link restores a run (plan §7.8), at load and when only the hash changes.
const fromHash = (): void => {
  const state = decodeShare(location.hash);
  if (state) applyState(controller, view, state);
};
fromHash();
window.addEventListener('hashchange', fromHash);

const charts = new Charts(shell.drawer, controller.sampler, () =>
  expectedEnergyBehavior(controller.sim.integrator.id, controller.sim.integrator.symplectic),
  () => controller.comparison?.sampler ?? null,
);
charts.settings.visible = prefs.charts;
charts.update(); // at once, or a hidden drawer would show until the first tick
const batch = new BatchView(shell.stage);

shell.addModules([
  systemModule(controller, view),
  methodModule(controller),
  numbersModule(controller),
  viewModule(controller, view),
  timeModule(controller),
  bodiesModule(controller),
  perturbModule(controller),
  compareModule(controller),
  exportModule(controller),
  batchModule(controller, batch),
  performanceModule(controller, view),
]);
const refreshBar = createTopBar(shell, controller, charts);
const refreshBanner = createBanner(shell, controller, prefs);

const refresh = (): void => {
  refreshBar();
  refreshBanner();
  shell.refresh();
  if (prefs.charts !== charts.settings.visible) {
    prefs.charts = charts.settings.visible;
    savePrefs(prefs);
  }
};
refresh();
window.setInterval(refresh, REFRESH_MS);
window.setInterval(() => charts.update(), 100);
controller.start();

if (import.meta.env.DEV) Object.assign(window, { __view: view, __controller: controller, __charts: charts, __shell: shell });
