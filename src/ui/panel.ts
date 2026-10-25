import type { BindingApi, BladeApi, FolderApi } from '@tweakpane/core';
import { Pane } from 'tweakpane';
import type { Controller } from '../app/controller';
import { equalizedDt } from '../app/comparison';
import { BatchClient } from '../app/batch';
import type { RunningJob } from '../app/batch';
import { captureState, shareUrl } from '../app/urlState';
import { findPreset, PRESETS } from '../presets';
import type { PlaneMode, SnapView } from '../render/frame';
import type { CameraMode, SceneView } from '../render/scene';
import { createIntegrator } from '../sim/integrators';
import { cardFor, cardText } from './infoCards';
import type { IntegratorId } from '../sim/integrators/types';
import { SERIES } from '../sim/sampler';
import type { Axis, NudgeDirection } from '../sim/transforms';
import { Cancelled, geometricSeries } from '../sim/batch';
import type { SweepResult } from '../sim/batch';
import { snapshot } from '../sim/state';
import type { BatchView, SweepEntry } from './batchView';
import { downloadText } from './charts';
import type { Charts } from './charts';

// The panel code is written against the part of the container API that panes, folders and tab pages share.
type Container = Pick<FolderApi, 'addFolder' | 'addBinding' | 'addButton'>;

const FOCUS_OPTIONS: Record<string, CameraMode> = {
  'Free orbit': 'free',
  'Center of mass': 'com',
  'Co-rotating (about z)': 'corotating',
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

/**
 * The panel re-reads its controls this often, since the simulation can pause itself. Tweakpane
 * answers a changed value by writing it back through the binding, so a setter on an object bound
 * here must do nothing when it is given the value it already has: otherwise every programmatic
 * change would be applied a second time (restarting an integrator, or re-baselining the errors).
 */
const REFRESH_MS = 250;

const scientific = (value: number): string => (Number.isFinite(value) ? value.toExponential(2) : '-');
const fixed = (digits: number) => (value: number): string => value.toFixed(digits);

/**
 * The control panel: preset, simulation, diagnostics, body editor, perturbation, then the view
 * controls (plan §7.1, §7.2, §7.6, §7.7). Everything that changes the system goes through the
 * Controller. The view bindings edit view.settings directly, which SceneView reads every frame;
 * only changes that need work (a new trail length) call into the view.
 */
export function createControlPanel(controller: Controller, view: SceneView, charts: Charts, batch: BatchView, container?: HTMLElement): Pane {
  const pane = new Pane({ title: 'Three-body sandbox', container });
  const syncs: (() => void)[] = [];
  // Four tabs keep the panel from running off the screen: what to run, what to change, how to see it, and the numbers.
  const [run, bodies, look, data] = pane.addTab({ pages: [{ title: 'Run' }, { title: 'Bodies' }, { title: 'View' }, { title: 'Data' }] }).pages;
  addPresetFolder(run, controller, view);
  addSimulationFolders(run, data, controller, syncs);
  addBodiesFolder(bodies, controller);
  addPerturbFolder(bodies, controller);
  addCompareFolder(bodies, controller, syncs);
  addViewFolders(look, view);
  addChartsFolder(data, controller, charts);
  addBatchFolder(data, controller, batch);
  addPerformanceFolder(data, controller, view);
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

function addPresetFolder(pane: Container, controller: Controller, view: SceneView): void {
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
        const { demonstrates, verified, verifiedBy } = controller.preset;
        return `${demonstrates}\n\n${verified ? `Checked by a test: ${verifiedBy ?? 'behaves as described'}.` : 'Not independently checked yet.'}`;
      },
    },
    'about',
    { label: '', readonly: true, multiline: true, rows: 4 },
  );
  rebuild();

  // A link that restores the run (plan §7.8).
  const link = { message: '' };
  const share = folder.addButton({ title: 'Copy link to this run' });
  share.on('click', () => {
    const url = shareUrl(captureState(controller, view), location.href);
    history.replaceState(null, '', url);
    navigator.clipboard?.writeText(url).then(
      () => (link.message = 'link copied'),
      () => (link.message = 'link is in the address bar'),
    );
    if (!navigator.clipboard) link.message = 'link is in the address bar';
  });
  setButtonHint(share, 'Puts a link in the address bar and on the clipboard that restores the preset, its parameters, the method and settings, any edited bodies (z included) and the view.');
  folder.addBinding(link, 'message', { label: '', readonly: true, interval: REFRESH_MS });
  folder.addButton({ title: 'Learn: how it all works' }).on('click', () => window.open('learn.html', '_blank', 'noopener'));
}

function addSimulationFolders(pane: Container, dataPane: Container, controller: Controller, syncs: (() => void)[]): void {
  const { sim, loop } = controller;
  const run = pane.addFolder({ title: 'Simulation' });
  run.addBinding(loop.settings, 'running', { label: 'run' });
  run.addButton({ title: 'Step' }).on('click', () => controller.step());
  run.addButton({ title: 'Reset' }).on('click', () => controller.reset());
  const back = run.addButton({ title: 'Return to start' });
  back.on('click', () => controller.returnToStart());
  setButtonHint(back, 'Runs backward to where it began and reports how far the state is from the start. Leapfrog and Wisdom-Holman retrace to roundoff; Euler does not.');

  // Speed is in periods per second, so one slider suits every system. Log scale: the slider
  // holds the exponent. The range must cover every speed a preset recommends: a slider clamps
  // what it shows, and writes the clamped value back. It has no step either, which would round
  // the exponent (a recommended 0.25 would come back as 0.252).
  const speed = {
    get periodsPerSecond(): number {
      return Math.log10(loop.settings.speed / sim.reference.period);
    },
    set periodsPerSecond(exponent: number) {
      if (exponent !== this.periodsPerSecond) controller.setSpeed(10 ** exponent * sim.reference.period);
    },
  };
  setTitle(
    run.addBinding(speed, 'periodsPerSecond', {
      label: 'periods / s',
      min: -4,
      max: 3,
      format: (exponent: number) => (10 ** exponent).toPrecision(2),
    }),
    'Simulated time per real second, in periods of the system (T_char). Log scale.',
  );

  const direction = {
    get dir(): number {
      return sim.direction;
    },
    set dir(sign: number) {
      if (sign !== this.dir) controller.setDirection(sign < 0 ? -1 : 1);
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
      if (choice === this.id) return;
      if (choice === 'symplectic-euler') controller.setIntegrator('euler', true);
      else controller.setIntegrator(choice as IntegratorId);
    },
  };
  method.addBinding(integrator, 'id', { label: 'integrator', options: INTEGRATOR_OPTIONS });

  // What the chosen method is, from the same text as the Learn page.
  const about = {
    get text(): string {
      const card = cardFor(integrator.id);
      return card ? cardText(card) : '';
    },
  };
  const aboutBinding = method.addBinding(about, 'text', { label: '', readonly: true, multiline: true, rows: 7 });
  setTitle(aboutBinding, 'From the Learn page.');
  const learn = method.addButton({ title: 'Learn about this method' });
  learn.on('click', () => {
    const card = cardFor(integrator.id);
    if (card) window.open(card.learnHref, '_blank', 'noopener');
  });

  // Step size, as a power of ten of T_char: the slider's exponent, shown as "T_char / N".
  const stepSize = {
    get exponent(): number {
      return Math.log10(sim.params.dt / sim.reference.period);
    },
    set exponent(exponent: number) {
      if (Math.abs(exponent - this.exponent) > 1e-9) controller.setDt(10 ** exponent * sim.reference.period);
    },
  };
  const dt = method.addBinding(stepSize, 'exponent', {
    label: 'dt',
    min: -5.5,
    max: -0.5,
    format: (exponent: number) => `T/${Math.round(10 ** -exponent)}`,
  });
  setTitle(dt, 'Step size as a fraction of T_char, the shortest orbital period. For IAS15 this is only the first guess.');

  const central = {
    get body(): number {
      return sim.params.centralBody ?? -1;
    },
    set body(value: number) {
      if (value !== this.body) controller.setCentralBody(value < 0 ? undefined : (value as 0 | 1 | 2));
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
      if (value !== this.exp) ias.epsTol = 10 ** value;
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
      if (value !== this.exp) ias[key] = value === off ? undefined : 10 ** value * sim.reference.period;
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
      if (value > 0 && value !== sim.state.G) controller.setG(value);
    },
    get softening(): number {
      return Math.sqrt(sim.state.eps2);
    },
    set softening(value: number) {
      if (value >= 0 && value !== this.softening) controller.setSoftening(value);
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

  const info = dataPane.addFolder({ title: 'Diagnostics' });
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
  watch('divergence', 'divergence', scientific, 'Comparison mode: the largest distance between a body and its twin.');
  watch('returnDistance', 'return dist.', scientific, 'After "Return to start": the phase-space distance from the initial state.');
  watch('dt', 'dt', scientific);
  watch('steps', 'steps', fixed(0));
  watch('forceEvals', 'force evals', fixed(0));
}

function addCompareFolder(pane: Container, controller: Controller, syncs: (() => void)[]): void {
  const { sim } = controller;
  const folder = pane.addFolder({ title: 'Compare', expanded: false });
  const setup = {
    kind: 'twin',
    body: 2,
    target: 'position',
    direction: 'normal',
    exponent: -9,
    integrator: 'rk4',
    dtExponent: -3,
    equalize: true,
    message: '',
  };

  setTitle(
    folder.addBinding(setup, 'kind', {
      label: 'compare',
      options: { 'Ghost twin (nudged)': 'twin', 'Another method': 'method' },
    }),
    'A twin is the same method with a tiny nudge to one body: in a chaotic system it separates exponentially. Another method runs a different integrator on the identical start.',
  );
  const twinBindings = [
    folder.addBinding(setup, 'body', { label: 'nudge body', options: BODY_OPTIONS }),
    folder.addBinding(setup, 'target', { label: 'nudge its', options: { position: 'position', velocity: 'velocity' } }),
    folder.addBinding(setup, 'direction', {
      label: 'direction',
      options: { 'Out of plane (L)': 'normal', z: 'z', x: 'x', y: 'y', Random: 'random' },
    }),
    folder.addBinding(setup, 'exponent', {
      label: 'size',
      min: -14,
      max: -2,
      step: 0.1,
      format: (value: number) => (10 ** value).toExponential(0),
    }),
  ];
  const methodBindings = [
    folder.addBinding(setup, 'integrator', { label: 'other method', options: INTEGRATOR_OPTIONS }),
    folder.addBinding(setup, 'equalize', { label: 'equalize cost' }),
    folder.addBinding(setup, 'dtExponent', {
      label: 'its dt',
      min: -5.5,
      max: -0.5,
      format: (exponent: number) => `T/${Math.round(10 ** -exponent)}`,
    }),
  ];
  setTitle(
    methodBindings[1],
    'Choose its step so it makes as many force evaluations per unit time as the first run: RK4 takes 4 per step, so it gets 4 times the step. Without this RK4 looks unfairly good. Not for IAS15.',
  );

  const start = folder.addButton({ title: 'Start comparison' });
  start.on('click', () => {
    const symplectic = setup.integrator === 'symplectic-euler';
    const id = (symplectic ? 'euler' : setup.integrator) as IntegratorId;
    let dt = 10 ** setup.dtExponent * sim.reference.period;
    if (setup.equalize) dt = equalizedDt(sim.params.dt, sim.integrator, createIntegrator(id, symplectic)) ?? dt;
    const error = controller.startComparison(
      setup.kind === 'twin'
        ? {
            kind: 'twin',
            nudge: {
              body: setup.body,
              target: setup.target as 'position' | 'velocity',
              direction: setup.direction as NudgeDirection,
              size: 10 ** setup.exponent,
            },
          }
        : { kind: 'method', integrator: id, symplecticEuler: symplectic, dt },
    );
    setup.message = error ?? '';
  });
  folder.addButton({ title: 'Stop comparison' }).on('click', () => controller.stopComparison());
  folder.addBinding(setup, 'message', { label: '', readonly: true, interval: REFRESH_MS });

  syncs.push(() => {
    for (const binding of twinBindings) binding.hidden = setup.kind !== 'twin';
    for (const binding of methodBindings) binding.hidden = setup.kind !== 'method';
    methodBindings[2].hidden = setup.kind !== 'method' || setup.equalize;
  });
}

function addChartsFolder(pane: Container, controller: Controller, charts: Charts): void {
  const folder = pane.addFolder({ title: 'Charts', expanded: false });
  folder.addBinding(charts.settings, 'visible', { label: 'show charts' });
  for (const spec of SERIES) setTitle(folder.addBinding(charts.settings.show, spec.key, { label: shortLabel(spec.key) }), spec.hint);

  const rate = {
    get perPeriod(): number {
      return Math.round(controller.sim.reference.period / controller.sampler.interval);
    },
    set perPeriod(count: number) {
      if (count !== this.perPeriod) controller.setSamplesPerPeriod(count);
    },
  };
  setTitle(
    folder.addBinding(rate, 'perPeriod', { label: 'samples / T', min: 20, max: 2000, step: 10 }),
    'How many points each chart takes per T_char of simulated time. Applies from now on.',
  );
  folder.addButton({ title: 'Clear history' }).on('click', () => controller.restartHistory());
  folder.addButton({ title: 'Download CSV' }).on('click', () => downloadText('three-body-diagnostics.csv', controller.sampler.toCsv()));
  const trajectory = folder.addButton({ title: 'Download trajectory' });
  trajectory.on('click', () => downloadText('three-body-trajectory.csv', controller.sampler.toTrajectoryCsv()));
  setButtonHint(trajectory, 'The positions of the three bodies at each chart sample, as CSV.');
}

/** The methods a sweep compares, with the step range each is tried over (as fractions of T_char) and the order it should show. */
const SWEEP_METHODS = [
  { id: 'euler', symplectic: false, label: 'Euler', expected: 1, from: 1 / 6400, to: 1 / 204800, color: '#ff8787' },
  { id: 'euler', symplectic: true, label: 'Symplectic Euler', expected: 1, from: 1 / 6400, to: 1 / 204800, color: '#ffa94d' },
  { id: 'leapfrog', symplectic: false, label: 'Leapfrog', expected: 2, from: 1 / 100, to: 1 / 1600, color: '#69db7c' },
  { id: 'rk4', symplectic: false, label: 'RK4', expected: 4, from: 1 / 100, to: 1 / 600, color: '#4dabf7' },
  { id: 'wh', symplectic: false, label: 'Wisdom-Holman', expected: 2, from: 1 / 100, to: 1 / 1600, color: '#b197fc' },
] as const;

function addBatchFolder(pane: Container, controller: Controller, view: BatchView): void {
  const { sim } = controller;
  const folder = pane.addFolder({ title: 'Batch jobs', expanded: false });
  // 1.3 periods, not 1: the end of the run then falls away from a symmetric point of the orbit, where symplectic Euler
  // would show order 2 instead of its true 1 (it is second order from pericenter after a whole number of periods).
  const setup = { sweepPeriods: 1.3, fastForwardPeriods: 100, lyapunovPeriods: 20, status: 'idle' };
  let client: BatchClient | null = null;
  let running: RunningJob<unknown> | null = null;

  /** Runs one job at a time, reporting on the status line; cancelled or failed jobs say so. */
  const launch = async (name: string, work: (batch: BatchClient, progress: (label: string) => (f: number) => void) => Promise<void>): Promise<void> => {
    if (running) {
      setup.status = 'a job is already running';
      return;
    }
    client ??= new BatchClient();
    const progress = (label: string) => (f: number) => (setup.status = `${label}: ${Math.round(100 * f)}%`);
    running = { result: Promise.resolve(), cancel: () => {} };
    try {
      await work(client, progress);
      setup.status = `${name}: done`;
    } catch (error) {
      setup.status = error instanceof Cancelled ? `${name}: cancelled` : `${name} failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      running = null;
    }
  };
  /** Starts a job and makes the Cancel button cancel it. */
  const track = <R>(job: RunningJob<R>): Promise<R> => {
    running = job as RunningJob<unknown>;
    return job.result;
  };

  const sweep = folder.addButton({ title: 'Convergence and work-precision sweep' });
  sweep.on('click', () =>
    void launch('sweep', async (batch, progress) => {
      const state = sim.baselineSnapshot();
      const period = sim.reference.period;
      const duration = setup.sweepPeriods * period;
      const entries: SweepEntry[] = [];
      const methods = SWEEP_METHODS.filter((m) => m.id !== 'wh' || state.eps2 === 0);
      for (const m of methods) {
        const result: SweepResult = await track(
          batch.sweep(
            {
              state,
              integrator: m.id,
              symplecticEuler: m.symplectic,
              centralBody: sim.params.centralBody,
              duration,
              values: geometricSeries(period * m.from, period * m.to, 8),
            },
            progress(m.label),
          ),
        );
        entries.push({ label: m.label, color: m.color, expected: m.expected, result });
      }
      entries.push({
        label: 'IAS15 (tolerance 1e-4 to 1e-10)',
        color: '#f783ac',
        expected: null,
        result: await track(batch.sweep({ state, integrator: 'ias15', duration, values: [1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10] }, progress('IAS15'))),
      });
      view.showSweep(entries, `Sweep over ${setup.sweepPeriods} period${setup.sweepPeriods === 1 ? '' : 's'} (T_char = ${period.toPrecision(4)}), from the baseline state`);
    }),
  );
  setButtonHint(sweep, 'Runs each method over a range of step sizes from the starting state and plots its error against step and against cost. The slope of the first plot is the order: 1, 2, 4 and 2 (Wisdom-Holman on a hierarchical system).');
  folder.addBinding(setup, 'sweepPeriods', { label: 'sweep (periods)', min: 0.25, max: 10, step: 0.05 });

  const forward = folder.addButton({ title: 'Fast-forward' });
  forward.on('click', () =>
    void launch('fast-forward', async (batch, progress) => {
      const period = sim.reference.period;
      const integrator = sim.integrator;
      const result = await track(
        batch.fastForward(
          {
            state: snapshot(sim.state),
            integrator: integrator.id,
            symplecticEuler: integrator.id === 'euler' && integrator.symplectic,
            centralBody: sim.params.centralBody,
            dt: sim.params.dt,
            epsTol: sim.params.epsTol,
            duration: setup.fastForwardPeriods * period,
            period,
          },
          progress('fast-forward'),
        ),
      );
      const summary = `${setup.fastForwardPeriods} periods with ${integrator.id}: ${result.steps} steps, ${result.forceEvals} force evaluations, reached t = ${result.final.t.toPrecision(5)}.`;
      view.showFastForward(result, summary, () => {
        const next = snapshot(sim.state);
        next.t = result.final.t;
        next.x.set(result.final.x);
        next.v.set(result.final.v);
        controller.edit(next, false);
      });
    }),
  );
  setButtonHint(forward, 'Runs the current system ahead, with the current method and step, without drawing it, and plots what happened. "Continue" then loads the final state.');
  folder.addBinding(setup, 'fastForwardPeriods', { label: 'periods', min: 1, max: 5000, step: 1 });

  const lyap = folder.addButton({ title: 'Lyapunov estimate' });
  lyap.on('click', () =>
    void launch('Lyapunov estimate', async (batch, progress) => {
      const period = sim.reference.period;
      const result = await track(batch.lyapunov({ state: snapshot(sim.state), duration: setup.lyapunovPeriods * period, period }, progress('Lyapunov')));
      view.showLyapunov(result);
    }),
  );
  setButtonHint(lyap, 'Follows a shadow copy offset by 1e-8, renormalizing every so often (the Benettin method), and plots the running estimate of the largest Lyapunov exponent.');
  folder.addBinding(setup, 'lyapunovPeriods', { label: 'duration (periods)', min: 1, max: 500, step: 1 });

  folder.addButton({ title: 'Cancel' }).on('click', () => running?.cancel());
  folder.addBinding(setup, 'status', { label: '', readonly: true, interval: REFRESH_MS });
}

const SHORT_LABELS: Record<string, string> = {
  energyError: 'energy error',
  angularMomentumError: 'L error',
  momentumError: '|P| error',
  comDrift: 'COM drift',
  minSeparation: 'closest pair',
  dt: 'step size',
  forceEvals: 'force evals',
  analyticError: 'vs exact Kepler',
};
const shortLabel = (key: string): string => SHORT_LABELS[key] ?? key;

function addBodiesFolder(pane: Container, controller: Controller): void {
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
  button.element.setAttribute('title', text);
}

function addPerturbFolder(pane: Container, controller: Controller): void {
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

function addViewFolders(pane: Container, view: SceneView): void {
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
    space.addBinding(settings, 'orthographic', { label: 'orthographic' }),
    'A very narrow field of view, which looks orthographic: parallel lines stay parallel and size does not change with depth. Good for reading heights off a front or side view.',
  );
  setTitle(
    space.addBinding(settings, 'tintTrails', { label: 'tint trails by z' }),
    'Trails shift toward pink above the reference plane and toward blue below it.',
  );
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

function addPerformanceFolder(pane: Container, controller: Controller, view: SceneView): void {
  const perf = pane.addFolder({ title: 'Performance', expanded: false });
  const watch = (target: object, key: string, label: string, digits: number): void => {
    perf.addBinding(target as Record<string, number>, key, { label, readonly: true, interval: REFRESH_MS, format: fixed(digits) });
  };
  setTitle(
    perf.addBinding(view.settings, 'autoQuality', { label: 'auto quality' }),
    'When frames stay slow, lower the pixel ratio and then shorten the trails, and say so below.',
  );
  perf.addBinding(view.stats, 'quality', { label: 'quality', readonly: true, interval: REFRESH_MS });
  perf.addBinding(view.stats, 'fps', { readonly: true, interval: REFRESH_MS, view: 'graph', min: 0, max: 144 });
  watch(view.stats, 'frameMs', 'frame ms', 1);
  watch(view.stats, 'renderMs', 'render ms', 2);
  watch(controller.loop.stats, 'simMs', 'sim ms', 2);
  watch(controller.loop.stats, 'stepsPerSec', 'steps / s', 0);
  watch(controller.loop.stats, 'forceEvalsPerSec', 'evals / s', 0);
  watch(controller.loop.stats, 'achieved', 'speed kept', 2);
}
