import { computeAccel } from '../sim/forces';
import { Simulation } from '../sim/simulation';
import { createState } from '../sim/state';
import type { SystemState } from '../sim/types';

// The periodicity test of plan §10 (test 7 and 8): integrate with IAS15 at a tight tolerance, look
// in a window around the claimed period for the time the state comes closest to where it started,
// and report that time and how close. A preset that claims a period is `verified` only if this
// agrees. The distance is the largest difference in any position or velocity component, in the
// COM frame.

export interface ReturnCheck {
  /** The time in the window at which the state is closest to the initial one. */
  returnTime: number;
  /** That closest approach, in phase space. */
  distance: number;
  /** The distance at exactly the claimed period. */
  distanceAtPeriod: number;
}

export interface ReturnOptions {
  /** Half the width of the window, as a fraction of the period. Default 2%. */
  window?: number;
  /** Points tried across the window. Default 400. */
  samples?: number;
  epsTol?: number;
  /** Only compare the first this-many bodies (2 for a pair with a massless third body). Default 3. */
  bodies?: 2 | 3;
}

/**
 * Where a system next comes back to its start, near `period`. `initial` is not modified.
 * The tolerance is 1e-10, not the 1e-12 of the slider's floor: near the roundoff of IAS15's error estimate the step collapses
 * (see ias15.ts), and 1e-10 is already accurate to about 1e-12 per period. The step is floored at 1e-7 of the period, so an
 * orbit with an unresolved encounter ends rather than hangs.
 */
export function returnCheck(initial: SystemState, period: number, options: ReturnOptions = {}): ReturnCheck {
  const { window = 0.02, samples = 400, epsTol = 1e-10, bodies = 3 } = options;
  const sim = new Simulation(initial, {
    integrator: 'ias15',
    params: { dt: period / 200, epsTol, dtMin: period * 1e-7 },
  });
  const start = sim.baselineSnapshot();
  const n = 3 * bodies;
  const drawn = sim.baselineSnapshot();
  const distance = (): number => {
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(drawn.x[i] - start.x[i]), Math.abs(drawn.v[i] - start.v[i]));
    return worst;
  };

  const t0 = period * (1 - window);
  sim.advanceTo(t0, Infinity);
  let best = { returnTime: t0, distance: Infinity };
  for (let k = 0; k <= samples; k++) {
    const t = t0 + (2 * window * period * k) / samples;
    sim.advanceTo(t, Infinity);
    sim.stateAt(t, drawn);
    const d = distance();
    if (d < best.distance) best = { returnTime: t, distance: d };
  }
  sim.reset();
  sim.advanceTo(period, Infinity);
  sim.stateAt(period, drawn);
  return { ...best, distanceAtPeriod: distance() };
}

// ---- refining initial conditions ------------------------------------------------------------

export interface RefineResult {
  p1: number;
  p2: number;
  /** The refined period. */
  period: number;
  /** The largest planar position or velocity difference after one period. */
  residual: number;
  iterations: number;
}

/** The standard start of the planar, zero-angular-momentum orbits of Šuvakov & Dmitrašinović 2013: x1 = -x2 = (-1, 0), x3 = 0, v1 = v2 = (p1, p2), v3 = -2 (p1, p2), G = m = 1. */
export function symmetricStart(p1: number, p2: number): SystemState {
  const s = createState();
  s.m.set([1, 1, 1]);
  s.x.set([-1, 0, 0, 1, 0, 0, 0, 0, 0]);
  s.v.set([p1, p2, 0, p1, p2, 0, -2 * p1, -2 * p2, 0]);
  return s;
}

/** The planar components: x and y of each body, positions then velocities. */
const PLANAR = [0, 1, 3, 4, 6, 7];

/** The difference after time T from the start p1, p2, in the 12 planar components, and the state's acceleration there. */
function shoot(p1: number, p2: number, T: number, epsTol: number): { r: Float64Array; ok: boolean } {
  const start = symmetricStart(p1, p2);
  const sim = new Simulation(start, { integrator: 'ias15', params: { dt: T / 200, epsTol, dtMin: T * 1e-7 }, load: { recenter: false } });
  const r = new Float64Array(12);
  sim.advanceTo(T, Infinity);
  const out = sim.baselineSnapshot();
  sim.stateAt(T, out);
  const a = new Float64Array(9);
  computeAccel(out, out.x, a);
  PLANAR.forEach((i, k) => {
    r[k] = out.x[i] - start.x[i];
    r[6 + k] = out.v[i] - start.v[i];
  });
  // d(state)/dT = (v, a): the exact derivative of the end state with respect to the period.
  rates.x.set(out.v);
  rates.v.set(a);
  return { r, ok: sim.failure === null };
}
const rates = { x: new Float64Array(9), v: new Float64Array(9) };

/**
 * Refines a symmetric periodic orbit's initial velocity (p1, p2) and period T by Gauss-Newton on
 * the 12 planar components of "the state after T minus the start" (damped, with a finite-
 * difference Jacobian in p1 and p2 and the exact derivative in T). Starting from the published
 * 5-digit values of Šuvakov & Dmitrašinović this reaches closure at the integrator's accuracy,
 * about 1e-10: the many-digit values the orbits need to stay periodic for many periods.
 */
export function refineSymmetricOrbit(
  p1: number,
  p2: number,
  period: number,
  options: { epsTol?: number; maxIterations?: number; tolerance?: number } = {},
): RefineResult {
  const { epsTol = 1e-10, maxIterations = 30, tolerance = 1e-10 } = options;
  let theta = [p1, p2, period];
  const first = shoot(theta[0], theta[1], theta[2], epsTol);
  let r = first.r;
  let norm = first.ok ? Math.max(...r.map(Math.abs)) : Infinity;
  let lambda = 1e-9;
  let iterations = 0;

  for (; iterations < maxIterations && norm > tolerance; iterations++) {
    // Jacobian columns: forward differences in p1 and p2, and (v, a) for T.
    const columns: Float64Array[] = [];
    for (const k of [0, 1]) {
      const h = 1e-7;
      const bumped = [...theta];
      bumped[k] += h;
      const { r: rb } = shoot(bumped[0], bumped[1], bumped[2], epsTol);
      columns.push(rb.map((v, i) => (v - r[i]) / h));
    }
    shoot(theta[0], theta[1], theta[2], epsTol); // refreshes `rates` at the base point
    const dT = new Float64Array(12);
    PLANAR.forEach((i, k) => {
      dT[k] = rates.x[i];
      dT[6 + k] = rates.v[i];
    });
    columns.push(dT);

    // Normal equations (J^T J + lambda diag) delta = -J^T r, solved by Gaussian elimination.
    const A = [0, 1, 2].map((a) => [0, 1, 2].map((b) => columns[a].reduce((s, v, i) => s + v * columns[b][i], 0)));
    const g = [0, 1, 2].map((a) => -columns[a].reduce((s, v, i) => s + v * r[i], 0));
    let improved = false;
    for (let attempt = 0; attempt < 12 && !improved; attempt++) {
      const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-30 : v)));
      const delta = solve3(M, g);
      const trial = theta.map((v, i) => v + delta[i]);
      const result = shoot(trial[0], trial[1], trial[2], epsTol);
      const trialNorm = result.ok ? Math.max(...result.r.map(Math.abs)) : Infinity;
      if (trialNorm < norm) {
        theta = trial;
        r = result.r;
        norm = trialNorm;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
      } else {
        lambda *= 10;
      }
    }
    if (!improved) break;
  }
  return { p1: theta[0], p2: theta[1], period: theta[2], residual: norm, iterations };
}

/** Solves the 3x3 system M x = b by Gaussian elimination with partial pivoting. */
function solve3(M: number[][], b: number[]): number[] {
  const a = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    for (let r = c + 1; r < 3; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = a[r][3];
    for (let k = r + 1; k < 3; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}
