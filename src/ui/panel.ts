import { Pane } from 'tweakpane';
import type { Controller } from '../app/controller';
import type { CameraMode, SceneView } from '../render/scene';

// tweakpane@4.0.5's typings extend FolderApi from @tweakpane/core, which it does not install, so
// `Pane` has no folder methods as far as TypeScript can tell, though the runtime API is intact.
// This types the slice used here. Installing @tweakpane/core as a dev dependency would make it
// redundant.
interface BindingApi {
  readonly element: HTMLElement;
  on(event: 'change', handler: (event: { value: number; last: boolean }) => void): BindingApi;
}
interface FolderApi {
  addFolder(params: { title: string; expanded?: boolean }): FolderApi;
  addBinding(target: object, key: string, params?: Record<string, unknown>): BindingApi;
  addButton(params: { title: string }): { on(event: 'click', handler: () => void): void };
  refresh(): void;
}

const FOCUS_OPTIONS: Record<string, CameraMode> = {
  'Free orbit': 'free',
  'Center of mass': 'com',
  'Body 1': 'body0',
  'Body 2': 'body1',
  'Body 3': 'body2',
};

/** The panel re-reads its controls this often, since the simulation can pause itself. */
const REFRESH_MS = 250;

const scientific = (value: number): string => value.toExponential(2);

/**
 * The control panel: simulation controls and diagnostics (plan §7.1, §6), then the view
 * controls (§7.6, §7.7). Simulation controls act through the Controller. The view bindings edit
 * view.settings directly, which SceneView reads every frame; only changes that need work (a new
 * trail length) call into the view.
 */
export function createControlPanel(controller: Controller, view: SceneView, container?: HTMLElement): Pane {
  const pane = new Pane({ title: 'Three-body sandbox', container }) as Pane & FolderApi;
  addSimulationFolders(pane, controller);
  addViewFolders(pane, view);
  addPerformanceFolder(pane, controller, view);
  window.setInterval(() => pane.refresh(), REFRESH_MS);
  return pane;
}

function addSimulationFolders(pane: FolderApi, controller: Controller): void {
  const { sim, loop } = controller;
  const run = pane.addFolder({ title: 'Simulation' });
  run.addBinding(loop.settings, 'running', { label: 'run' });
  run.addButton({ title: 'Step' }).on('click', () => controller.step());
  run.addButton({ title: 'Reset' }).on('click', () => controller.reset());

  // Speed is in periods per second, so one slider suits every system. Log scale: the slider
  // holds the exponent.
  const speed = {
    get periodsPerSecond(): number {
      return Math.log10(loop.settings.speed / sim.reference.period);
    },
    set periodsPerSecond(exponent: number) {
      controller.setSpeed(10 ** exponent * sim.reference.period);
    },
  };
  run
    .addBinding(speed, 'periodsPerSecond', {
      label: 'periods / s',
      min: -3,
      max: 1,
      step: 0.01,
      format: (exponent: number) => (10 ** exponent).toPrecision(2),
    })
    .element.setAttribute('title', 'Simulated time per real second, in periods of the system (T_char). Log scale.');

  const direction = {
    get dir(): number {
      return sim.direction;
    },
    set dir(sign: number) {
      controller.setDirection(sign < 0 ? -1 : 1);
    },
  };
  run.addBinding(direction, 'dir', { label: 'direction', options: { Forward: 1, Backward: -1 } });

  const info = pane.addFolder({ title: 'Diagnostics' });
  const { readout } = controller;
  const watch = (key: keyof typeof readout, label: string, format?: (value: number) => string): void => {
    info.addBinding(readout, key, { label, readonly: true, interval: REFRESH_MS, ...(format && { format }) });
  };
  watch('status', 'status');
  watch('t', 'time', (value) => value.toFixed(3));
  watch('energyError', 'energy err', scientific);
  watch('angularMomentumError', 'L err', scientific);
  watch('momentumError', '|P|', scientific);
  watch('minSeparation', 'min sep', (value) => value.toPrecision(3));
  watch('dt', 'dt', scientific);
  watch('steps', 'steps', (value) => value.toFixed(0));
  watch('forceEvals', 'force evals', (value) => value.toFixed(0));
}

function addViewFolders(pane: FolderApi, view: SceneView): void {
  const settings = view.settings;

  const camera = pane.addFolder({ title: 'Camera' });
  camera.addBinding(settings, 'cameraMode', { label: 'focus', options: FOCUS_OPTIONS });

  const trails = pane.addFolder({ title: 'Trails' });
  trails.addBinding(settings, 'showTrails', { label: 'show' });
  trails
    .addBinding(settings, 'trailLength', { label: 'length', min: 200, max: 20000, step: 100 })
    // Resizing reallocates, so wait for the end of a drag.
    .on('change', (event) => {
      if (event.last) view.setTrailLength(event.value);
    });
  trails.addBinding(settings, 'trailFade', { label: 'fade', min: 0, max: 6, step: 0.1 });
  trails.addButton({ title: 'Clear trails' }).on('click', () => view.clearTrails());

  const display = pane.addFolder({ title: 'Display' });
  display.addBinding(settings, 'showGrid', { label: 'grid' });
  const bodySize = display.addBinding(settings, 'bodyScale', { label: 'body size', min: 0.25, max: 8, step: 0.05 });
  bodySize.element.title =
    'Displayed radius is proportional to m^(1/3), with a minimum size in pixels. It is not a physical radius.';
}

function addPerformanceFolder(pane: FolderApi, controller: Controller, view: SceneView): void {
  const perf = pane.addFolder({ title: 'Performance', expanded: false });
  const watch = (target: object, key: string, label: string, digits: number): void => {
    perf.addBinding(target, key, {
      label,
      readonly: true,
      interval: REFRESH_MS,
      format: (value: number) => value.toFixed(digits),
    });
  };
  perf.addBinding(view.stats, 'fps', { readonly: true, interval: REFRESH_MS, view: 'graph', min: 0, max: 144 });
  watch(view.stats, 'frameMs', 'frame ms', 1);
  watch(view.stats, 'renderMs', 'render ms', 2);
  watch(controller.loop.stats, 'simMs', 'sim ms', 2);
  watch(controller.loop.stats, 'stepsPerSec', 'steps / s', 0);
  watch(controller.loop.stats, 'forceEvalsPerSec', 'evals / s', 0);
  watch(controller.loop.stats, 'achieved', 'speed kept', 2);
}
