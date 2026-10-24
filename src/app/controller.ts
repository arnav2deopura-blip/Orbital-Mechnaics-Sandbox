import type { Preset } from '../presets/schema';
import { presetState } from '../presets/schema';
import { angularMomentumError, characteristicTime, energyError, momentumError, systemSize } from '../sim/diagnostics';
import { Simulation } from '../sim/simulation';
import type { SystemState } from '../sim/types';
import { SimLoop } from './loop';

// Wiring (plan §2): UI -> controller -> Simulation, then Simulation -> read-only snapshot ->
// render. The UI and every edit go through here, and the view is never handed the Simulation.

/** What the controller needs of the 3D view. SceneView provides all of it. */
export interface ViewPort {
  setSystemScale(size: number): void;
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
  /** The step size the integrator will try next. */
  dt: number;
  steps: number;
  forceEvals: number;
  status: string;
}

const READOUT_SECONDS = 0.1;
/** Below this fraction of the requested speed, the status says so. */
const LAG_NOTICE = 0.95;

export interface LoadPresetOptions {
  /**
   * Moves the system this far from the origin along (1, 0.5, 0.25) and skips the COM shift.
   * A dev check for the floating origin (plan §7.6): the picture must look the same.
   */
  offset?: number;
}

export class Controller {
  readonly sim: Simulation;
  readonly loop: SimLoop;
  readonly readout: Readout = {
    t: 0,
    energyError: 0,
    angularMomentumError: 0,
    momentumError: 0,
    minSeparation: 0,
    dt: 0,
    steps: 0,
    forceEvals: 0,
    status: '',
  };
  /** The preset last loaded. */
  preset: Preset;

  private readonly view: ViewPort;
  private sinceReadout = 0;

  constructor(view: ViewPort, preset: Preset, options: LoadPresetOptions = {}, clock?: () => number) {
    this.view = view;
    this.preset = preset;
    // loadPreset() below sets the real dt and loads the real state; this one only has to be valid.
    this.sim = new Simulation(presetState(preset), { integrator: preset.recommended.integrator, params: { dt: 1 }, clock });
    this.loop = new SimLoop(this.sim, {}, clock);
    this.sim.onStep = (s) => view.recordSample(s);
    this.loadPreset(preset, options);
  }

  /** Hands the frame loop to the view. */
  start(): void {
    this.view.start((dt) => this.frame(dt));
  }

  /**
   * Loads a preset with its recommended settings (plan §8.1): running, forward, trails cleared,
   * the camera framed on the system.
   */
  loadPreset(preset: Preset, { offset = 0 }: LoadPresetOptions = {}): void {
    const { sim } = this;
    const recommended = preset.recommended;
    const initial = presetState(preset);
    if (offset !== 0) {
      for (let i = 0; i < 3; i++) {
        initial.x[3 * i] += offset;
        initial.x[3 * i + 1] += offset * 0.5;
        initial.x[3 * i + 2] += offset * 0.25;
      }
    }

    // Settings first: loading restarts the integrator, which reads them.
    const period = preset.period ?? characteristicTime(initial);
    sim.params.dt = recommended.dt ?? period / (recommended.integrator === 'ias15' ? 100 : 1000);
    sim.params.epsTol = recommended.epsTol;
    sim.params.dtMin = undefined;
    sim.params.dtMax = undefined;
    sim.params.centralBody = undefined;

    sim.load(initial, { period: preset.period, recenter: offset === 0 });
    if (sim.integrator.id !== recommended.integrator) sim.setIntegrator(recommended.integrator);
    sim.setDirection(1);

    this.preset = preset;
    this.loop.settings.speed = recommended.speed;
    this.loop.settings.running = true;
    this.view.clearTrails();
    this.view.setSystemScale(systemSize(sim.state));
    this.updateReadout();
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
    this.updateReadout();
  }

  setSpeed(speed: number): void {
    this.loop.settings.speed = speed;
  }

  setDirection(sign: 1 | -1): void {
    this.sim.setDirection(sign);
  }

  /**
   * The one path for editing the system (plan §4.7): pause, apply, re-center on the COM unless
   * told not to, take new reference values, clear the trails and restart the integrator.
   * `next` is normally a snapshot of sim.state with some fields changed.
   */
  edit(next: SystemState, recenter = true): void {
    this.pause();
    this.sim.load(next, { recenter });
    this.view.clearTrails();
    this.updateReadout();
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
    readout.dt = sim.currentDt();
    readout.steps = sim.counters.stepCount;
    readout.forceEvals = sim.counters.forceEvals;
    readout.status = this.status();
  }

  private status(): string {
    if (this.sim.failure !== null) return this.sim.failure;
    if (!this.loop.settings.running) return 'paused';
    const achieved = this.loop.stats.achieved;
    return achieved < LAG_NOTICE ? `running at ${Math.round(100 * achieved)}% of requested speed` : 'running';
  }
}
