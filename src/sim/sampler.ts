import { angularMomentumError, energyError, momentumError } from './diagnostics';
import type { Simulation } from './simulation';

// The diagnostic history behind the charts (plan §6): one sample per fixed amount of sim time,
// taken from true integrator states, stored in fixed ring buffers. When a buffer fills, adjacent
// samples are merged 2:1, so a long run keeps its overall shape at coarser resolution. Merging
// keeps the extreme that matters for each series (the largest error, the smallest separation),
// so a spike never disappears by being averaged away.

export type SeriesKey =
  | 'energyError'
  | 'angularMomentumError'
  | 'momentumError'
  | 'comDrift'
  | 'minSeparation'
  | 'dt'
  | 'forceEvals'
  | 'analyticError'
  | 'divergence';

export interface SeriesSpec {
  key: SeriesKey;
  label: string;
  /** Plotted on a log axis. */
  log: boolean;
  /** How two samples merge when the buffer is thinned. */
  merge: 'max' | 'min' | 'last';
  /** Why it is worth looking at. */
  hint: string;
}

export const SERIES: readonly SeriesSpec[] = [
  { key: 'energyError', label: 'Energy error |E - E0| / |E0|', log: true, merge: 'max', hint: 'Bounded oscillation means a symplectic method. Linear growth is RK4-style drift. Exponential growth or a jump is Euler or an unresolved encounter. Growth like the square root of time is IAS15 roundoff.' },
  { key: 'angularMomentumError', label: 'Angular momentum error |L - L0| / L_scale', log: true, merge: 'max', hint: 'Conserved to roundoff by every method here, since the force is pairwise and central. A rise points to a bug, or to softening that is not central.' },
  { key: 'momentumError', label: 'Momentum error |P - P0|', log: true, merge: 'max', hint: 'Conserved to roundoff by every method.' },
  { key: 'comDrift', label: 'Center of mass drift', log: true, merge: 'max', hint: 'How far the center of mass has moved since the start: zero when the total momentum is zero.' },
  { key: 'minSeparation', label: 'Closest pair distance', log: true, merge: 'min', hint: 'Dips explain energy spikes and shrinking IAS15 steps: a close encounter.' },
  { key: 'dt', label: 'Step size taken', log: true, merge: 'min', hint: 'Constant for fixed-step methods. IAS15 shrinks it near close encounters.' },
  { key: 'forceEvals', label: 'Force evaluations (cumulative)', log: false, merge: 'last', hint: 'The cost, for comparing methods fairly.' },
  { key: 'analyticError', label: 'Error against the exact Kepler solution', log: true, merge: 'max', hint: 'Only when the orbit has a closed form: two bodies, or three with one massless.' },
  { key: 'divergence', label: 'Divergence from the twin (largest body offset)', log: true, merge: 'max', hint: 'Comparison mode only. Exponential growth is chaos: a nearby start separates at a rate set by the Lyapunov time. Steady growth is two methods disagreeing.' },
];

const KEYS: SeriesKey[] = SERIES.map((spec) => spec.key);

export interface Marker {
  /** Elapsed time at the marker. */
  x: number;
  label: string;
}

const MAX_MARKERS = 64;
/** Samples per T_char by default (plan §6). */
export const DEFAULT_SAMPLES_PER_PERIOD = 200;

/** Merges two values, ignoring a NaN (a series that does not apply). */
function merge(how: SeriesSpec['merge'], a: number, b: number): number {
  if (a !== a) return b;
  if (b !== b) return a;
  return how === 'max' ? Math.max(a, b) : how === 'min' ? Math.min(a, b) : b;
}

export class Sampler {
  /** How many bodies the trajectory has: 2 or 3. Read from the system at each sample. */
  bodies = 3;
  /** Time between samples, in sim time. */
  interval = 1;
  /** Samples stored. */
  length = 0;
  /**
   * How far the comparison twin is from this run, set by whoever runs the comparison, about once
   * a frame. Samples take the latest value, so at high speed several share one. NaN: no twin.
   */
  divergence = NaN;
  /** Bumped whenever the data changes, so a chart can tell it needs to redraw. */
  version = 0;
  /**
   * Elapsed time of each sample: the sum of the sizes of the steps taken since the start, so it
   * only grows, even when the run is reversed. (Plotting against t itself would fold back.)
   */
  readonly x: Float64Array;
  readonly values: Record<SeriesKey, Float64Array>;
  /** The sim time of each sample (signed, unlike the elapsed time) and the nine coordinates there, for exporting the trajectory. */
  readonly time: Float64Array;
  readonly positions: Float64Array;
  readonly markers: Marker[] = [];

  private readonly capacity: number;
  /** Raw samples folded into each stored one: doubles every time the buffer is thinned. */
  private stride = 1;
  private binCount = 0;
  private readonly bin: Record<SeriesKey, number>;
  /** The latest measurement, reused so sampling allocates nothing. */
  private readonly latest: Record<SeriesKey, number>;
  private binX = 0;
  private binTime = 0;
  private readonly binPositions = new Float64Array(9);
  private elapsed = 0;
  private lastT = 0;
  private lastSampleElapsed = 0;
  private started = false;
  private readonly com0 = new Float64Array(3);

  constructor(capacity = 20000) {
    this.capacity = Math.max(4, capacity - (capacity % 2));
    this.x = new Float64Array(this.capacity);
    this.time = new Float64Array(this.capacity);
    this.positions = new Float64Array(9 * this.capacity);
    this.values = Object.fromEntries(KEYS.map((key) => [key, new Float64Array(this.capacity)])) as Record<SeriesKey, Float64Array>;
    this.bin = Object.fromEntries(KEYS.map((key) => [key, NaN])) as Record<SeriesKey, number>;
    this.latest = Object.fromEntries(KEYS.map((key) => [key, NaN])) as Record<SeriesKey, number>;
  }

  /** Forgets everything and sets the sampling interval to period / samplesPerPeriod. */
  clear(period: number, samplesPerPeriod = DEFAULT_SAMPLES_PER_PERIOD): void {
    this.interval = period / samplesPerPeriod;
    this.length = 0;
    this.stride = 1;
    this.binCount = 0;
    this.elapsed = 0;
    this.lastSampleElapsed = 0;
    this.started = false;
    this.markers.length = 0;
    this.version++;
  }

  /** Marks the time axis at the current elapsed time (an integrator switch, a reversal, an event). */
  mark(label: string): void {
    if (this.markers.length >= MAX_MARKERS) this.markers.shift();
    this.markers.push({ x: this.elapsed, label });
    this.version++;
  }

  /**
   * Call after each accepted step. Takes a sample when the sim time elapsed since the last one
   * reaches the interval, so the cost between samples is a subtraction and a comparison.
   */
  record(sim: Simulation): void {
    const t = sim.state.t;
    if (!this.started) {
      this.started = true;
      this.lastT = t;
      this.lastSampleElapsed = 0;
      this.sample(sim, true);
      return;
    }
    this.elapsed += Math.abs(t - this.lastT);
    this.lastT = t;
    // The factor forgives the roundoff of adding up equal steps: five steps of T/1000 are not quite T/200.
    if (this.elapsed - this.lastSampleElapsed < this.interval * (1 - 1e-9)) return;
    this.lastSampleElapsed = this.elapsed;
    this.sample(sim, false);
  }

  /** Measures the true state into the open bin, and closes the bin once it holds `stride` samples. */
  private sample(sim: Simulation, first: boolean): void {
    this.bodies = sim.state.n;
    const d = sim.refreshDiagnostics();
    const ref = sim.reference;
    if (first) this.com0.set(d.com);
    const value = this.latest;
    value.energyError = energyError(d, ref);
    value.angularMomentumError = angularMomentumError(d, ref);
    value.momentumError = momentumError(d, ref);
    value.comDrift = Math.hypot(d.com[0] - this.com0[0], d.com[1] - this.com0[1], d.com[2] - this.com0[2]);
    value.minSeparation = d.minSeparation;
    value.dt = Math.abs(sim.state.t - sim.prev.t) || sim.currentDt(); // no step yet: the one it will take
    value.forceEvals = sim.counters.forceEvals;
    value.analyticError = sim.analyticError();
    value.divergence = this.divergence;
    const bin = this.bin;
    for (const spec of SERIES) {
      bin[spec.key] = this.binCount === 0 ? value[spec.key] : merge(spec.merge, bin[spec.key], value[spec.key]);
    }
    this.binX = this.elapsed;
    this.binTime = sim.state.t;
    this.binPositions.set(sim.state.x);
    if (++this.binCount < this.stride) return;
    this.binCount = 0;
    this.push();
  }

  /** Appends the finished bin, thinning the buffer first if it is full. */
  private push(): void {
    if (this.length === this.capacity) this.thin();
    const i = this.length++;
    this.x[i] = this.binX;
    this.time[i] = this.binTime;
    this.positions.set(this.binPositions, 9 * i);
    for (const key of KEYS) this.values[key][i] = this.bin[key];
    this.version++;
  }

  /** Merges adjacent pairs 2:1, in place, and doubles the stride so later samples match. */
  private thin(): void {
    const half = this.capacity / 2;
    for (let i = 0; i < half; i++) {
      this.x[i] = this.x[2 * i + 1];
      this.time[i] = this.time[2 * i + 1];
      this.positions.copyWithin(9 * i, 9 * (2 * i + 1), 9 * (2 * i + 2));
      for (const spec of SERIES) {
        const v = this.values[spec.key];
        v[i] = merge(spec.merge, v[2 * i], v[2 * i + 1]);
      }
    }
    this.length = half;
    this.stride *= 2;
  }

  /** Whether a series has any data: the analytic error has none unless one body is massless. */
  has(key: SeriesKey): boolean {
    const v = this.values[key];
    for (let i = 0; i < this.length; i++) if (v[i] === v[i]) return true;
    return false;
  }

  /** The trajectory at the sample times as CSV: elapsed time, sim time, then x, y, z of each body (plan §7.8). */
  toTrajectoryCsv(): string {
    const header = ['elapsed_time', 't'];
    for (let b = 1; b <= this.bodies; b++) for (const axis of ['x', 'y', 'z']) header.push(`${axis}${b}`);
    const rows = [header.join(',')];
    for (let i = 0; i < this.length; i++) {
      rows.push([this.x[i], this.time[i], ...this.positions.subarray(9 * i, 9 * i + 3 * this.bodies)].join(','));
    }
    return rows.join('\n') + '\n';
  }

  /** The history as CSV: elapsed time, then every series that has data (plan §7.8). */
  toCsv(): string {
    const keys = KEYS.filter((key) => this.has(key));
    const rows = ['elapsed_time,' + keys.join(',')];
    for (let i = 0; i < this.length; i++) {
      rows.push([this.x[i], ...keys.map((key) => this.values[key][i])].join(','));
    }
    return rows.join('\n') + '\n';
  }
}
