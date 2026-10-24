// Simulator entry (index.html).
//
// SCAFFOLD: until app/loop.ts and app/controller.ts exist, this drives a hard-coded figure-eight
// with leapfrog so the view has something to show. The render side (SceneView, the panel) is the
// real thing; this file is what the controller will replace.
//
// ?offset=1e6 moves the whole system that far from the origin, which is what the floating
// origin is for: the picture must look the same.
import { SceneView } from './render/scene';
import { Leapfrog } from './sim/integrators/leapfrog';
import { createCounters, createState } from './sim/state';
import { createViewPanel } from './ui/panel';

const host = document.querySelector<HTMLDivElement>('#app');
if (!host) throw new Error('Missing #app mount point');

/** Plan §8.3: Chenciner & Montgomery figure-eight, G = 1, unit masses. */
const PERIOD = 6.32591398;
const state = createState();
state.m.set([1, 1, 1]);
const x1 = [0.97000436, -0.24308753, 0];
const v3 = [-0.93240737, -0.86473146, 0];
state.x.set([...x1, ...x1.map((c) => -c), 0, 0, 0]);
state.v.set([...v3.map((c) => -c / 2), ...v3.map((c) => -c / 2), ...v3]);

const offset = Number(new URLSearchParams(location.search).get('offset') ?? 0);
if (Number.isFinite(offset)) {
  for (let i = 0; i < 3; i++) {
    state.x[3 * i] += offset;
    state.x[3 * i + 1] += offset * 0.5;
    state.x[3 * i + 2] += offset * 0.25;
  }
}

const STEP = PERIOD / 4000;
const SIM_SECONDS_PER_REAL_SECOND = PERIOD / 8; // one period every 8 s
const integrator = new Leapfrog();
integrator.init(state, { dt: STEP, counters: createCounters() });

const view = new SceneView(host);
view.setSystemScale(2);
createViewPanel(view);

let owed = 0;
view.start((dt) => {
  owed += dt * SIM_SECONDS_PER_REAL_SECOND;
  while (owed >= STEP) {
    integrator.step(state);
    view.recordSample(state);
    owed -= STEP;
  }
  return state;
});

if (import.meta.env.DEV) Object.assign(window, { __view: view, __state: state });
