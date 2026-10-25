import { KeplerReference } from './analytic';
import type { IntegratorId } from './integrators/types';
import { Sampler } from './sampler';
import { Simulation } from './simulation';
import { snapshot } from './state';
import type { SystemState } from './types';

// Batch jobs (plan §9): runs that would stall the live view, done headless. Everything here is
// plain computation on a SystemState, so the same code runs in a Web Worker (src/worker) and in
// the tests. Each job is async so it can yield between runs, which is how a Worker gets to hear
// a cancel message, and reports its progress as a fraction.

export interface BatchContext {
  /** True once the user has cancelled. Checked between runs. */
  cancelled(): boolean;
  /** 0 to 1. */
  progress(fraction: number): void;
  /** Lets the event loop run. */
  yield(): Promise<void>;
}

/** What a cancelled job throws. */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

/** A context for tests and for running a job on the main thread: never cancelled, no progress report. */
export const quietContext: BatchContext = { cancelled: () => false, progress: () => {}, yield: () => Promise.resolve() };

async function between(ctx: BatchContext, done: number, total: number): Promise<void> {
  ctx.progress(done / total);
  await ctx.yield();
  if (ctx.cancelled()) throw new Cancelled();
}

// ---- convergence sweep and work-precision ---------------------------------------------------

export interface SweepSpec {
  /** The system to integrate, in the COM frame. Not modified. */
  state: SystemState;
  integrator: IntegratorId;
  symplecticEuler?: boolean;
  centralBody?: 0 | 1 | 2;
  /** How long to integrate. */
  duration: number;
  /**
   * The step sizes to try, for a fixed-step method (the step is adjusted slightly so a whole
   * number of them make up `duration`). For IAS15 these are tolerances, since it chooses its own step.
   */
  values: number[];
}

export interface SweepResult {
  /** The step (or, for IAS15, the tolerance) of each run, and the error and force evaluations it came to. */
  values: Float64Array;
  errors: Float64Array;
  forceEvals: Float64Array;
  /** The slope of log error against log step, or NaN for IAS15, whose steps are not chosen. */
  slope: number;
  /** What the error is measured against: the exact Kepler solution, or IAS15 at a tight tolerance. */
  reference: 'exact' | 'ias15';
  /** Runs that failed (NaN, or a step that could not be taken): their error is NaN. */
  failures: number;
}

/** `count` values from `from` to `to`, evenly spaced in the logarithm. */
export function geometricSeries(from: number, to: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from * (to / from) ** (count === 1 ? 0 : i / (count - 1)));
}

/**
 * The least-squares slope of log(error) against log(value), using the runs whose error is above
 * `floor` (below it is roundoff, not the method) and below `ceiling` (above it the step is too big
 * for the error to follow its power law yet).
 */
export function fitSlope(values: ArrayLike<number>, errors: ArrayLike<number>, floor = 1e-12, ceiling = 1e-1): number {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (errors[i] > floor && errors[i] < ceiling && values[i] > 0) {
      x.push(Math.log(values[i]));
      y.push(Math.log(errors[i]));
    }
  }
  if (x.length < 2) return NaN;
  const mx = x.reduce((a, b) => a + b) / x.length;
  const my = y.reduce((a, b) => a + b) / y.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : NaN;
}

/** The largest difference in any position component. */
function positionError(a: SystemState, b: SystemState): number {
  let worst = 0;
  for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(a.x[i] - b.x[i]));
  return worst;
}

/**
 * Integrates `duration` at each of `values` and measures the error of the final positions
 * (plan §9). The reference is the exact Kepler solution when one body is massless, and otherwise
 * IAS15 at a tolerance of 1e-10 (the plan's 1e-12 sits at the noise floor of IAS15's error
 * estimate, where its step collapses). Force evaluations are counted, so the same results give
 * the convergence plot (error against step: slope = order) and the work-precision diagram
 * (error against cost).
 */
export async function convergenceSweep(spec: SweepSpec, ctx: BatchContext = quietContext): Promise<SweepResult> {
  const { state, duration, values } = spec;
  const adaptive = spec.integrator === 'ias15';
  const t0 = state.t;
  const exact = KeplerReference.from(state);
  const total = values.length + (exact ? 0 : 1);
  let done = 0;

  // The reference state for the general case, from IAS15 run tightly.
  let reference: SystemState | null = null;
  if (!exact) {
    const sim = new Simulation(state, {
      integrator: 'ias15',
      params: { dt: duration / 200, epsTol: 1e-10, dtMin: duration * 1e-9 },
      load: { recenter: false },
    });
    sim.advanceTo(t0 + duration, Infinity);
    reference = snapshot(state);
    sim.stateAt(t0 + duration, reference);
    await between(ctx, ++done, total);
  }

  const errors = new Float64Array(values.length);
  const forceEvals = new Float64Array(values.length);
  const used = new Float64Array(values.length);
  let failures = 0;
  const end = snapshot(state);
  for (let k = 0; k < values.length; k++) {
    const steps = adaptive ? 0 : Math.max(1, Math.round(duration / values[k]));
    const dt = adaptive ? duration / 100 : duration / steps;
    used[k] = adaptive ? values[k] : dt;
    const sim = new Simulation(state, {
      integrator: spec.integrator,
      symplecticEuler: spec.symplecticEuler,
      params: {
        dt,
        centralBody: spec.centralBody,
        ...(adaptive ? { epsTol: values[k], dtMin: duration * 1e-9 } : {}),
      },
      load: { recenter: false },
    });
    if (adaptive) sim.advanceTo(t0 + duration, Infinity);
    else for (let i = 0; i < steps && sim.failure === null; i++) sim.step();
    sim.stateAt(t0 + duration, end);
    if (sim.failure !== null) {
      errors[k] = NaN;
      failures++;
    } else {
      errors[k] = exact ? exact.error(end) : positionError(end, reference as SystemState);
    }
    forceEvals[k] = sim.counters.forceEvals;
    await between(ctx, ++done, total);
  }
  return {
    values: used,
    errors,
    forceEvals,
    slope: adaptive ? NaN : fitSlope(used, errors),
    reference: exact ? 'exact' : 'ias15',
    failures,
  };
}

// ---- fast-forward ---------------------------------------------------------------------------

export interface FastForwardSpec {
  state: SystemState;
  integrator: IntegratorId;
  symplecticEuler?: boolean;
  centralBody?: 0 | 1 | 2;
  dt: number;
  epsTol?: number;
  /** How long to run, in sim time. */
  duration: number;
  /** The period, for the sampling interval and as IAS15's first guess. */
  period: number;
  /** How many points of history to keep, at most. Default 1000. */
  points?: number;
}

export interface FastForwardResult {
  /** The state reached, as a SystemState-shaped plain object. */
  final: { t: number; m: Float64Array; x: Float64Array; v: Float64Array; G: number; eps2: number };
  /** Decimated history: elapsed time, then the errors and the closest pair. */
  elapsed: Float64Array;
  energyError: Float64Array;
  angularMomentumError: Float64Array;
  minSeparation: Float64Array;
  steps: number;
  forceEvals: number;
  /** Why it stopped early, or null if it reached the end. */
  failure: string | null;
}

/**
 * "What happens after a thousand orbits?" (plan §9): runs `duration` headless, in slices so it can
 * report progress and be cancelled, and returns the final state and a decimated history.
 */
export async function fastForward(spec: FastForwardSpec, ctx: BatchContext = quietContext): Promise<FastForwardResult> {
  const { duration, period } = spec;
  const points = spec.points ?? 1000;
  const sim = new Simulation(spec.state, {
    integrator: spec.integrator,
    symplecticEuler: spec.symplecticEuler,
    params: { dt: spec.dt, epsTol: spec.epsTol, centralBody: spec.centralBody },
    load: { recenter: false },
  });
  const sampler = new Sampler(2 * points);
  sampler.clear(period);
  sampler.interval = duration / points;
  sampler.record(sim);
  sim.onStep = () => sampler.record(sim);

  const t0 = spec.state.t;
  const slices = 100;
  for (let k = 1; k <= slices && sim.failure === null; k++) {
    sim.advanceTo(t0 + (duration * k) / slices, Infinity);
    await between(ctx, k, slices);
  }
  const n = sampler.length;
  return {
    final: { t: sim.state.t, m: Float64Array.from(sim.state.m), x: Float64Array.from(sim.state.x), v: Float64Array.from(sim.state.v), G: sim.state.G, eps2: sim.state.eps2 },
    elapsed: sampler.x.slice(0, n),
    energyError: sampler.values.energyError.slice(0, n),
    angularMomentumError: sampler.values.angularMomentumError.slice(0, n),
    minSeparation: sampler.values.minSeparation.slice(0, n),
    steps: sim.counters.stepCount,
    forceEvals: sim.counters.forceEvals,
    failure: sim.failure,
  };
}

// ---- Lyapunov exponent ----------------------------------------------------------------------

export interface LyapunovSpec {
  state: SystemState;
  duration: number;
  period: number;
  /** The size of the shadow's offset, which is restored after every interval. Default 1e-8. */
  delta0?: number;
  /** How many intervals the duration is cut into. Default 400. */
  intervals?: number;
}

export interface LyapunovResult {
  /** The time since the start, and the running estimate of the largest Lyapunov exponent at that time. */
  times: Float64Array;
  exponent: Float64Array;
  /** The last estimate, and its reciprocal (the Lyapunov time), Infinity if the estimate is not positive. */
  final: number;
  lyapunovTime: number;
}

/**
 * The Benettin method (plan §9, stretch): a shadow trajectory offset by delta0, both run with IAS15,
 * and every interval the growth of their separation is added to a running sum of ln(d / delta0)
 * before the shadow is pulled back to distance delta0 along the line to the first. The running sum
 * over elapsed time converges to the largest Lyapunov exponent: positive for chaos, and falling
 * like ln(t)/t toward zero for a regular orbit. The separation is measured in all 18 position and
 * velocity components.
 */
export async function lyapunov(spec: LyapunovSpec, ctx: BatchContext = quietContext): Promise<LyapunovResult> {
  const { duration, period } = spec;
  const delta0 = spec.delta0 ?? 1e-8;
  const intervals = spec.intervals ?? 400;
  const params = { dt: period / 100, epsTol: 1e-10, dtMin: duration * 1e-9 };
  const a = new Simulation(spec.state, { integrator: 'ias15', params: { ...params }, load: { recenter: false } });
  const shadowStart = snapshot(spec.state);
  shadowStart.x[0] += delta0;
  const b = new Simulation(shadowStart, { integrator: 'ias15', params: { ...params }, load: { recenter: false } });

  const t0 = spec.state.t;
  const times = new Float64Array(intervals);
  const exponent = new Float64Array(intervals);
  const next = snapshot(spec.state);
  const sa = snapshot(spec.state);
  const sb = snapshot(spec.state);
  let sum = 0;
  let count = 0;
  for (let k = 1; k <= intervals; k++) {
    const t = t0 + (duration * k) / intervals;
    a.advanceTo(t, Infinity);
    b.advanceTo(t, Infinity);
    a.stateAt(t, sa);
    b.stateAt(t, sb);
    let d2 = 0;
    for (let i = 0; i < 9; i++) d2 += (sb.x[i] - sa.x[i]) ** 2 + (sb.v[i] - sa.v[i]) ** 2;
    const d = Math.sqrt(d2);
    if (!(d > 0) || a.failure !== null || b.failure !== null) break;
    sum += Math.log(d / delta0);
    count = k;
    times[k - 1] = t - t0;
    exponent[k - 1] = sum / (t - t0);
    // Restart both at time t, the shadow pulled back to delta0 away.
    const scale = delta0 / d;
    next.t = t;
    next.m.set(sa.m);
    next.G = sa.G;
    next.eps2 = sa.eps2;
    next.x.set(sa.x);
    next.v.set(sa.v);
    a.load(next, { recenter: false });
    for (let i = 0; i < 9; i++) {
      next.x[i] = sa.x[i] + (sb.x[i] - sa.x[i]) * scale;
      next.v[i] = sa.v[i] + (sb.v[i] - sa.v[i]) * scale;
    }
    b.load(next, { recenter: false });
    await between(ctx, k, intervals);
  }
  const final = count > 0 ? exponent[count - 1] : NaN;
  return {
    times: times.slice(0, count),
    exponent: exponent.slice(0, count),
    final,
    lyapunovTime: final > 0 ? 1 / final : Infinity,
  };
}
