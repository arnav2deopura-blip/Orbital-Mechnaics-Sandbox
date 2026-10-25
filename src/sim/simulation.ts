import { KeplerReference } from './analytic';
import { shiftToComFrame } from './coords';
import { createDiagnostics, createReference, measure } from './diagnostics';
import type { Diagnostics, Reference } from './diagnostics';
import { minSeparationSquared } from './events';
import { createIntegrator } from './integrators';
import { IAS15 } from './integrators/ias15';
import type { Integrator, IntegratorId, IntegratorParams } from './integrators/types';
import { WH } from './integrators/wh';
import { copyState, createCounters, createState, snapshot, STATE_LEN } from './state';
import type { CostCounters, SystemState } from './types';

/** advanceTo() reads the clock this often (in steps), not after every one. */
const CLOCK_EVERY = 32;

export interface SimulationOptions {
  integrator: IntegratorId;
  /** Tuning for the integrator, kept by reference: change sim.params.dt between steps, no setter needed. */
  params: Omit<IntegratorParams, 'counters'>;
  /** Euler only: the semi-implicit form. */
  symplecticEuler?: boolean;
  /** Milliseconds, for the budget in advanceTo(). Defaults to performance.now. */
  clock?: () => number;
  /** How to load the initial state. */
  load?: LoadOptions;
}

export interface LoadOptions {
  /** The period of the system if it is known, for T_char. Otherwise it is measured. */
  period?: number;
  /** Shift to the COM frame (plan §3.2). Default true. */
  recenter?: boolean;
}

/**
 * 'reached': the state is at or just past tTarget. 'budget': the deadline came first. 'event':
 * a close encounter stopped the run, as asked. 'failed': a step produced NaN or Inf (or could
 * not be taken), the state was put back, and failure says why.
 */
export interface AdvanceResult {
  status: 'reached' | 'budget' | 'event' | 'failed';
  steps: number;
}

/**
 * Owns the state, the integrator and the cost counters (plan §3). The caller asks for a time
 * with advanceTo() and draws stateAt(), which only interpolates between true states.
 *
 * `state` is the latest true state and `prev` the one before the last step. Fixed-step
 * methods run until `state` has passed the target, so the target is always inside
 * [prev.t, state.t] (in the running direction) and there is something to interpolate between.
 */
export class Simulation {
  readonly state = createState();
  readonly prev = createState();
  readonly counters: CostCounters = createCounters();
  readonly params: IntegratorParams;
  /** The last measure() result. */
  readonly diagnostics: Diagnostics = createDiagnostics();
  integrator: Integrator;
  /** Reference invariants (plan §3.2). They are replaced by load() and kept by setIntegrator(). */
  reference!: Reference; // set by load()
  /** Called with the true state after each accepted step. For trails and the diagnostics sampler. */
  onStep: ((s: SystemState) => void) | null = null;
  /** Bumped by everything that changes the state other than a step, so a caller holding a time target can resync. */
  revision = 0;
  /** Why integration stopped, or null. Cleared by load(), reset() and setIntegrator(). */
  failure: string | null = null;
  /**
   * Close encounter (plan §7.5): when two bodies come within this distance, `encounter` is set to
   * a description, and the run stops if `stopOnEncounter`. 0 turns it off. Checked after every
   * step, and only on entering the encounter, not on every step spent inside it.
   */
  encounterRadius = 0;
  stopOnEncounter = false;
  /** The latest encounter, or null. Cleared by load() and reset(). */
  encounter: string | null = null;
  /**
   * What the integrator reports about its own health (plan §7.5): IAS15 reaching its minimum
   * step or failing to converge, WH's Kepler solver failing. Null when all is well. Cleared by
   * load(), reset() and setIntegrator().
   */
  warning: string | null = null;
  /**
   * Called with a short description when something worth marking on the charts happens: an
   * encounter, or the first of each kind of integrator warning.
   */
  onEvent: ((message: string) => void) | null = null;
  /** The exact solution, for two bodies or when one is massless (plan §6), for the analytic error. Set by load(). */
  private analytic: KeplerReference | null = null;

  /** What reset() returns to: the state at the last load(). */
  private readonly baseline = createState();
  private dir: 1 | -1 = 1;
  /** Whether the integrator's dense output describes the step from prev to state. */
  private denseValid = false;
  /** Inside an encounter: it ends when the bodies are 20% beyond the radius, so one pass is one event. */
  private inEncounter = false;
  private stopRequested = false;
  /** The integrator the health counters below were read from, and what they read when it was last checked. */
  private healthOf: Integrator | null = null;
  /** Whether that integrator has counters worth reading: 0 for the fixed-step methods, which keeps the hot path to a pointer compare. */
  private healthKind = 0;
  private readonly healthSeen = { minStep: 0, converge: 0, kepler: 0 };
  private readonly clock: () => number;
  private readonly result: AdvanceResult = { status: 'reached', steps: 0 };

  constructor(initial: SystemState, options: SimulationOptions) {
    this.params = { ...options.params, counters: this.counters };
    this.integrator = createIntegrator(options.integrator, options.symplecticEuler);
    this.clock = options.clock ?? (() => performance.now());
    this.load(initial, options.load);
  }

  get direction(): 1 | -1 {
    return this.dir;
  }

  /**
   * Replaces the system: a new preset, or an edit of the current one (plan §4.7), which is then
   * a snapshot of `state` with some fields changed. t is taken from `next`. The reference
   * values, the cost counters and reset()'s starting point all restart from here. Throws if the
   * integrator rejects the system (WH with softening), after the state has been replaced.
   */
  load(next: SystemState, { period, recenter = true }: LoadOptions = {}): void {
    copyState(next, this.state);
    if (recenter) shiftToComFrame(this.state);
    this.reference = createReference(this.state, period);
    copyState(this.state, this.baseline);
    this.analytic = KeplerReference.from(this.state);
    this.zeroCounters();
    this.restart();
  }

  /** Back to the state of the last load(), forward or backward as before. The reference is unchanged. */
  reset(): void {
    copyState(this.baseline, this.state);
    this.zeroCounters();
    this.restart();
  }

  /**
   * Continues from the current state with another method (plan §4.7). The reference values are
   * kept, so the error afterwards is that of the new method. Throws, changing nothing, if it
   * rejects the system.
   */
  setIntegrator(id: IntegratorId, symplecticEuler = false): void {
    const next = createIntegrator(id, symplecticEuler);
    next.init(this.state, this.params);
    next.setDirection(this.dir);
    this.integrator = next;
    this.failure = null;
    this.resetHealth();
    this.rebase();
  }

  /** Time reversal (plan §7.3). */
  setDirection(sign: 1 | -1): void {
    if (sign === this.dir) return;
    this.dir = sign;
    this.integrator.setDirection(sign);
    this.rebase();
  }

  /** Magnitude of the step the next step() will try: params.dt, or the adaptive step IAS15 has settled on. */
  currentDt(): number {
    return this.integrator instanceof IAS15 ? this.integrator.dtNext : this.params.dt;
  }

  /** How far the true state is from the exact two-body solution, or NaN when there is none (three massive bodies, or softening). */
  analyticError(): number {
    return this.analytic ? this.analytic.error(this.state) : NaN;
  }

  /**
   * The phase-space distance from the state of the last load(): the largest difference in any
   * position or velocity component. For the "return to start" check (plan §7.3).
   */
  distanceFromBaseline(): number {
    let worst = 0;
    for (let i = 0; i < STATE_LEN; i++) {
      worst = Math.max(worst, Math.abs(this.state.x[i] - this.baseline.x[i]), Math.abs(this.state.v[i] - this.baseline.v[i]));
    }
    return worst;
  }

  /** A copy of the state of the last load(): the run's initial conditions, as edited. */
  baselineSnapshot(): SystemState {
    return snapshot(this.baseline);
  }

  /** The time of the last load(): where reset() and "return to start" go back to. */
  get baselineTime(): number {
    return this.baseline.t;
  }

  /** Measures the true state into `diagnostics` (plan §6) and returns it. */
  refreshDiagnostics(): Diagnostics {
    measure(this.state, this.diagnostics);
    return this.diagnostics;
  }

  /** One step whatever the target, for the single-step button. False if it failed. */
  step(): boolean {
    const ok = this.failure === null && this.takeStep();
    this.stopRequested = false; // a single step is already a stop
    return ok;
  }

  /**
   * Steps until `state` has reached tTarget in the running direction, or until `deadlineMs`
   * (on the clock) has passed, checked every few steps. The returned object is reused: read it
   * before the next call.
   */
  advanceTo(tTarget: number, deadlineMs: number): AdvanceResult {
    const result = this.result;
    result.steps = 0;
    result.status = 'reached';
    if (this.failure !== null) {
      result.status = 'failed';
      return result;
    }
    const state = this.state;
    const dir = this.dir;
    let steps = 0;
    while ((state.t - tTarget) * dir < 0) {
      if (steps !== 0 && steps % CLOCK_EVERY === 0 && this.clock() >= deadlineMs) {
        result.status = 'budget';
        break;
      }
      if (!this.takeStep()) {
        result.status = 'failed';
        break;
      }
      steps++;
      if (this.stopRequested) {
        this.stopRequested = false;
        result.status = 'event';
        break;
      }
    }
    result.steps = steps;
    return result;
  }

  /**
   * Writes the system at time t, clamped to [prev.t, state.t], into out (plan §5.1). IAS15
   * evaluates its dense output; the others use cubic Hermite interpolation of position and
   * velocity between the two true states. Only for drawing: diagnostics read `state`.
   */
  stateAt(t: number, out: SystemState): void {
    const { prev, state } = this;
    out.n = state.n;
    out.m.set(state.m);
    out.G = state.G;
    out.eps2 = state.eps2;
    const span = state.t - prev.t;
    const h = span === 0 ? 1 : Math.min(Math.max((t - prev.t) / span, 0), 1);
    if (h === 1) {
      out.t = state.t;
      out.x.set(state.x);
      out.v.set(state.v);
      return;
    }
    out.t = prev.t + h * span;
    if (h === 0) {
      out.x.set(prev.x);
      out.v.set(prev.v);
    } else if (this.denseValid && this.integrator.dense) {
      this.integrator.dense(h, out.x, out.v);
    } else {
      hermite(prev, state, h, out);
    }
  }

  private takeStep(): boolean {
    const { state, prev } = this;
    copyState(state, prev);
    const dt = this.integrator.step(state);
    if (dt === 0 || !isFiniteState(state)) {
      // Put back the last good state. An adaptive method that stepped nowhere left it unchanged.
      copyState(prev, state);
      this.integrator.reset();
      this.denseValid = false;
      const at = createDiagnostics(); // rare, so allocating here is fine
      measure(prev, at);
      this.failure =
        `integration failed at t=${prev.t.toPrecision(6)}, min separation ${at.minSeparation.toPrecision(3)}`;
      return false;
    }
    this.counters.stepCount++;
    this.denseValid = this.integrator.dense !== undefined;
    if (this.encounterRadius > 0) this.checkEncounter();
    this.checkHealth();
    this.onStep?.(state);
    return true;
  }

  private checkEncounter(): void {
    const radius = this.encounterRadius;
    const r2 = minSeparationSquared(this.state.x, this.state.n);
    if (r2 < radius * radius) {
      if (this.inEncounter) return;
      this.inEncounter = true;
      this.encounter = `close encounter at t=${this.state.t.toPrecision(6)}, separation ${Math.sqrt(r2).toPrecision(3)}`;
      this.onEvent?.('close encounter');
      if (this.stopOnEncounter) this.stopRequested = true;
    } else if (r2 > 1.44 * radius * radius) {
      this.inEncounter = false;
    }
  }

  /**
   * Reads the integrator's own failure counters (plan §7.5). The first minimum-step hit or
   * Kepler failure stops the run, like an encounter, and says so; later ones only update the
   * count, so resuming does not stop again on every step. Failing to converge never stops it.
   */
  private checkHealth(): void {
    const integrator = this.integrator;
    if (integrator !== this.healthOf) this.resetHealth();
    if (this.healthKind === 0) return;
    const seen = this.healthSeen;
    if (integrator instanceof IAS15) {
      if (integrator.dtMinHits > seen.minStep) {
        if (seen.minStep === 0) this.raise('IAS15 reached its minimum step: a close encounter it cannot resolve', true);
        seen.minStep = integrator.dtMinHits;
        this.warning = `IAS15 was held at its minimum step ${seen.minStep} time${seen.minStep === 1 ? '' : 's'}: close encounter unresolved`;
      }
      if (integrator.convergenceFailures > seen.converge) {
        if (seen.converge === 0) this.raise('IAS15 corrector did not converge', false);
        seen.converge = integrator.convergenceFailures;
        this.warning ??= `IAS15 corrector did not converge ${seen.converge} time${seen.converge === 1 ? '' : 's'}`;
      }
    } else if (integrator instanceof WH && integrator.keplerFailures > seen.kepler) {
      if (seen.kepler === 0) this.raise('the Kepler solver did not converge', true);
      seen.kepler = integrator.keplerFailures;
      this.warning = `Wisdom-Holman's Kepler solver failed to converge ${seen.kepler} time${seen.kepler === 1 ? '' : 's'}`;
    }
  }

  private raise(message: string, stop: boolean): void {
    this.onEvent?.(message);
    if (stop) this.stopRequested = true;
  }

  private resetHealth(): void {
    this.healthOf = this.integrator;
    this.healthKind = this.integrator instanceof IAS15 || this.integrator instanceof WH ? 1 : 0;
    this.healthSeen.minStep = this.healthSeen.converge = this.healthSeen.kepler = 0;
    this.warning = null;
  }

  /** Re-initializes the integrator on the current state, without touching the reference. */
  private restart(): void {
    this.integrator.init(this.state, this.params);
    this.integrator.setDirection(this.dir);
    this.failure = null;
    this.encounter = null;
    this.inEncounter = false;
    this.stopRequested = false;
    this.resetHealth();
    this.rebase();
  }

  /** Marks a change that was not a step: nothing to interpolate from, and callers must resync. */
  private rebase(): void {
    copyState(this.state, this.prev);
    this.denseValid = false;
    this.revision++;
  }

  private zeroCounters(): void {
    this.counters.stepCount = 0;
    this.counters.forceEvals = 0;
    this.counters.rejectedSteps = 0;
  }
}

/** False if any position or velocity is NaN or infinite. One check for all 18 numbers. */
function isFiniteState(s: SystemState): boolean {
  let sum = 0;
  for (let i = 0; i < STATE_LEN; i++) sum += s.x[i] + s.v[i];
  return Number.isFinite(sum);
}

/** Cubic Hermite from a to b at the fraction h in (0, 1); the velocity is the derivative of the position. */
function hermite(a: SystemState, b: SystemState, h: number, out: SystemState): void {
  const span = b.t - a.t;
  const h2 = h * h;
  const h3 = h2 * h;
  const p00 = 2 * h3 - 3 * h2 + 1;
  const p10 = h3 - 2 * h2 + h;
  const p01 = -2 * h3 + 3 * h2;
  const p11 = h3 - h2;
  const d00 = (6 * h2 - 6 * h) / span;
  const d10 = (3 * h2 - 4 * h + 1) / span;
  const d01 = (-6 * h2 + 6 * h) / span;
  const d11 = (3 * h2 - 2 * h) / span;
  for (let i = 0; i < STATE_LEN; i++) {
    const x0 = a.x[i];
    const x1 = b.x[i];
    const k0 = span * a.v[i]; // slopes over the whole step
    const k1 = span * b.v[i];
    out.x[i] = p00 * x0 + p10 * k0 + p01 * x1 + p11 * k1;
    out.v[i] = d00 * x0 + d10 * k0 + d01 * x1 + d11 * k1;
  }
}
