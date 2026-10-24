import { Pane } from 'tweakpane';
import type { Controller } from '../app/controller';
import { findPreset, PRESETS } from '../presets';
import type { PlaneMode, SnapView } from '../render/frame';
import type { CameraMode, SceneView } from '../render/scene';
import type { IntegratorId } from '../sim/integrators/types';
import type { Axis, NudgeDirection } from '../sim/transforms';

// tweakpane@4.0.5's typings extend FolderApi from @tweakpane/core, which it does not install, so
// `Pane` has no folder methods as far as TypeScript can tell, though the runtime API is intact.
// This types the slice used here. Installing @tweakpane/core as a dev dependency would make it
// redundant.
interface BladeApi {
  hidden: boolean;
  disabled: boolean;
  dispose(): void;
}
interface BindingApi extends BladeApi {
  readonly element: HTMLElement;
  on(event: 'change', handler: (event: { value: number; last: boolean }) => void): BindingApi;
}
interface FolderApi extends BladeApi {
  addFolder(params: { title: string; expanded?: boolean }): FolderApi;
  addBinding(target: object, key: string, params?: Record<string, unknown>): BindingApi;
  addButton(params: { title: string }): BladeApi & { on(event: 'click', handler: () => void): void };
  refresh(): void;
}

const FOCUS_OPTIONS: Record<string, CameraMode> = {
  'Free orbit': 'free',
  'Center of mass': 'com',
  'Body 1': 'body0',
  'Body 2': 'body1',
  'Body 3': 'body2',
};

const PLANE_OPTIONS: Record<string, PlaneMode> = {
  'z = 0': 'xy',
  'Perpendicular to L': 'angular',
};

const SNAP_VIEWS: [string, SnapView][] = [
  ['Top view', 'top'],
  ['Front view', 'front'],
  ['Side view', 'side'],
  ['Isometric view', 'iso'],
];

/** The menu: "Symplectic Euler" is Euler with the reordered update, so it is one more entry here. */
const INTEGRATOR_OPTIONS: Record<string, string> = {
  Leapfrog: 'leapfrog',
  RK4: 'rk4',
  'Wisdom-Holman': 'wh',
  IAS15: 'ias15',
  Euler: 'euler',
  'Symplectic Euler': 'symplectic-euler',
};

const BODY_OPTIONS: Record<string, number> = { 'Body 1': 0, 'Body 2': 1, 'Body 3': 2 };

/** The panel re-reads its controls this often, since the simulation can pause itself. */
const REFRESH_MS = 250;

const scientific = (value: number): string => value.toExponential(2);
const fixed = (digits: number) => (value: number): string => value.toFixed(digits);

/**
 * The control panel: preset, simulation, diagnostics, body editor, perturbation, then the view
 * controls (plan §7.1, §7.2, §7.6, §7.7). Everything that changes the system goes through the
 * Controller. The view bindings edit view.settings directly, which SceneView reads every frame;
 * only changes that need work (a new trail length) call into the view.
 */
export function createControlPanel(controller: Controller, view: SceneView, container?: HTMLElement): Pane {
  const pane = new Pane({ title: 'Three-body sandbox', container }) as Pane & FolderApi;
  const syncs: (() => void)[] = [];
  addPresetFolder(pane, controller);
  addSimulationFolders(pane, controller, syncs);
  addBodiesFolder(pane, controller);
  addPerturbFolder(pane, controller);
  addViewFolders(pane, view);
  addPerformanceFolder(pane, controller, view);
  const refresh = (): void => {
    for (const sync of syncs) sync();
    pane.refresh();
  };
  refresh();
  window.setInterval(refresh, REFRESH_MS);
  return pane;
}

function setTitle(binding: BindingApi, text: string | undefined): void {
  if (text) binding.element.setAttribute('title', text);
}

function addPresetFolder(pane: FolderApi, controller: Controller): void {
  const folder = pane.addFolder({ title: 'Preset' });
  let sliders: BindingApi[] = [];

  const rebuild = (): void => {
    for (const slider of sliders) slider.dispose();
    sliders = (controller.preset.params ?? []).map((spec) => {
      const binding = folder
        .addBinding(controller.params, spec.key, { label: spec.label, min: spec.min, max: spec.max, step: spec.step })
        // Loading restarts the run, so wait for the end of a drag.
        .on('change', (event) => {
          if (event.last) controller.applyParams();
        });
      setTitle(binding, spec.hint);
      return binding;
    });
  };

  // `id` is read and written through the controller, so loading a preset by any route shows in the menu.
  const choice = {
    get id(): string {
      return controller.preset.id;
    },
    set id(id: string) {
      const preset = findPreset(id);
      if (!preset || preset === controller.preset) return;
      controller.loadPreset(preset);
      rebuild();
    },
  };
  folder.addBinding(choice, 'id', {
    label: 'preset',
    options: Object.fromEntries(PRESETS.map((preset) => [preset.name, preset.id])),
  });
  folder.addBinding(
    {
      get about(): string {
        return controller.preset.demonstrates;
      },
    },
    'about',
    { label: '', readonly: true, multiline: true, rows: 4 },
  );
  rebuild();
}

function addSimulationFolders(pane: FolderApi, controller: Controller, syncs: (() => void)[]): void {
  const { sim, loop } = controller;
  const run = pane.addFolder({ title: 'Simulation' });
  run.addBinding(loop.settings, 'running', { label: 'run' });
  run.addButton({ title: 'Step' }).on('click', () => controller.step());
  run.addButton({ title: 'Reset' }).on('click', () => controller.reset());

  // Speed is in periods per second, so one slider suits every system. Log scale: the slider
  // holds the exponent. The range must cover every speed a preset recommends: a slider clamps
  // what it shows, and writes the clamped value back.
  const speed = {
    get periodsPerSecond(): number {
      return Math.log10(loop.settings.speed / sim.reference.period);
    },
    set periodsPerSecond(exponent: number) {
      controller.setSpeed(10 ** exponent * sim.reference.period);
    },
  };
  setTitle(
    run.addBinding(speed, 'periodsPerSecond', {
      label: 'periods / s',
      min: -4,
      max: 3,
      step: 0.01,
      format: (exponent: number) => (10 ** exponent).toPrecision(2),
    }),
    'Simulated time per real second, in periods of the system (T_char). Log scale.',
  );

  const direction = {
    get dir(): number {
      return sim.direction;
    },
    set dir(sign: number) {
      controller.setDirection(sign < 0 ? -1 : 1);
    },
  };
  run.addBinding(direction, 'dir', { label: 'direction', options: { Forward: 1, Backward: -1 } });

  // ---- method -----------------------------------------------------------------------------

  const method = pane.addFolder({ title: 'Method' });
  const integrator = {
    get id(): string {
      return sim.integrator.id === 'euler' && sim.integrator.symplectic ? 'symplectic-euler' : sim.integrator.id;
    },
    set id(choice: string) {
      if (choice === 'symplectic-euler') controller.setIntegrator('euler', true);
      else controller.setIntegrator(choice as IntegratorId);
    },
  };
  method.addBinding(integrator, 'id', { label: 'integrator', options: INTEGRATOR_OPTIONS });

  // Step size, as a power of ten of T_char: the slider's exponent, shown as "T_char / N".
  const stepSize = {
    get exponent(): number {
      return Math.log10(sim.params.dt / sim.reference.period);
    },
    set exponent(exponent: number) {
      controller.setDt(10 ** exponent * sim.reference.period);
    },
  };
  const dt = method.addBinding(stepSize, 'exponent', {
    label: 'dt',
    min: -5.5,
    max: -0.5,
    step: 0.01,
    format: (exponent: number) => `T/${Math.round(10 ** -exponent)}`,
  });
  setTitle(dt, 'Step size as a fraction of T_char, the shortest orbital period. For IAS15 this is only the first guess.');

  const central = {
    get body(): number {
      return sim.params.centralBody ?? -1;
    },
    set body(value: number) {
      controller.setCentralBody(value < 0 ? undefined : (value as 0 | 1 | 2));
    },
  };
  const centralBinding = method.addBinding(central, 'body', {
    label: 'central body',
    options: { 'Most massive': -1, ...BODY_OPTIONS },
  });
  setTitle(centralBinding, 'Wisdom-Holman: the body the others orbit. For a star, planet and moon use the planet.');

  // IAS15's limits, as exponents of ten; the end of each slider means "no limit".
  const ias = sim.params;
  const tolerance = {
    get exp(): number {
      return Math.log10(ias.epsTol ?? 1e-9);
    },
    set exp(value: number) {
      ias.epsTol = 10 ** value;
    },
  };
  const tolBinding = method.addBinding(tolerance, 'exp', {
    label: 'tolerance',
    min: -12,
    max: -4,
    step: 0.1,
    format: (value: number) => `1e${value.toFixed(1)}`,
  });
  setTitle(tolBinding, 'IAS15: the size of the last term of its polynomial, relative to the acceleration. Smaller is more accurate.');
  const limit = (key: 'dtMin' | 'dtMax', off: number) => ({
    get exp(): number {
      const value = ias[key];
      return value === undefined ? off : Math.log10(value / sim.reference.period);
    },
    set exp(value: number) {
      ias[key] = value === off ? undefined : 10 ** value * sim.reference.period;
    },
  });
  const dtMin = limit('dtMin', -12);
  const dtMax = limit('dtMax', 1);
  const dtMinBinding = method.addBinding(dtMin, 'exp', {
    label: 'min dt',
    min: -12,
    max: -3,
    step: 0.1,
    format: (value: number) => (value === -12 ? 'off' : `T x 1e${value.toFixed(1)}`),
  });
  const dtMaxBinding = method.addBinding(dtMax, 'exp', {
    label: 'max dt',
    min: -4,
    max: 1,
    step: 0.1,
    format: (value: number) => (value === 1 ? 'off' : `T x 1e${value.toFixed(1)}`),
  });
  setTitle(dtMinBinding, 'IAS15: the smallest step it may take, in units of T_char. Hitting it is reported as an unresolved encounter.');
  setTitle(dtMaxBinding, 'IAS15: the largest step it may take, in units of T_char.');

  const events = pane.addFolder({ title: 'Events', expanded: false });
  const encounter = { radius: 0, stop: false };
  const applyEncounter = (): void => controller.setEncounter(encounter.radius, encounter.stop);
  setTitle(
    events.addBinding(encounter, 'radius', { label: 'encounter dist.', min: 0, step: 0.001 }).on('change', applyEncounter),
    'Note when two bodies come closer than this (0 is off). Bodies never merge: this is also the collision radius.',
  );
  events.addBinding(encounter, 'stop', { label: 'pause there' }).on('change', applyEncounter);

  const physics = pane.addFolder({ title: 'Physics' });
  const constants = {
    get G(): number {
      return sim.state.G;
    },
    set G(value: number) {
      if (value > 0) controller.setG(value);
    },
    get softening(): number {
      return Math.sqrt(sim.state.eps2);
    },
    set softening(value: number) {
      if (value >= 0) controller.setSoftening(value);
    },
  };
  setTitle(
    physics.addBinding(constants, 'G', { label: 'G', step: 0.01 }),
    'Changing G changes the energy, so the energy and angular momentum errors restart from here.',
  );
  const softeningBinding = physics.addBinding(constants, 'softening', { label: 'softening', min: 0, step: 0.001 });
  setTitle(softeningBinding, 'Plummer softening length: r^2 becomes r^2 + e^2 in the force. Wisdom-Holman has none.');

  // Controls that apply to one method only are hidden for the rest.
  syncs.push(() => {
    const id = sim.integrator.id;
    centralBinding.hidden = id !== 'wh';
    for (const binding of [tolBinding, dtMinBinding, dtMaxBinding]) binding.hidden = id !== 'ias15';
    softeningBinding.disabled = id === 'wh';
  });

  // ---- diagnostics ------------------------------------------------------------------------

  const info = pane.addFolder({ title: 'Diagnostics' });
  const { readout } = controller;
  const watch = (key: keyof typeof readout, label: string, format?: (value: number) => string, hint?: string): void => {
    const binding = info.addBinding(readout, key, { label, readonly: true, interval: REFRESH_MS, ...(format && { format }) });
    setTitle(binding, hint);
  };
  watch('status', 'status');
  watch('t', 'time', fixed(3));
  watch('energyError', 'energy err', scientific);
  watch('angularMomentumError', 'L err', scientific);
  watch('momentumError', '|P|', scientific);
  watch('minSeparation', 'min sep', (value) => value.toPrecision(3));
  watch('routh', 'Routh', fixed(3), "27 (m1 m2 + m2 m3 + m3 m1) / M^2. Lagrange's equilateral solution is stable below 1.");
  watch('dt', 'dt', scientific);
  watch('steps', 'steps', fixed(0));
  watch('forceEvals', 'force evals', fixed(0));
}

function addBodiesFolder(pane: FolderApi, controller: Controller): void {
  const folder = pane.addFolder({ title: 'Bodies (edit z here)', expanded: false });
  controller.draft.forEach((body, i) => {
    const sub = folder.addFolder({ title: `Body ${i + 1}`, expanded: i === 0 });
    sub.addBinding(body, 'm', { label: 'mass', min: 0, step: 0.001 });
    const axes = { x: { step: 0.01 }, y: { step: 0.01 }, z: { step: 0.01 } };
    sub.addBinding(body, 'pos', { label: 'position', ...axes });
    sub.addBinding(body, 'vel', { label: 'velocity', ...axes });
  });

  const options = { recenter: true };
  setTitle(
    folder.addBinding(options, 'recenter', { label: 're-center COM' }),
    'Shift everything so the center of mass is at the origin and at rest. The total momentum is then zero.',
  );
  const apply = folder.addButton({ title: 'Apply edits' });
  apply.on('click', () => controller.applyDraft(options.recenter));
  setButtonHint(apply, 'Pauses, applies the values above, restarts the energy and angular momentum references, and clears the trails.');
  folder.addButton({ title: 'Read current state' }).on('click', () => controller.readDraft());

  const turn = { axis: 'x', degrees: 30 };
  const rotate = folder.addFolder({ title: 'Tilt the whole system' });
  rotate.addBinding(turn, 'axis', { label: 'about axis', options: { x: 'x', y: 'y', z: 'z' } });
  rotate.addBinding(turn, 'degrees', { label: 'angle (deg)', min: -180, max: 180, step: 1 });
  rotate.addButton({ title: 'Rotate' }).on('click', () => controller.rotate(turn.axis as Axis, turn.degrees));
}

function setButtonHint(button: BladeApi, text: string): void {
  (button as unknown as { element: HTMLElement }).element.setAttribute('title', text);
}

function addPerturbFolder(pane: FolderApi, controller: Controller): void {
  const folder = pane.addFolder({ title: 'Perturb (chaos)', expanded: false });
  const spec = { body: 2, target: 'velocity', direction: 'normal', exponent: -6, recenter: false };
  folder.addBinding(spec, 'body', { label: 'body', options: BODY_OPTIONS });
  folder.addBinding(spec, 'target', { label: 'nudge its', options: { velocity: 'velocity', position: 'position' } });
  setTitle(
    folder.addBinding(spec, 'direction', {
      label: 'direction',
      options: { 'Out of plane (L)': 'normal', z: 'z', x: 'x', y: 'y', Random: 'random' },
    }),
    'Out of plane is along the angular momentum: it takes a planar system into 3D.',
  );
  setTitle(
    folder.addBinding(spec, 'exponent', {
      label: 'size',
      min: -12,
      max: -2,
      step: 0.1,
      format: (value: number) => (10 ** value).toExponential(0),
    }),
    'As a fraction of the size of the system (position) or its typical speed (velocity).',
  );
  folder.addBinding(spec, 'recenter', { label: 're-center COM' });
  const nudge = folder.addButton({ title: 'Nudge' });
  nudge.on('click', () =>
    controller.nudge(
      {
        body: spec.body,
        target: spec.target as 'position' | 'velocity',
        direction: spec.direction as NudgeDirection,
        size: 10 ** spec.exponent,
      },
      spec.recenter,
    ),
  );
  setButtonHint(nudge, 'Restarts the energy and angular momentum references from the nudged state.');
}

function addViewFolders(pane: FolderApi, view: SceneView): void {
  const settings = view.settings;

  const camera = pane.addFolder({ title: 'Camera' });
  camera.addBinding(settings, 'cameraMode', { label: 'focus', options: FOCUS_OPTIONS });
  for (const [title, snap] of SNAP_VIEWS) camera.addButton({ title }).on('click', () => view.snapCamera(snap));

  const space = pane.addFolder({ title: 'Space (3D)' });
  setTitle(
    space.addBinding(settings, 'planeMode', { label: 'plane', options: PLANE_OPTIONS }),
    'The reference plane for the grid, drop lines and shadows. "Perpendicular to L" is the system\'s natural plane ' +
      '(the plane through the center of mass perpendicular to the angular momentum, which never moves). ' +
      'It falls back to z = 0 when the angular momentum is about zero.',
  );
  space.addBinding(settings, 'showGrid', { label: 'floor grid' });
  space.addBinding(settings, 'showWalls', { label: 'back walls' });
  setTitle(
    space.addBinding(settings, 'showDropLines', { label: 'drop lines' }),
    "A line from each body to the plane: its length is the body's height above it.",
  );
  space.addBinding(settings, 'showShadows', { label: 'shadows' });
  space.addBinding(settings, 'showAxes', { label: 'axes' });
  setTitle(
    space.addBinding(settings, 'showVelocity', { label: 'velocity arrows' }),
    'Arrow lengths are logarithmic: a body ten times faster than the typical one is not drawn ten times as long.',
  );
  setTitle(
    space.addBinding(settings, 'showAcceleration', { label: 'accel. arrows' }),
    'The pull on each body from the other two. Logarithmic lengths, like the velocity arrows.',
  );

  const trails = pane.addFolder({ title: 'Trails' });
  trails.addBinding(settings, 'showTrails', { label: 'show' });
  trails
    .addBinding(settings, 'trailLength', { label: 'length', min: 200, max: 20000, step: 100 })
    // Resizing reallocates, so wait for the end of a drag.
    .on('change', (event) => {
      if (event.last) view.setTrailLength(event.value);
    });
  trails.addBinding(settings, 'trailFade', { label: 'fade', min: 0, max: 6, step: 0.1 });
  setTitle(
    trails.addBinding(settings, 'trailFrame', { label: 'frame', options: { 'Follows focus': 'focus', World: 'world' } }),
    'Following a body, its trail is a point and the others trace their orbits about it. Changing the frame clears the trails.',
  );
  trails.addButton({ title: 'Clear trails' }).on('click', () => view.clearTrails());

  const display = pane.addFolder({ title: 'Display' });
  setTitle(
    display.addBinding(settings, 'bodyScale', { label: 'body size', min: 0.25, max: 8, step: 0.05 }),
    'Displayed radius is proportional to m^(1/3), with a minimum size in pixels. It is not a physical radius.',
  );
}

function addPerformanceFolder(pane: FolderApi, controller: Controller, view: SceneView): void {
  const perf = pane.addFolder({ title: 'Performance', expanded: false });
  const watch = (target: object, key: string, label: string, digits: number): void => {
    perf.addBinding(target, key, { label, readonly: true, interval: REFRESH_MS, format: fixed(digits) });
  };
  perf.addBinding(view.stats, 'fps', { readonly: true, interval: REFRESH_MS, view: 'graph', min: 0, max: 144 });
  watch(view.stats, 'frameMs', 'frame ms', 1);
  watch(view.stats, 'renderMs', 'render ms', 2);
  watch(controller.loop.stats, 'simMs', 'sim ms', 2);
  watch(controller.loop.stats, 'stepsPerSec', 'steps / s', 0);
  watch(controller.loop.stats, 'forceEvalsPerSec', 'evals / s', 0);
  watch(controller.loop.stats, 'achieved', 'speed kept', 2);
}
