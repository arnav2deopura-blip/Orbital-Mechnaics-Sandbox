// The app (index.html): a masthead that switches between two pages, the simulator (the layout
// shell, the 3D view, the controller that owns the simulation, the charts, the instrument bar, the
// modules and the warnings) and the Learn page, which is built the first time it is opened.
// Leaving the simulator holds the run where it is; coming back picks it up.
//
// ?offset=1e6 moves the whole system that far from the origin, which is what the floating
// origin is for: the picture must look the same.
import '@fontsource-variable/archivo/wdth.css';
import './ui/tokens.css';
import './ui/shell.css';
import { BatchClient } from './app/batch';
import { Controller } from './app/controller';
import { isPageHash, onRoute, parseRoute } from './app/router';
import type { Route } from './app/router';
import { applyState, decodeShare, linkProblem, runLinks } from './app/urlState';
import { FIGURE_EIGHT } from './presets/figureEight';
import { SceneView } from './render/scene';
import { createBanner } from './ui/banner';
import { BatchView } from './ui/batchView';
import { Charts, expectedEnergyBehavior } from './ui/charts';
import { createMasthead, createNarrowNote } from './ui/masthead';
import { REFRESH_MS } from './ui/modules/common';
import { bodiesModule, compareModule, perturbModule } from './ui/modules/bodies';
import { batchModule, exportModule, numbersModule, performanceModule } from './ui/modules/data';
import { methodModule, timeModule } from './ui/modules/method';
import { systemModule } from './ui/modules/system';
import { viewModule } from './ui/modules/view';
import { loadPrefs, savePrefs } from './ui/prefs';
import { el, Shell } from './ui/shell';
import { createTopBar } from './ui/topbar';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app mount point');

const rawOffset = Number(new URLSearchParams(location.search).get('offset') ?? 0);
const offset = Number.isFinite(rawOffset) ? rawOffset : 0;

const prefs = loadPrefs();
// Both pages are built into their own element; only the one the route names is shown.
const simPage = el('div', 'page page-sim');
const learnPage = el('div', 'page page-learn learn');
learnPage.hidden = true;
const shell = new Shell(simPage, prefs);
const view = new SceneView(shell.viewport);
const controller = new Controller(view, FIGURE_EIGHT, { offset });
// The chaos probe is heavy for some systems, so it has a worker of its own, apart from the batch jobs'.
const chaosClient = new BatchClient();
controller.chaosProbe = (spec, onProgress) => chaosClient.chaos(spec, onProgress);
for (const count of ['2', '3'] as const) {
  const id = prefs.lastPresets[count];
  if (id) controller.lastPreset[Number(count) as 2 | 3] = id;
}
// A link restores a run (plan §7.8), at load and when only the hash changes. A hash that names a
// page (`#/learn/chaos`) is not a run.
// Back or Forward onto the link already showing (from the Learn page) must not restart the run, but a
// click on a "Try it" link, which also arrives here as a hash change, always starts it fresh.
let tryItClickedAt = -Infinity;
const fromHash = (): void => {
  const hash = location.hash;
  const clickedTryIt = performance.now() - tryItClickedAt < 1000;
  tryItClickedAt = -Infinity;
  if (isPageHash(hash) || !runLinks.shouldApply(hash, clickedTryIt)) return;
  const state = decodeShare(hash);
  if (state && applyState(controller, view, state)) {
    runLinks.note(hash);
    return;
  }
  const problem = linkProblem(hash);
  if (problem) controller.announce('warning', 'That link could not be opened', problem);
};
fromHash();
window.addEventListener('hashchange', fromHash);
learnPage.addEventListener(
  'click',
  (event) => {
    if ((event.target as Element).closest('a.try-it')) tryItClickedAt = performance.now();
  },
  true,
);

const charts = new Charts(shell.drawer, controller.sampler, () =>
  expectedEnergyBehavior(controller.sim.integrator.id, controller.sim.integrator.symplectic),
  () => controller.comparison?.sampler ?? null,
);
charts.settings.visible = prefs.charts;
charts.settings.size = prefs.chartsSize;
shell.bindCharts(charts);
charts.setSize(prefs.chartsSize);
charts.update(); // at once, or a hidden drawer would show until the first tick
const batch = new BatchView(shell.stage);
charts.setBodyCount(controller.bodyCount);
shell.setBodyCount(controller.bodyCount);

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
// Two bodies and three are different systems: what depends on the count is built again.
controller.onBodyCountChange(() => {
  shell.rebuildPerBody();
  shell.setBodyCount(controller.bodyCount);
  charts.setBodyCount(controller.bodyCount);
});
const refreshBar = createTopBar(shell, controller, charts);
const refreshBanner = createBanner(shell, controller, prefs);
const masthead = createMasthead(shell, charts);
root.append(createNarrowNote(), masthead.root, simPage, learnPage);

// ---- pages ---------------------------------------------------------------------------------
let simActive = true;
let learnScroll = 0;
let learn: Promise<{ show(section: string, smooth: boolean): void }> | null = null;

/** The simulator holds while it is not shown: no stepping, no drawing, and no time passes. */
const setSimActive = (active: boolean): void => {
  if (active === simActive) return;
  simActive = active;
  if (active) controller.start();
  else view.stop();
};

let shownPage: Route['page'] | null = null;
const showRoute = (route: Route): void => {
  const first = shownPage === null;
  const changed = route.page !== shownPage;
  if (route.page === 'learn') {
    simPage.hidden = true;
    learnPage.hidden = false;
    setSimActive(false);
    learn ??= import('./learn/page').then((m) => m.mountLearn(learnPage));
    learn.then(
      (page) => {
        if (route.section) page.show(route.section, !changed && !first);
        else if (changed) learnPage.scrollTop = learnScroll;
      },
      () => {
        // The page did not load (a lost connection, say): forget the failure, so that asking again tries again.
        learn = null;
        const notice = el('p', 'learn-failed');
        notice.textContent = 'The Learn page could not be loaded. Check your connection and try again.';
        const retry = el('button', 'bar-button');
        retry.type = 'button';
        retry.textContent = 'Try again';
        retry.addEventListener('click', () => showRoute(parseRoute(location.hash)));
        notice.appendChild(retry);
        learnPage.replaceChildren(notice);
      },
    );
  } else {
    if (shownPage === 'learn') learnScroll = learnPage.scrollTop;
    learnPage.hidden = true;
    simPage.hidden = false;
    setSimActive(true);
  }
  shownPage = route.page;
  document.documentElement.dataset.page = route.page;
  masthead.setRoute(route);
};

const refresh = (): void => {
  if (!simActive) return;
  refreshBar();
  refreshBanner();
  shell.refresh();
  masthead.refresh();
  const remembered = prefs.lastPresets;
  if (
    prefs.charts !== charts.settings.visible ||
    prefs.chartsSize !== charts.settings.size ||
    remembered['2'] !== controller.lastPreset[2] ||
    remembered['3'] !== controller.lastPreset[3]
  ) {
    prefs.charts = charts.settings.visible;
    prefs.chartsSize = charts.settings.size;
    prefs.lastPresets = { '2': controller.lastPreset[2], '3': controller.lastPreset[3] };
    savePrefs(prefs);
  }
};
refresh();
window.setInterval(refresh, REFRESH_MS);
window.setInterval(() => {
  if (simActive) charts.update();
}, 100);
controller.start();
onRoute(showRoute);

if (import.meta.env.DEV) Object.assign(window, { __view: view, __controller: controller, __charts: charts, __shell: shell });
