import { DEFAULT_PRESET_ID, findPreset } from '../presets';
import { routhRatio } from '../presets/generators';
import { bodyCountOf, instantiate } from '../presets/schema';
import type { ParamValues, Preset } from '../presets/schema';
import { angularMomentumError, characteristicTime, energyError, momentumError, systemSize } from '../sim/diagnostics';
import { Cancelled } from '../sim/batch';
import { chaosOffReason, createVerdict, predictabilityHorizon } from '../sim/chaos';
import type { ChaosSpec, ChaosVerdict } from '../sim/chaos';
import { hasEscaped } from '../sim/events';
import { createIntegrator } from '../sim/integrators';
import type { IntegratorId } from '../sim/integrators/types';
import { DEFAULT_SAMPLES_PER_PERIOD, Sampler } from '../sim/sampler';
import { Simulation } from '../sim/simulation';
import { copyState, createCounters, snapshot } from '../sim/state';
import { nudge as nudgeState, rotateState, scaleToBound } from '../sim/transforms';
import type { Axis, Nudge } from '../sim/transforms';
import type { BodyCount, SystemState } from '../sim/types';
import type { CameraMode } from '../render/scene';
import type { RunningJob } from './batch';
import { Comparison } from './comparison';
import type { ComparisonOptions } from './comparison';
import { bySeverity, FAR_SIZES, preflight, runtimeIssues } from './health';
import type { ChaosInput, Fix, Issue } from './health';
import { suggestPreset } from './suggest';
import type { Suggestion } from './suggest';
import { SimLoop } from './loop';

// Wiring (plan §2): UI -> controller -> Simulation, then Simulation -> read-only snapshot ->
// render. The UI and every edit go through here, and the view is never handed the Simulation.

/** What the controller needs of the 3D view. SceneView provides all of it. */
export interface ViewPort {
  /** Milliseconds the last frame took to draw, if the view measures it: the loop's budget adapts to it. */
  stats?: { renderMs: number };
  setSystemScale(size: number): void;
  setCameraMode(mode: CameraMode): void;
  recordSample(s: SystemState): void;
  recordGhostSample(s: SystemState): void;
  setGhost(state: SystemState | null): void;
  clearTrails(): void;
  start(frame: (dtSeconds: number) => SystemState): void;
  /** Pulls the camera back until every body is in view. */
  frameAll?(s: SystemState): void;
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
  /** The distance between the first run and the comparison twin, NaN with no twin. */
  divergence: number;
  /** The phase-space distance from the start after "return to start", NaN until one has finished. */
  returnDistance: number;
  status: string;
  /** What the chaos probe has found, in a few words. */
  chaos: string;
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
/** A failed step is blamed on a close approach when two bodies were closer than this fraction of the system's size just before it. */
const CLOSE_FAILURE = 0.05;
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
  /** The comparison twin (plan §7.4), or null. Ended by every load, reset and edit. */
  comparison: Comparison | null = null;
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
    divergence: NaN,
    returnDistance: NaN,
    status: '',
    chaos: '',
  };
  /**
   * What the background chaos probe has found about the run's starting state (sim/chaos.ts). Filled
   * in a few seconds after a load or edit, by the worker `chaosProbe` hands the job to.
   */
  readonly chaos: ChaosVerdict = createVerdict();
  /** Starts the probe on a worker. Null where there is none (tests, a browser without workers): the verdict then stays off. */
  chaosProbe: ((spec: ChaosSpec, onProgress: (fraction: number) => void) => RunningJob<ChaosVerdict>) | null = null;
  /** The preset last loaded with two bodies, and with three: where switching the body count goes back to. */
  readonly lastPreset: Record<BodyCount, string> = { ...DEFAULT_PRESET_ID };
  private lastCount: BodyCount = 3;
  private readonly bodyCountListeners: (() => void)[] = [];
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

  /**
   * Counts loads, edits and resets: a warning dismissed in one run comes back in the next. The
   * banner compares it with the value it saw.
   */
  runId = 0;
  /** The user changed the system (the body editor, G, softening or the preset's sliders): another preset may suit them better. */
  custom = false;

  private readonly view: ViewPort;
  private preflightIssues: Issue[] = [];
  private currentIssues: Issue[] = [];
  /** A notice about what the controller itself did or refused (a method that cannot run the system), shown with the warnings. */
  private notice: Issue | null = null;
  /** The notice the next new run starts with: set by an edit that had to change the method. */
  private nextNotice: Issue | null = null;
  private noticeCount = 0;
  /** Warnings that have already paused this run once: pressing play again must not pause it again. */
  private readonly pausedFor = new Set<string>();
  private sinceReadout = 0;
  private chaosJob: RunningJob<ChaosVerdict> | null = null;
  /** Seconds until a pending probe starts (so dragging a slider does not start one per frame), or -1 when none is waiting. */
  private chaosDelay = -1;
  private horizonMarked = false;
  private returnMessage = '';
  private samplesPerPeriod = DEFAULT_SAMPLES_PER_PERIOD;
  /** The size of the system the view was last framed on: an edit that changes it a great deal reframes. */
  private framedSize = 0;

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
    this.loop.onStop = () => this.finishReturn();
    if (view.stats) this.loop.renderMs = () => (view.stats as { renderMs: number }).renderMs;
    this.loadPreset(preset, options);
  }

  /** How many bodies the system has now: 2 or 3. */
  get bodyCount(): BodyCount {
    return this.sim.state.n;
  }

  /** The first run, or the comparison twin, has failed: the run cannot go on as it is. */
  get failed(): boolean {
    return this.sim.failure !== null || !!this.comparison?.sim.failure;
  }

  /** Called after a load that changed the number of bodies, once everything is consistent again. */
  onBodyCountChange(listener: () => void): void {
    this.bodyCountListeners.push(listener);
  }

  /**
   * Switches between a pair and a triple: loads the preset of that kind last used (or the default
   * one). The two are different systems, so a switch is a new run, not an edit of the old one.
   */
  setBodyCount(count: BodyCount): void {
    if (count === this.sim.state.n) return;
    const remembered = findPreset(this.lastPreset[count]);
    const preset = remembered && bodyCountOf(remembered) === count ? remembered : findPreset(DEFAULT_PRESET_ID[count]);
    if (preset) this.loadPreset(preset);
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
    this.stopComparison();
    this.cancelReturn();
    const recommended = preset.recommended;
    const instance = instantiate(preset, params);
    const initial = instance.state;
    if (offset !== 0) {
      for (let i = 0; i < initial.n; i++) {
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
    this.framedSize = sim.reference.size;
    const defaults = instantiate(preset).params;
    this.custom = Object.keys(defaults).some((key) => defaults[key] !== this.params[key]);
    this.readDraft();
    this.restartHistory();
    this.restartChaos();
    this.newRun();
    this.lastPreset[sim.state.n] = preset.id;
    if (sim.state.n !== this.lastCount) {
      this.lastCount = sim.state.n;
      for (const listener of this.bodyCountListeners) listener();
    }
  }

  /** Reloads the current preset with the values now in `params`: the sliders' apply. */
  applyParams(): void {
    this.loadPreset(this.preset, { params: this.params });
  }

  play(): void {
    // A failed twin holds the run (the loop would only freeze its clock): the banner offers to stop the comparison.
    if (this.comparison?.sim.failure) return;
    this.returnMessage = '';
    this.sim.stopReason = null;
    this.loop.settings.running = true;
  }

  pause(): void {
    this.cancelReturn();
    this.loop.settings.running = false;
  }

  /** Pauses and takes one step. */
  step(): void {
    this.loop.stepOnce();
  }

  /** Back to the state of the last load or edit. Running or paused stays as it was. */
  reset(): void {
    this.stopComparison();
    this.cancelReturn();
    this.sim.reset();
    this.view.clearTrails();
    this.readDraft();
    this.restartHistory();
    this.newRun();
  }

  setSpeed(speed: number): void {
    this.loop.settings.speed = speed;
  }

  setDirection(sign: 1 | -1): void {
    if (sign !== this.sim.direction) {
      this.sampler.mark(sign < 0 ? 'time reversed' : 'time forward');
      this.cancelReturn(); // a return runs one way: turning round ends it, it has not arrived
    }
    this.sim.setDirection(sign);
    this.comparison?.sim.setDirection(sign);
  }

  /**
   * The one path for editing the system (plan §4.7): pause (unless told not to), apply, re-center
   * on the COM unless told not to, take new reference values, clear the trails and restart the
   * integrator. `next` is normally a snapshot of sim.state with some fields changed. An edit that
   * leaves the system what it was (a turn, a nudge, G) passes its `period`, so T_char does not jump.
   */
  edit(next: SystemState, recenter = true, pause = true, period?: number): void {
    this.stopComparison();
    if (pause) this.pause();
    this.cancelReturn();
    // Loading throws if the method rejects the system, after the state has been replaced, so a method that
    // cannot run the edited system is swapped out first. IAS15 takes anything.
    const unsupported = this.sim.integrator.id === 'wh' ? this.rejection('wh', next) : null;
    if (unsupported !== null) {
      this.sim.setIntegrator('ias15');
      this.nextNotice = this.makeNotice(
        'info',
        'Switched to IAS15',
        `Wisdom-Holman cannot run the system as edited: ${explainRejection(unsupported)}. The run continues with IAS15, which takes any system.`,
        'wisdom-holman',
      );
    }
    this.sim.load(next, { recenter, period });
    const size = this.sim.reference.size;
    if (size > 2 * this.framedSize || size < 0.5 * this.framedSize) {
      this.view.setSystemScale(size); // scaled up or down a great deal: the bodies and the camera were sized for the old one
      this.framedSize = size;
    }
    this.view.clearTrails();
    this.readDraft();
    this.restartHistory();
    this.restartChaos();
    this.newRun();
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
    this.draft.slice(0, next.n).forEach((body, i) => {
      next.m[i] = Math.max(0, body.m);
      next.x.set([body.pos.x, body.pos.y, body.pos.z], 3 * i);
      next.v.set([body.vel.x, body.vel.y, body.vel.z], 3 * i);
    });
    this.custom = true;
    this.edit(next, recenter);
  }

  /**
   * Turns the whole system about an axis (plan §7.1). It is a symmetry of the physics, so only
   * the plane of the motion changes. Keeps running.
   */
  rotate(axis: Axis, degrees: number): void {
    const next = snapshot(this.sim.state);
    rotateState(next, axis, degrees);
    this.edit(next, false, false, this.sim.reference.period);
  }

  /** Nudges one body (plan §7.2), re-centering afterwards if asked, and keeps running. Returns the direction used. */
  nudge(spec: Nudge, recenter = false): [number, number, number] {
    const next = snapshot(this.sim.state);
    const direction = nudgeState(next, spec);
    this.edit(next, recenter, false, this.sim.reference.period);
    return direction;
  }

  /**
   * Switches method, continuing from the current state (plan §4.7). WH has no softening, so
   * choosing it removes any.
   */
  setIntegrator(id: IntegratorId, symplecticEuler = false): string | null {
    if (id === 'wh') {
      // Softening is removed, so judge the system without it; and refuse before changing anything.
      const trial = snapshot(this.sim.state);
      trial.eps2 = 0;
      const why = this.rejection(id, trial);
      if (why !== null) return this.refuse(why);
      if (this.sim.state.eps2 !== 0) this.setSoftening(0);
    }
    this.sim.setIntegrator(id, symplecticEuler);
    this.dropTwin();
    this.sampler.mark(id === 'euler' && symplecticEuler ? 'symplectic Euler' : id);
    this.notice = null;
    this.pausedFor.clear();
    this.runId++; // warnings dismissed under the old method come back if the new one has them too
    this.checkStart();
    this.updateReadout();
    return null;
  }

  /** Why `id` cannot run `state`, in the integrator's own words, or null if it can. Changes nothing. */
  private rejection(id: IntegratorId, state: SystemState): string | null {
    try {
      createIntegrator(id).init(state, { dt: 1, counters: createCounters(), centralBody: this.sim.params.centralBody, epsTol: this.sim.params.epsTol });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private makeNotice(severity: Issue['severity'], title: string, detail: string, learn?: string): Issue {
    return { id: `notice-${++this.noticeCount}`, severity, title, detail, learn, fixes: [] };
  }

  /** Tells the user, on the warnings banner, something that was not done (a link that could not be used). The run is untouched. */
  announce(severity: Issue['severity'], title: string, detail: string): void {
    this.notice = this.makeNotice(severity, title, detail);
    this.checkHealth();
  }

  /** Says why a change of method was not made, on the banner, and returns the same words. */
  private refuse(reason: string): string {
    const detail = `Wisdom-Holman cannot run this system: ${explainRejection(reason)}. The method was not changed.`;
    this.notice = this.makeNotice('warning', "Can't switch to that method", detail, 'wisdom-holman');
    this.checkHealth();
    return detail;
  }

  /** The step size of the fixed-step methods, and the first guess of IAS15. Takes effect on the next step. */
  setDt(dt: number): void {
    this.sim.params.dt = dt;
    this.dropTwin();
    this.checkStart();
  }

  /** IAS15's tolerance. Takes effect on the next step. */
  setEpsTol(epsTol: number): void {
    this.sim.params.epsTol = epsTol;
    this.dropTwin();
  }

  /**
   * IAS15's smallest or largest step (undefined: no limit). The two never cross: a limit set past
   * the other is held at it, as a minimum above the maximum would pin every step to the minimum.
   */
  setStepLimit(key: 'dtMin' | 'dtMax', value: number | undefined): void {
    const { params } = this.sim;
    const other = key === 'dtMin' ? params.dtMax : params.dtMin;
    if (value !== undefined && other !== undefined) value = key === 'dtMin' ? Math.min(value, other) : Math.max(value, other);
    params[key] = value;
    this.dropTwin();
  }

  /** A twin is the same method with a nudge: once the first run's method or step changes it is a different run, so it ends. */
  private dropTwin(): void {
    if (this.comparison?.kind === 'twin') this.stopComparison();
  }

  /** WH only: the body the others orbit (undefined: the most massive). Restarts WH, which orders the bodies once. */
  setCentralBody(body: 0 | 1 | 2 | undefined): void {
    const before = this.sim.params.centralBody;
    this.sim.params.centralBody = body;
    if (body !== before) this.dropTwin();
    if (this.sim.integrator.id === 'wh' && this.setIntegrator('wh') !== null) this.sim.params.centralBody = before;
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
    const before = next.G;
    next.G = G;
    this.custom = true;
    // The same system under another G: time goes as 1/sqrt(G), so T_char does too.
    this.edit(next, false, false, G > 0 && before > 0 ? this.sim.reference.period * Math.sqrt(before / G) : undefined);
  }

  /** The softening length (plan §3.1). Ignored by WH, which has no softening. */
  setSoftening(length: number): void {
    if (this.sim.integrator.id === 'wh') return;
    const next = snapshot(this.sim.state);
    next.eps2 = length * length;
    this.custom = true;
    this.edit(next, false, false, this.sim.reference.period);
  }

  /**
   * Starts a comparison (plan §7.4): a second run from the current state, drawn over the first,
   * on the same time target, with its own history and a divergence measure. Starts the charts
   * afresh so both begin at the same point. Returns an error message if the twin cannot be made
   * (Wisdom-Holman does not take softening), else null.
   */
  startComparison(options: ComparisonOptions): string | null {
    this.stopComparison();
    let comparison: Comparison;
    try {
      comparison = new Comparison(this.sim, options);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    const twin = comparison.sim;
    twin.onStep = (s) => {
      this.view.recordGhostSample(s);
      comparison.sampler.record(twin);
    };
    this.comparison = comparison;
    this.loop.twin = twin;
    copyState(twin.state, this.loop.renderedTwin);
    this.view.setGhost(this.loop.renderedTwin);
    this.view.clearTrails();
    this.restartHistory();
    this.updateReadout();
    return null;
  }

  stopComparison(): void {
    if (this.comparison === null) return;
    this.comparison = null;
    this.loop.twin = null;
    this.view.setGhost(null);
    this.sampler.divergence = NaN;
    this.readout.divergence = NaN;
  }

  /**
   * Runs back to the time of the last load or edit and reports how far the state is from where it
   * started, in phase space (plan §7.3): about roundoff for leapfrog, but not for Euler, and not
   * after a long run of a chaotic system. Pauses there. A fixed-step method lands on the start
   * exactly; an adaptive one stops within a step of it.
   */
  returnToStart(): void {
    const { sim, loop } = this;
    const base = sim.baselineTime;
    this.returnMessage = '';
    this.readout.returnDistance = NaN;
    if (sim.state.t === base) {
      this.finishReturn();
      return;
    }
    const dir = sim.state.t > base ? -1 : 1;
    this.setDirection(dir);
    loop.stopAt = base - dir * 0.5 * sim.currentDt();
    loop.settings.running = true;
  }

  private cancelReturn(): void {
    this.loop.stopAt = null;
    this.returnMessage = '';
  }

  private finishReturn(): void {
    const distance = this.sim.distanceFromBaseline();
    this.readout.returnDistance = distance;
    this.returnMessage = `returned to the start: phase-space distance ${distance.toExponential(2)}`;
    this.loop.settings.running = false;
    this.updateReadout();
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
    if (this.comparison !== null) {
      this.sampler.divergence = this.comparison.measure(this.sim, rendered, this.loop.renderedTwin);
    }
    this.sinceReadout += dtSeconds;
    if (this.chaosDelay >= 0) {
      this.chaosDelay -= dtSeconds;
      if (this.chaosDelay < 0) void this.launchChaos();
    }
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
    readout.routh = sim.state.n === 2 ? NaN : routhRatio(sim.state.m[0], sim.state.m[1], sim.state.m[2]);
    readout.dt = sim.currentDt();
    readout.steps = sim.counters.stepCount;
    readout.forceEvals = sim.counters.forceEvals;
    readout.divergence = this.comparison?.divergence ?? NaN;
    readout.status = this.status();
    readout.chaos = this.chaosText();
    this.checkHealth();
  }

  // ---- the chaos probe (sim/chaos.ts) ---------------------------------------------------------

  /**
   * Forgets what the probe knew and, after a short pause, starts it again on the run's starting
   * state. The probe is about the equations and the start, so a new run of the same system (reset)
   * or another method does not call this; a load or an edit does.
   */
  private restartChaos(): void {
    this.chaosJob?.cancel();
    this.chaosJob = null;
    this.horizonMarked = false;
    const { sim, chaos } = this;
    Object.assign(chaos, createVerdict());
    const off = chaosOffReason(sim.baselineSnapshot(), sim.reference.period, sim.reference.size);
    if (off !== null) {
      chaos.reason = off;
      this.chaosDelay = -1;
      return;
    }
    chaos.state = 'measuring';
    chaos.done = false;
    this.chaosDelay = 0.4;
  }

  /** Starts the probe now, and resolves when it is done. For tests and for restarting at once. */
  async probeChaos(): Promise<void> {
    this.chaosDelay = -1;
    await this.launchChaos();
  }

  private async launchChaos(): Promise<void> {
    const { sim, chaos } = this;
    if (this.chaosProbe === null) {
      Object.assign(chaos, createVerdict());
      chaos.reason = 'No background worker is available to run the chaos probe.';
      return;
    }
    let job: RunningJob<ChaosVerdict> | null = null;
    const progress = (fraction: number): void => {
      if (job !== null && this.chaosJob === job) chaos.progress = fraction;
    };
    try {
      job = this.chaosProbe({ state: sim.baselineSnapshot(), period: sim.reference.period, size: sim.reference.size }, progress);
    } catch (error) {
      Object.assign(chaos, createVerdict());
      chaos.state = 'inconclusive';
      chaos.reason = error instanceof Error ? error.message : String(error);
      return;
    }
    const started = job;
    this.chaosJob = started;
    started.result.catch(() => {}); // handled below; keeps a cancelled job from reporting as unhandled
    const wait = started.result.then(
      (verdict) => {
        if (this.chaosJob !== started) return; // another run began while this one worked
        Object.assign(chaos, verdict);
        this.updateReadout();
      },
      (error: unknown) => {
        if (this.chaosJob !== started || error instanceof Cancelled) return;
        Object.assign(chaos, createVerdict());
        chaos.state = 'inconclusive';
        chaos.reason = error instanceof Error ? error.message : String(error);
      },
    );
    await wait;
  }

  /** The chaos finding in a few words, for the Live Numbers panel. */
  private chaosText(): string {
    const { chaos } = this;
    const per = (n: number): string => (n < 10 ? n.toFixed(1) : String(Math.round(n)));
    switch (chaos.state) {
      case 'off':
        return this.sim.state.n === 2 ? 'none: two bodies' : 'not probed';
      case 'measuring':
        return `measuring ${Math.round(100 * chaos.progress)}%`;
      case 'regular':
        return `no sign in ${Math.round(chaos.probedPeriods)} T`;
      case 'inconclusive':
        return 'inconclusive';
      case 'chaotic':
      case 'very-chaotic':
        return `${chaos.state === 'very-chaotic' ? 'extreme' : 'chaotic'}, e per ${per(chaos.lyapunovPeriods)} T`;
    }
  }

  /** The probe's finding as the health check wants it, once it has found chaos; null otherwise. */
  private chaosInput(): ChaosInput | null {
    const { chaos, sim, readout } = this;
    if ((chaos.state !== 'chaotic' && chaos.state !== 'very-chaotic') || !(chaos.lyapunovPeriods > 0) || !Number.isFinite(chaos.lyapunovPeriods)) return null;
    const period = sim.reference.period;
    // An error of the size the method makes (at least rounding) grows to a tenth of the system after this long.
    const horizon = predictabilityHorizon(chaos.lyapunovPeriods * period, Math.max(1e-12, readout.energyError));
    return {
      state: chaos.state,
      lyapunovPeriods: chaos.lyapunovPeriods,
      horizonPeriods: horizon / period,
      elapsedPeriods: Math.abs(sim.state.t - sim.baselineTime) / period,
    };
  }

  /** What is wrong with the run, most severe first. Refreshed with the readout, about ten times a second. */
  get issues(): readonly Issue[] {
    return this.currentIssues;
  }

  /** The preset closest to the starting state, or null when the run is a preset's own (it is already the right one). */
  suggestion(): Suggestion | null {
    if (!this.custom && !this.preset.id.startsWith('sandbox')) return null;
    const suggestion = suggestPreset(this.sim.baselineSnapshot());
    return suggestion.presetId === this.preset.id && !this.custom ? null : suggestion;
  }

  /** Does what a warning offers (see health.ts), and runs. */
  applyFix(fix: Fix): void {
    const { sim } = this;
    switch (fix) {
      case 'bind': {
        const next = sim.baselineSnapshot();
        scaleToBound(next);
        this.custom = true;
        this.edit(next, true);
        break;
      }
      case 'ias15':
        this.setIntegrator('ias15');
        this.reset();
        break;
      case 'smaller-step':
        // A quarter, and at least as fine as the warning asks: a half barely changes a step that is far too big.
        this.setDt(Math.min(sim.params.dt / 4, sim.reference.period / (4 * 20)));
        this.reset();
        break;
      case 'reset':
        this.reset();
        break;
      case 'frame':
        this.view.frameAll?.(sim.state);
        return;
      case 'suggested': {
        const preset = findPreset(this.suggestion()?.presetId ?? '');
        if (preset) this.loadPreset(preset);
        break;
      }
      case 'defaults':
        this.loadPreset(this.preset);
        break;
      case 'stop-twin':
        this.stopComparison();
        break;
      case 'twin':
        // A nudge of a ten-thousandth of the system: about seven e-folds from visible, so it shows within a few tens of orbits rather than minutes.
        this.startComparison({ kind: 'twin', nudge: { body: 0, target: 'position', direction: 'random', size: 1e-4 } });
        break;
    }
    this.play();
  }

  /** A fresh start (load, edit or reset): warnings dismissed before come back, and may pause again. */
  private newRun(): void {
    this.runId++;
    this.readout.returnDistance = NaN; // it belonged to the run before
    this.notice = this.nextNotice;
    this.nextNotice = null;
    this.horizonMarked = false;
    this.pausedFor.clear();
    this.checkStart();
    this.updateReadout();
  }

  /** The checks on the starting state, which depend on the method and step too. */
  private checkStart(): void {
    const { sim } = this;
    this.preflightIssues = preflight({ state: sim.baselineSnapshot(), integrator: sim.integrator.id, dt: sim.params.dt, period: sim.reference.period, expectUnbound: this.preset.tags.includes('unbound') });
  }

  private checkHealth(): void {
    const { sim, readout } = this;
    const escape = ESCAPE_SIZES * sim.reference.size;
    const d = sim.refreshDiagnostics();
    const bodies = [0, 1, 2].slice(0, sim.state.n);
    const far = bodies.map(
      (k) => Math.hypot(sim.state.x[3 * k] - d.com[0], sim.state.x[3 * k + 1] - d.com[1], sim.state.x[3 * k + 2] - d.com[2]) > FAR_SIZES * sim.reference.size,
    );
    const running = runtimeIssues({
      integrator: sim.integrator.id,
      explicitEuler: sim.integrator.id === 'euler' && !sim.integrator.symplectic,
      failure: sim.failure,
      closeApproach: d.minSeparation < CLOSE_FAILURE * sim.reference.size,
      twinFailure: this.comparison?.sim.failure ?? null,
      stopped: this.loop.settings.running ? null : sim.stopReason,
      warning: sim.warning,
      energyError: readout.energyError,
      escaped: bodies.map((k) => hasEscaped(sim.state, k, escape)),
      far,
      custom: this.custom,
      chaos: this.chaosInput(),
    });
    this.currentIssues = bySeverity([...running, ...this.preflightIssues, ...(this.notice ? [this.notice] : [])]);
    const horizon = running.some((issue) => issue.id === 'chaos-horizon');
    if (horizon && !this.horizonMarked) {
      this.horizonMarked = true;
      this.sampler.mark('predictability horizon');
    }
    for (const issue of this.currentIssues) {
      if (!issue.pause || this.pausedFor.has(issue.id)) continue;
      this.pausedFor.add(issue.id);
      if (this.loop.settings.running) this.pause();
    }
  }

  private status(): string {
    const { sim } = this;
    if (sim.failure !== null) return sim.failure;
    const twinFailure = this.comparison?.sim.failure;
    if (twinFailure) return `the comparison twin failed: ${twinFailure}`;
    let status = this.returnMessage ? `paused; ${this.returnMessage}` : 'paused';
    if (this.loop.settings.running) {
      const achieved = this.loop.stats.achieved;
      status = achieved < LAG_NOTICE ? `running at ${Math.round(100 * achieved)}% of requested speed` : 'running';
      if (this.loop.stopAt !== null) status = 'returning to the start';
    }
    if (sim.encounter !== null) status += `; ${sim.encounter}`;
    if (sim.warning !== null) status += `; ${sim.warning}`;
    if (sim.state.n === 2) {
      if (hasEscaped(sim.state, 0, ESCAPE_SIZES * sim.reference.size)) status += '; the bodies are leaving each other';
    } else {
      for (let k = 0; k < 3; k++) {
        if (hasEscaped(sim.state, k, ESCAPE_SIZES * sim.reference.size)) status += `; body ${k + 1} has escaped`;
      }
    }
    return status;
  }
}

/** An integrator's rejection in plain words, to follow "cannot run this system:". */
function explainRejection(reason: string): string {
  if (/nonzero total mass/.test(reason)) return 'its central body and inner companion have no mass between them, and it works by following their Kepler orbit exactly';
  if (/softening/.test(reason)) return 'it has softening, which Wisdom-Holman does not support';
  return reason;
}
