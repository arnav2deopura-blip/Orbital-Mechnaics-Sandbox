import { routhRatio } from '../presets/generators';
import { instantiate } from '../presets/schema';
import type { ParamValues, Preset } from '../presets/schema';
import { angularMomentumError, characteristicTime, energyError, momentumError, systemSize } from '../sim/diagnostics';
import { hasEscaped } from '../sim/events';
import type { IntegratorId } from '../sim/integrators/types';
import { DEFAULT_SAMPLES_PER_PERIOD, Sampler } from '../sim/sampler';
import { Simulation } from '../sim/simulation';
import { snapshot } from '../sim/state';
import { nudge as nudgeState, rotateState } from '../sim/transforms';
import type { Axis, Nudge } from '../sim/transforms';
import type { SystemState } from '../sim/types';
import type { CameraMode } from '../render/scene';
import { SimLoop } from './loop';

// Wiring (plan §2): UI -> controller -> Simulation, then Simulation -> read-only snapshot ->
// render. The UI and every edit go through here, and the view is never handed the Simulation.

/** What the controller needs of the 3D view. SceneView provides all of it. */
export interface ViewPort {
  setSystemScale(size: number): void;
  setCameraMode(mode: CameraMode): void;
  recordSample(s: SystemState): void;
  clearTrails(): void;
  start(frame: (dtSeconds: number) => SystemState): void;
}

/** Plain values for the panel's readouts, refreshed about ten times a second. */
export interface Readout {
  t: number;
  energyError: number;
  angularMomentumError: number;
  momentumError: number;
  minSeparation: number;
  /** 27 (m1 m2 + m2 m3 + m3 m1) / M^2: Lagrange's equilateral solution is stable below 1 (plan §7.1). */
  routh: number;
  /** The step size the integrator will try next. */
  dt: number;
  steps: number;
  forceEvals: number;
  status: string;
}

/** One body as the editor shows it: plain numbers, with positions and velocities as xyz triples. */
export interface BodyDraft {
  m: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
}

const READOUT_SECONDS = 0.1;
/** A body has escaped (plan §7.5) beyond this many times the size the system had when loaded. */
const ESCAPE_SIZES = 20;
/** Below this fraction of the requested speed, the status says so. */
const LAG_NOTICE = 0.95;

export interface LoadPresetOptions {
  /** Values for the preset's parameters. The rest take their defaults. */
  params?: ParamValues;
  /**
   * Moves the system this far from the origin along (1, 0.5, 0.25) and skips the COM shift.
   * A dev check for the floating origin (plan §7.6): the picture must look the same.
   */
  offset?: number;
}

export class Controller {
  readonly sim: Simulation;
  readonly loop: SimLoop;
  /** The diagnostic history behind the charts. Restarted by every load, reset and edit. */
  readonly sampler = new Sampler();
  readonly readout: Readout = {
    t: 0,
    energyError: 0,
    angularMomentumError: 0,
    momentumError: 0,
    minSeparation: 0,
    routh: 0,
    dt: 0,
    steps: 0,
    forceEvals: 0,
    status: '',
  };
  /** The preset last loaded, and the values of its parameters. The panel's sliders edit `params`; applyParams() reloads. */
  preset: Preset;
  readonly params: ParamValues = {};
  /**
   * The body editor's buffer (plan §7.1). It is filled from the simulation whenever the system is
   * loaded, reset or edited, and by readDraft(); applyDraft() sends it back.
   */
  readonly draft: BodyDraft[] = [0, 1, 2].map(() => ({
    m: 0,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
  }));

  private readonly view: ViewPort;
  private sinceReadout = 0;
  private samplesPerPeriod = DEFAULT_SAMPLES_PER_PERIOD;

  constructor(view: ViewPort, preset: Preset, options: LoadPresetOptions = {}, clock?: () => number) {
    this.view = view;
    this.preset = preset;
    // loadPreset() below sets the real dt and loads the real state; this one only has to be valid.
    this.sim = new Simulation(instantiate(preset).state, { integrator: preset.recommended.integrator, params: { dt: 1 }, clock });
    this.loop = new SimLoop(this.sim, {}, clock);
    this.sim.onStep = (s) => {
      view.recordSample(s);
      this.sampler.record(this.sim);
    };
    this.sim.onEvent = (message) => this.sampler.mark(message);
    this.loadPreset(preset, options);
  }

  /** Hands the frame loop to the view. */
  start(): void {
    this.view.start((dt) => this.frame(dt));
  }

  /**
   * Loads a preset with its recommended settings (plan §8.1): running, forward, trails cleared,
   * the camera following what the preset says and framed on the system.
   */
  loadPreset(preset: Preset, { offset = 0, params }: LoadPresetOptions = {}): void {
    const { sim } = this;
    const recommended = preset.recommended;
    const instance = instantiate(preset, params);
    const initial = instance.state;
    if (offset !== 0) {
      for (let i = 0; i < 3; i++) {
        initial.x[3 * i] += offset;
        initial.x[3 * i + 1] += offset * 0.5;
        initial.x[3 * i + 2] += offset * 0.25;
      }
    }

    // Settings first: loading restarts the integrator, which reads them.
    const period = instance.period ?? characteristicTime(initial);
    sim.params.dt = instance.dt ?? recommended.dt ?? period / (recommended.integrator === 'ias15' ? 100 : 1000);
    sim.params.epsTol = recommended.epsTol;
    sim.params.dtMin = undefined;
    sim.params.dtMax = undefined;
    sim.params.centralBody = recommended.centralBody;
    sim.encounterRadius = 0; // a distance chosen for another system means nothing here

    sim.load(initial, { period: instance.period, recenter: offset === 0 });
    if (sim.integrator.id !== recommended.integrator) sim.setIntegrator(recommended.integrator);
    sim.setDirection(1);

    this.preset = preset;
    for (const key of Object.keys(this.params)) delete this.params[key];
    Object.assign(this.params, instance.params); // in place: the panel's sliders are bound to this object
    this.loop.settings.speed = recommended.speed ?? period / 8;
    this.loop.settings.running = true;
    this.view.clearTrails();
    this.view.setCameraMode(recommended.camera?.focus ?? 'com');
    this.view.setSystemScale(instance.size ?? recommended.camera?.size ?? systemSize(sim.state));
    this.readDraft();
    this.restartHistory();
    this.updateReadout();
  }

  /** Reloads the current preset with the values now in `params`: the sliders' apply. */
  applyParams(): void {
    this.loadPreset(this.preset, { params: this.params });
  }

  play(): void {
    this.loop.settings.running = true;
  }

  pause(): void {
    this.loop.settings.running = false;
  }

  /** Pauses and takes one step. */
  step(): void {
    this.loop.stepOnce();
  }

  /** Back to the state of the last load or edit. Running or paused stays as it was. */
  reset(): void {
    this.sim.reset();
    this.view.clearTrails();
    this.readDraft();
    this.restartHistory();
    this.updateReadout();
  }

  setSpeed(speed: number): void {
    this.loop.settings.speed = speed;
  }

  setDirection(sign: 1 | -1): void {
    if (sign !== this.sim.direction) this.sampler.mark(sign < 0 ? 'time reversed' : 'time forward');
    this.sim.setDirection(sign);
  }

  /**
   * The one path for editing the system (plan §4.7): pause (unless told not to), apply, re-center
   * on the COM unless told not to, take new reference values, clear the trails and restart the
   * integrator. `next` is normally a snapshot of sim.state with some fields changed.
   */
  edit(next: SystemState, recenter = true, pause = true): void {
    if (pause) this.pause();
    this.sim.load(next, { recenter });
    this.view.clearTrails();
    this.readDraft();
    this.restartHistory();
    this.updateReadout();
  }

  /** Fills the body editor's buffer from the current state. */
  readDraft(): void {
    const { x, v, m } = this.sim.state;
    this.draft.forEach((body, i) => {
      body.m = m[i];
      [body.pos.x, body.pos.y, body.pos.z] = [x[3 * i], x[3 * i + 1], x[3 * i + 2]];
      [body.vel.x, body.vel.y, body.vel.z] = [v[3 * i], v[3 * i + 1], v[3 * i + 2]];
    });
  }

  /** Applies the body editor's buffer: masses, positions and velocities, z included. Pauses. */
  applyDraft(recenter = true): void {
    const next = snapshot(this.sim.state);
    this.draft.forEach((body, i) => {
      next.m[i] = Math.max(0, body.m);
      next.x.set([body.pos.x, body.pos.y, body.pos.z], 3 * i);
      next.v.set([body.vel.x, body.vel.y, body.vel.z], 3 * i);
    });
    this.edit(next, recenter);
  }

  /**
   * Turns the whole system about an axis (plan §7.1). It is a symmetry of the physics, so only
   * the plane of the motion changes. Keeps running.
   */
  rotate(axis: Axis, degrees: number): void {
    const next = snapshot(this.sim.state);
    rotateState(next, axis, degrees);
    this.edit(next, false, false);
  }

  /** Nudges one body (plan §7.2), re-centering afterwards if asked, and keeps running. Returns the direction used. */
  nudge(spec: Nudge, recenter = false): [number, number, number] {
    const next = snapshot(this.sim.state);
    const direction = nudgeState(next, spec);
    this.edit(next, recenter, false);
    return direction;
  }

  /**
   * Switches method, continuing from the current state (plan §4.7). WH has no softening, so
   * choosing it removes any.
   */
  setIntegrator(id: IntegratorId, symplecticEuler = false): void {
    if (id === 'wh' && this.sim.state.eps2 !== 0) this.setSoftening(0);
    this.sim.setIntegrator(id, symplecticEuler);
    this.sampler.mark(id === 'euler' && symplecticEuler ? 'symplectic Euler' : id);
    this.updateReadout();
  }

  /** The step size of the fixed-step methods, and the first guess of IAS15. Takes effect on the next step. */
  setDt(dt: number): void {
    this.sim.params.dt = dt;
  }

  /** WH only: the body the others orbit (undefined: the most massive). Restarts WH, which orders the bodies once. */
  setCentralBody(body: 0 | 1 | 2 | undefined): void {
    this.sim.params.centralBody = body;
    if (this.sim.integrator.id === 'wh') this.setIntegrator('wh');
  }

  /**
   * Close encounters (plan §7.5): note when two bodies come within `radius` (0 turns it off), and
   * stop the run there if `stop`. This is also the "collision radius": bodies never merge.
   */
  setEncounter(radius: number, stop: boolean): void {
    this.sim.encounterRadius = Math.max(0, radius);
    this.sim.stopOnEncounter = stop;
  }

  /** Changes G. The energy changes with it, so the reference values restart; running and paused are unchanged. */
  setG(G: number): void {
    const next = snapshot(this.sim.state);
    next.G = G;
    this.edit(next, false, false);
  }

  /** The softening length (plan §3.1). Ignored by WH, which has no softening. */
  setSoftening(length: number): void {
    if (this.sim.integrator.id === 'wh') return;
    const next = snapshot(this.sim.state);
    next.eps2 = length * length;
    this.edit(next, false, false);
  }

  /** How many samples the charts take per T_char. Applies from the next sample; the history is kept. */
  setSamplesPerPeriod(count: number): void {
    this.samplesPerPeriod = Math.max(10, count);
    this.sampler.interval = this.sim.reference.period / this.samplesPerPeriod;
  }

  /** Empties the charts and takes the first sample, at the current state. */
  restartHistory(): void {
    this.sampler.clear(this.sim.reference.period, this.samplesPerPeriod);
    this.sampler.record(this.sim);
  }

  private frame(dtSeconds: number): SystemState {
    const rendered = this.loop.frame(dtSeconds);
    this.sinceReadout += dtSeconds;
    if (this.sinceReadout >= READOUT_SECONDS) this.updateReadout();
    return rendered;
  }

  private updateReadout(): void {
    this.sinceReadout = 0;
    const { sim, readout } = this;
    const d = sim.refreshDiagnostics();
    readout.t = sim.state.t;
    readout.energyError = energyError(d, sim.reference);
    readout.angularMomentumError = angularMomentumError(d, sim.reference);
    readout.momentumError = momentumError(d, sim.reference);
    readout.minSeparation = d.minSeparation;
    readout.routh = routhRatio(sim.state.m[0], sim.state.m[1], sim.state.m[2]);
    readout.dt = sim.currentDt();
    readout.steps = sim.counters.stepCount;
    readout.forceEvals = sim.counters.forceEvals;
    readout.status = this.status();
  }

  private status(): string {
    const { sim } = this;
    if (sim.failure !== null) return sim.failure;
    let status = 'paused';
    if (this.loop.settings.running) {
      const achieved = this.loop.stats.achieved;
      status = achieved < LAG_NOTICE ? `running at ${Math.round(100 * achieved)}% of requested speed` : 'running';
    }
    if (sim.encounter !== null) status += `; ${sim.encounter}`;
    if (sim.warning !== null) status += `; ${sim.warning}`;
    for (let k = 0; k < 3; k++) {
      if (hasEscaped(sim.state, k, ESCAPE_SIZES * sim.reference.size)) status += `; body ${k + 1} has escaped`;
    }
    return status;
  }
}
