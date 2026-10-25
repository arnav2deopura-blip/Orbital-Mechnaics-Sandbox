// Simulator entry (index.html): the 3D view, the controller that owns the simulation, the charts and the panel.
//
// ?offset=1e6 moves the whole system that far from the origin, which is what the floating
// origin is for: the picture must look the same.
import { Controller } from './app/controller';
import { FIGURE_EIGHT } from './presets/figureEight';
import { SceneView } from './render/scene';
import { Charts, expectedEnergyBehavior } from './ui/charts';
import { createControlPanel } from './ui/panel';

const host = document.querySelector<HTMLDivElement>('#app');
if (!host) throw new Error('Missing #app mount point');

const rawOffset = Number(new URLSearchParams(location.search).get('offset') ?? 0);
const offset = Number.isFinite(rawOffset) ? rawOffset : 0;

const view = new SceneView(host);
const controller = new Controller(view, FIGURE_EIGHT, { offset });
const charts = new Charts(host, controller.sampler, () =>
  expectedEnergyBehavior(controller.sim.integrator.id, controller.sim.integrator.symplectic),
);
createControlPanel(controller, view, charts);
window.setInterval(() => charts.update(), 100);
controller.start();

if (import.meta.env.DEV) Object.assign(window, { __view: view, __controller: controller, __charts: charts });
