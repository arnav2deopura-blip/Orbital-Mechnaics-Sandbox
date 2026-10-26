import { Cancelled, quietContext } from './batch';
import type { BatchContext } from './batch';
import { Simulation } from './simulation';
import { snapshot } from './state';
import type { SystemState } from './types';

// A live chaos probe (plan, phase 6). Starting from the run's initial state it follows two
// copies of the system, one pushed a tiny distance off, and measures how fast they separate: the
// Benettin estimate of the largest Lyapunov exponent, as in sim/batch.ts but incremental, so it
// can be fed a few milliseconds at a time between frames. It runs independently of the run on
// screen, ahead of it, so a verdict is usually ready before the orbit has done much.
//
// Both copies use IAS15, whatever method the run uses: the question is about the equations, not
// the method. Whenever the separation has grown by a factor e^RENORM_LN (or has gone
// RENORM_MAX_PERIODS without), the offset copy is pulled back to the original distance along the
// line to the first, so the offset stays tiny and the growth is that of the linearized flow.
//
// What the numbers mean (calibrated in tests/stress/physics.test.ts, "chaos census"): regular
// orbits separate linearly in time, so their finite-time exponent keeps falling like ln(t)/t;
// chaotic ones keep a steady positive exponent. Two bodies are integrable, so they are never
// probed: a very eccentric pair amplifies an offset enormously at each pericenter pass and would
// read as chaotic.

/** The size of the offset between the two copies, as a fraction of the system's size. */
export const OFFSET = 1e-8;
/** The probe samples the separation this often, as a fraction of T_char. */
const SAMPLE_PERIODS = 0.25;
/** The offset copy is pulled back once the separation has grown by e^RENORM_LN, or this long has passed. */
const RENORM_LN = 3;
const RENORM_MAX_PERIODS = 4;
/** The trailing window the current exponent is averaged over, in T_char. */
export const WINDOW_PERIODS = 8;
/** The probe stops after this much simulated time, in T_char, if it has not decided before. */
export const MAX_PERIODS = 48;
/** The probe gives up after this much wall time or this many integrator steps. It runs in a worker, so it may take its time. */
const MAX_WALL_MS = 30_000;
const MAX_STEPS = 6_000_000;

/** Lyapunov time below which a system counts as chaotic, and as very chaotic, in T_char. */
export const CHAOTIC_BELOW = 3;
export const VERY_CHAOTIC_BELOW = 1;
/** A verdict of chaos needs the separation to have grown this many e-folds within the trailing window. */
export const MIN_GROWTH_LN = 2;
/** Simulated time, in T_char, before any verdict is given; and how long a chaotic reading must hold before the probe stops early. */
export const MIN_PERIODS = 6;
const HOLD_PERIODS = 6;
/** Growth, in e-folds within the window, that no regular orbit reaches: the verdict is final at once. */
const DECISIVE_LN = 12;

export type ChaosState =
  /** Not probed (two bodies, or nothing massive to interact). */
  | 'off'
  | 'measuring'
  /** Probed to the end with no sign of chaos. This does not prove regularity: it says none was seen. */
  | 'regular'
  | 'chaotic'
  | 'very-chaotic'
  /** The probe could not finish: a close encounter it could not integrate, or it ran out of time. */
  | 'inconclusive';

export interface ChaosVerdict {
  state: ChaosState;
  /** Why the probe is off or inconclusive. */
  reason: string;
  /** The largest Lyapunov exponent estimate over the trailing window, per unit of simulated time. NaN until measured. */
  lambda: number;
  /** 1 / lambda in T_char (how many characteristic periods per factor-e of growth), Infinity when lambda is not positive, NaN until measured. */
  lyapunovPeriods: number;
  /** How much simulated time has been probed, in T_char. */
  probedPeriods: number;
  /** True when the probe has stopped for good. */
  done: boolean;
  /** How far the probe is from its end, 0 to 1 (by time: it may stop earlier if it decides). */
  progress: number;
}

/** Why a system is not probed at all, or null if it is. Two bodies are integrable; a lone massive body gives only Kepler orbits. */
export function chaosOffReason(state: SystemState, period: number, size: number): string | null {
  const massive = [0, 1, 2].slice(0, state.n).filter((i) => state.m[i] > 0).length;
  if (state.n === 2) return 'Two bodies always move on an exact conic: there is no chaos to find.';
  if (massive < 2) return 'With fewer than two massive bodies nothing interacts strongly enough to be chaotic.';
  if (!(period > 0) || !(size > 0) || !Number.isFinite(period + size)) return 'This system has no usable time or length scale.';
  return null;
}

export function createVerdict(): ChaosVerdict {
  return { state: 'off', reason: '', lambda: NaN, lyapunovPeriods: NaN, probedPeriods: 0, done: true, progress: 0 };
}

interface Segment {
  /** Time (since the start) at which the segment ended, its length, and the growth of the separation over it, as a log. */
  end: number;
  duration: number;
  growth: number;
}

/** Splitmix-style generator: deterministic, so one system always gets the same verdict. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return (t >>> 0) / 4294967296;
  };
}

export class ChaosMonitor {
  readonly verdict: ChaosVerdict = createVerdict();
  private a: Simulation | null = null;
  private b: Simulation | null = null;
  private period = 1;
  private offset = 0;
  private t0 = 0;
  /** Time since the start of the last sample and of the last renormalization, and the separation then. */
  private sampled = 0;
  private renormAt = 0;
  private segments: Segment[] = [];
  private growthNow = 0;
  private held = 0;
  private wallMs = 0;
  private readonly clock: () => number;
  private readonly sa = snapshot(emptyLike());
  private readonly sb = snapshot(emptyLike());
  private readonly next = snapshot(emptyLike());

  constructor(clock: () => number = () => performance.now()) {
    this.clock = clock;
  }

  /**
   * Starts probing `baseline`, the run's initial state, whose T_char is `period` and size
   * `size`. Forgets any earlier probe. Does nothing more than set up: tick() does the work.
   */
  start(baseline: SystemState, period: number, size: number): void {
    const v = this.verdict;
    this.a = this.b = null;
    this.segments = [];
    this.sampled = this.renormAt = this.growthNow = this.held = this.wallMs = 0;
    v.lambda = NaN;
    v.lyapunovPeriods = NaN;
    v.probedPeriods = 0;
    v.progress = 0;

    const off = chaosOffReason(baseline, period, size);
    if (off !== null) return this.stop('off', off);

    this.period = period;
    this.offset = OFFSET * size;
    this.segmentStartSeparation = this.offset;
    this.t0 = baseline.t;
    const params = { dt: period / 100, epsTol: 1e-10, dtMin: period * 1e-8 };
    this.a = new Simulation(snapshot(baseline), { integrator: 'ias15', params: { ...params }, load: { recenter: false, period }, clock: this.clock });
    const rng = seeded(20260101);
    const shadow = snapshot(baseline);
    const z = 2 * rng() - 1;
    const phi = 2 * Math.PI * rng();
    const r = Math.sqrt(1 - z * z);
    // Push the first massive body: a massless one would be a legitimate choice too, but then a regular orbit of the others hides it.
    const body = [0, 1, 2].find((i) => baseline.m[i] > 0) ?? 0;
    shadow.x[3 * body] += this.offset * r * Math.cos(phi);
    shadow.x[3 * body + 1] += this.offset * r * Math.sin(phi);
    shadow.x[3 * body + 2] += this.offset * z;
    this.b = new Simulation(shadow, { integrator: 'ias15', params: { ...params }, load: { recenter: false, period }, clock: this.clock });
    v.state = 'measuring';
    v.reason = '';
    v.done = false;
  }

  /** Stops probing for good with the given verdict. */
  private stop(state: ChaosState, reason: string): void {
    const v = this.verdict;
    v.state = state;
    v.reason = reason;
    v.done = true;
    v.progress = 1;
    this.a = this.b = null;
  }

  /** Abandons the probe without a verdict (a new run is starting, or the probe is no longer wanted). */
  cancel(): void {
    this.a = this.b = null;
    this.verdict.state = 'off';
    this.verdict.reason = '';
    this.verdict.done = true;
    this.verdict.progress = 0;
  }

  /** Works for at most budgetMs, and returns true while there is more to do. */
  tick(budgetMs: number): boolean {
    const { a, b } = this;
    if (a === null || b === null || this.verdict.done) return false;
    const begin = this.clock();
    const deadline = begin + budgetMs;
    while (this.clock() < deadline) {
      const t = this.t0 + this.sampled + SAMPLE_PERIODS * this.period;
      const reached = advance(a, t, deadline) && advance(b, t, deadline);
      if (a.failure !== null || b.failure !== null) {
        this.wallMs += this.clock() - begin;
        this.finish('the integrator could not follow a close encounter');
        return !this.verdict.done;
      }
      if (!reached) break;
      this.sample(t);
      if (this.verdict.done) break;
    }
    this.wallMs += this.clock() - begin;
    if (!this.verdict.done && (this.wallMs > MAX_WALL_MS || a.counters.stepCount + b.counters.stepCount > MAX_STEPS)) {
      this.finish('it took too long to follow this system');
    }
    return !this.verdict.done;
  }

  /** Runs the probe to its end, for tests and one-off analyses. */
  runToEnd(): ChaosVerdict {
    while (this.tick(1000)) {
      /* keep going */
    }
    return this.verdict;
  }

  private sample(t: number): void {
    const a = this.a as Simulation;
    const b = this.b as Simulation;
    const { sa, sb } = this;
    a.stateAt(t, sa);
    b.stateAt(t, sb);
    let d2 = 0;
    for (let i = 0; i < 9; i++) d2 += (sb.x[i] - sa.x[i]) ** 2 + (sb.v[i] - sa.v[i]) ** 2;
    const d = Math.sqrt(d2);
    if (!(d > 0) || !Number.isFinite(d)) {
      this.finish('the two copies became indistinguishable or non-finite');
      return;
    }
    // Separation relative to the offset it was last pulled back to.
    const ref = this.segmentStartSeparation;
    const growth = Math.log(d / ref);
    this.sampled += SAMPLE_PERIODS * this.period;
    this.growthNow = growth;
    const elapsed = this.sampled - this.renormAt;
    if (growth >= RENORM_LN || elapsed >= RENORM_MAX_PERIODS * this.period) {
      this.segments.push({ end: this.sampled, duration: elapsed, growth });
      this.renormAt = this.sampled;
      this.growthNow = 0;
      this.restart(t, d);
    }
    this.update();
  }

  private segmentStartSeparation = OFFSET;

  /** Restarts both copies from time t, the second pulled back to the offset along the line from the first. */
  private restart(t: number, d: number): void {
    const a = this.a as Simulation;
    const b = this.b as Simulation;
    const { sa, sb, next } = this;
    const scale = this.offset / d;
    this.segmentStartSeparation = this.offset;
    // The first guess for the new step is the one the integrator had settled on, not the original.
    a.params.dt = a.currentDt();
    b.params.dt = b.currentDt();
    next.t = t;
    next.m.set(sa.m);
    next.G = sa.G;
    next.eps2 = sa.eps2;
    next.n = sa.n;
    next.x.set(sa.x);
    next.v.set(sa.v);
    a.load(next, { recenter: false, period: this.period });
    for (let i = 0; i < 9; i++) {
      next.x[i] = sa.x[i] + (sb.x[i] - sa.x[i]) * scale;
      next.v[i] = sa.v[i] + (sb.v[i] - sa.v[i]) * scale;
    }
    b.load(next, { recenter: false, period: this.period });
  }

  /** The exponent over the trailing window: the growth of the segments that end in it plus the current one, over their length. */
  private windowRate(): { rate: number; growth: number } {
    const now = this.sampled;
    const from = now - WINDOW_PERIODS * this.period;
    let growth = this.growthNow;
    let time = now - this.renormAt;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (s.end <= from) break;
      growth += s.growth;
      time += s.duration;
    }
    return { rate: time > 0 ? growth / time : NaN, growth };
  }

  private update(): void {
    const v = this.verdict;
    const probed = this.sampled / this.period;
    v.probedPeriods = probed;
    v.progress = Math.min(probed / MAX_PERIODS, 1);
    const { rate, growth } = this.windowRate();
    v.lambda = rate;
    v.lyapunovPeriods = rate > 0 ? 1 / (rate * this.period) : Infinity;
    if (probed < MIN_PERIODS) return;

    const periods = v.lyapunovPeriods;
    let state: ChaosState = 'measuring';
    if (growth >= MIN_GROWTH_LN) {
      if (periods < VERY_CHAOTIC_BELOW) state = 'very-chaotic';
      else if (periods < CHAOTIC_BELOW) state = 'chaotic';
    }
    if (state === 'chaotic' || state === 'very-chaotic') {
      this.held = state === v.state ? this.held + SAMPLE_PERIODS : 0;
      v.state = state;
      if (this.held >= HOLD_PERIODS || growth >= DECISIVE_LN) this.stop(state, '');
      return;
    }
    this.held = 0;
    v.state = 'measuring';
    if (probed >= MAX_PERIODS) this.stop('regular', '');
  }

  /** Ends the probe early: with what has been seen if that is decisive, otherwise as inconclusive. */
  private finish(reason: string): void {
    const v = this.verdict;
    if (v.state === 'chaotic' || v.state === 'very-chaotic') this.stop(v.state, '');
    else this.stop('inconclusive', reason);
  }
}

/**
 * Advances sim to t, riding out the stops it asks for (a close-encounter or health notice
 * is meant for the run on screen, not for the probe). False if the deadline came first.
 */
function advance(sim: Simulation, t: number, deadline: number): boolean {
  for (;;) {
    const status = sim.advanceTo(t, deadline).status;
    if (status === 'reached') return true;
    if (status === 'budget' || status === 'failed') return false;
  }
}

function emptyLike(): SystemState {
  return { n: 3, t: 0, m: new Float64Array(3), x: new Float64Array(9), v: new Float64Array(9), G: 1, eps2: 0 };
}

/**
 * The time, in the same units as the Lyapunov time, until an error of relative size `epsilon`
 * has grown to a tenth of the system: the predictability horizon. After it a path on screen is one
 * of many equally valid ones, not a prediction. Infinity if there is no growth.
 */
export function predictabilityHorizon(lyapunovTime: number, epsilon: number): number {
  const eps = Math.max(epsilon, 1e-16);
  return lyapunovTime * Math.log(0.1 / eps);
}

/** What the worker is given: the run's initial state, and its T_char and size. */
export interface ChaosSpec {
  state: SystemState;
  period: number;
  size: number;
}

/** The probe as a batch job: runs to its end between yields to the host, so a cancel can get in. */
export async function chaosProbe(spec: ChaosSpec, ctx: BatchContext = quietContext): Promise<ChaosVerdict> {
  const monitor = new ChaosMonitor();
  monitor.start(spec.state, spec.period, spec.size);
  while (monitor.tick(40)) {
    if (ctx.cancelled()) throw new Cancelled();
    ctx.progress(monitor.verdict.progress);
    await ctx.yield();
  }
  return { ...monitor.verdict };
}
