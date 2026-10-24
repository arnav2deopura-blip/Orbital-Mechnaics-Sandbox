// Shared test fixtures and independent reference solutions. The analytic Kepler solutions
// here solve Kepler's equation by bisection, sharing no code with src/sim/kepler.ts.
import { jacobiToInertial } from '../src/sim/coords';
import { potentialEnergy } from '../src/sim/forces';
import { createState } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';

/** Deterministic PRNG (mulberry32), so a failure reproduces. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- analytic Kepler orbits (pericenter along +x, in the xy-plane) -----------------------

export interface Orbit {
  r: number[];
  v: number[];
}

/** State on a conic with semi-major axis a (positive for both ellipses and hyperbolas) at true anomaly f. */
function conicState(mu: number, p: number, e: number, f: number): Orbit {
  const r = p / (1 + e * Math.cos(f));
  const k = Math.sqrt(mu / p);
  return { r: [r * Math.cos(f), r * Math.sin(f), 0], v: [-k * Math.sin(f), k * (e + Math.cos(f)), 0] };
}

export const ellipseState = (mu: number, a: number, e: number, f: number): Orbit =>
  conicState(mu, a * (1 - e * e), e, f);

export const hyperbolaState = (mu: number, a: number, e: number, f: number): Orbit =>
  conicState(mu, a * (e * e - 1), e, f);

/** Root of g (increasing) in [lo, hi] by bisection. */
function bisect(g: (x: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (g(mid) < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** The ellipse of ellipseState(mu, a, e, f0) a time t later (either sign), via Kepler's equation. */
export function ellipseAt(mu: number, a: number, e: number, f0: number, t: number): Orbit {
  const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(f0 / 2), Math.sqrt(1 + e) * Math.cos(f0 / 2));
  const n = Math.sqrt(mu / a ** 3);
  const twoPi = 2 * Math.PI;
  const M = ((((E0 - e * Math.sin(E0) + n * t + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
  const E = bisect((x) => x - e * Math.sin(x) - M, M - e - 1e-9, M + e + 1e-9);
  const r = a * (1 - e * Math.cos(E));
  const rate = (n * a) / r; // dE/dt
  const b = a * Math.sqrt(1 - e * e);
  return { r: [a * (Math.cos(E) - e), b * Math.sin(E), 0], v: [-a * Math.sin(E) * rate, b * Math.cos(E) * rate, 0] };
}

/** The hyperbola of hyperbolaState(mu, a, e, f0) a time t later, via the hyperbolic Kepler equation. */
export function hyperbolaAt(mu: number, a: number, e: number, f0: number, t: number): Orbit {
  const H0 = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(f0 / 2));
  const n = Math.sqrt(mu / a ** 3);
  const M = e * Math.sinh(H0) - H0 + n * t;
  const X = 2 + Math.abs(M) + Math.abs(H0);
  const H = bisect((x) => e * Math.sinh(x) - x - M, -X, X);
  const r = a * (e * Math.cosh(H) - 1);
  const rate = (n * a) / r; // dH/dt
  const b = a * Math.sqrt(e * e - 1);
  return { r: [a * (e - Math.cosh(H)), b * Math.sinh(H), 0], v: [-a * Math.sinh(H) * rate, b * Math.cosh(H) * rate, 0] };
}

/** Parabola with pericenter distance q, started at pericenter, a time t later (Barker's equation). */
export function parabolaAt(mu: number, q: number, t: number): Orbit {
  const scale = Math.sqrt((2 * q ** 3) / mu);
  const T = t / scale; // T = D + D^3 / 3 with D = tan(f / 2)
  const s = Math.sqrt(1 + 2.25 * T * T);
  const D = Math.cbrt(1.5 * T + s) + Math.cbrt(1.5 * T - s);
  const Ddot = 1 / (scale * (1 + D * D));
  return { r: [q * (1 - D * D), 2 * q * D, 0], v: [-2 * q * D * Ddot, 2 * q * Ddot, 0] };
}

// ---- three-body fixtures -----------------------------------------------------------------

/**
 * Bodies 0 and 1 on a Kepler orbit with a = 1 and the given eccentricity, in the COM frame
 * (G = 1), starting at true anomaly f0. Body 2 is a massless test particle on a distant
 * circular orbit, so it cannot disturb the pair and never has a close encounter.
 * After exactly one period T the pair returns to its initial state, which gives an exact
 * reference for the global error.
 *
 * f0 defaults to 1 rad, not 0 (pericenter). Pericenter is a symmetric point where the
 * first-order phase error of symplectic Euler cancels, so it converges at order 2 from
 * there and would hide its true order.
 */
export function kepler(e = 0.5, f0 = 1, mA = 1, mB = 0.3): { s: SystemState; T: number } {
  const M = mA + mB;
  const { r, v } = ellipseState(M, 1, e, f0);
  const s = createState();
  s.m.set([mA, mB, 0]);
  s.x.set([-(mB / M) * r[0], -(mB / M) * r[1], 0, (mA / M) * r[0], (mA / M) * r[1], 0, 50, 0, 0]);
  s.v.set([-(mB / M) * v[0], -(mB / M) * v[1], 0, (mA / M) * v[0], (mA / M) * v[1], 0, 0, Math.sqrt(M / 50), 0]);
  return { s, T: 2 * Math.PI * Math.sqrt(1 / M) };
}

/** The pair of kepler(e, f0, mA, mB) a time t later, exactly. Body 2 is left at its start. */
export function keplerExact(e: number, f0: number, t: number, mA = 1, mB = 0.3): SystemState {
  const M = mA + mB;
  const { r, v } = ellipseAt(M, 1, e, f0, t);
  const s = kepler(e, f0, mA, mB).s;
  for (let c = 0; c < 3; c++) {
    s.x[c] = -(mB / M) * r[c];
    s.x[3 + c] = (mA / M) * r[c];
    s.v[c] = -(mB / M) * v[c];
    s.v[3 + c] = (mA / M) * v[c];
  }
  s.t = t;
  return s;
}

/**
 * A star (mass 1) with two planets (1e-3 each), the inner on a = 1, e = 0.1 and the outer
 * on a = 3, e = 0.05 tilted by 0.2 rad. Each orbit is Keplerian in Jacobi coordinates, the
 * natural starting point for WH. G = 1, COM at rest at the origin. T1 is the inner period.
 */
export function hierarchical(): { s: SystemState; T1: number } {
  const m = [1, 1e-3, 1e-3];
  const eta1 = m[0] + m[1];
  const inner = ellipseState(eta1, 1, 0.1, 1);
  const outer = ellipseState(eta1 + m[2], 3, 0.05, 2);
  const tilt = 0.2;
  const tiltX = ([x, y]: number[]): number[] => [x, y * Math.cos(tilt), y * Math.sin(tilt)];
  const s = createState();
  s.m.set(m);
  jacobiToInertial(s.m, Float64Array.from([0, 0, 0, ...inner.r, ...tiltX(outer.r)]), s.x);
  jacobiToInertial(s.m, Float64Array.from([0, 0, 0, ...inner.v, ...tiltX(outer.v)]), s.v);
  return { s, T1: 2 * Math.PI * Math.sqrt(1 / eta1) };
}

/** The system with body k of the result being body order[k] of s. */
export function permute(s: SystemState, order: number[]): SystemState {
  const out = createState(s.G, s.eps2);
  out.t = s.t;
  order.forEach((src, k) => {
    out.m[k] = s.m[src];
    for (let c = 0; c < 3; c++) {
      out.x[3 * k + c] = s.x[3 * src + c];
      out.v[3 * k + c] = s.v[3 * src + c];
    }
  });
  return out;
}

export const invertOrder = (order: number[]): number[] => order.map((_, i) => order.indexOf(i));

// ---- diagnostics -------------------------------------------------------------------------

export function energy(s: SystemState): number {
  let k = 0;
  for (let i = 0; i < 3; i++) k += 0.5 * s.m[i] * (s.v[3 * i] ** 2 + s.v[3 * i + 1] ** 2 + s.v[3 * i + 2] ** 2);
  return k + potentialEnergy(s);
}

export function angularMomentum(s: SystemState): number[] {
  const L = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const [x, y, z] = [s.x[3 * i], s.x[3 * i + 1], s.x[3 * i + 2]];
    const [vx, vy, vz] = [s.v[3 * i], s.v[3 * i + 1], s.v[3 * i + 2]];
    L[0] += s.m[i] * (y * vz - z * vy);
    L[1] += s.m[i] * (z * vx - x * vz);
    L[2] += s.m[i] * (x * vy - y * vx);
  }
  return L;
}

/** sum m_i |x_i||v_i|, the plan's normalizer for angular momentum (§3.2). */
export function lScale(s: SystemState): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += s.m[i] * Math.hypot(s.x[3 * i], s.x[3 * i + 1], s.x[3 * i + 2]) * Math.hypot(s.v[3 * i], s.v[3 * i + 1], s.v[3 * i + 2]);
  }
  return sum;
}

export function momentum(s: SystemState): number[] {
  const P = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) P[c] += s.m[i] * s.v[3 * i + c];
  return P;
}

export const norm = (a: number[], b: number[]): number => Math.hypot(...a.map((c, i) => c - b[i]));

/** Largest component difference over the first two bodies' positions and velocities. */
export function pairError(s: SystemState, ref: SystemState): number {
  let worst = 0;
  for (let i = 0; i < 6; i++) worst = Math.max(worst, Math.abs(s.x[i] - ref.x[i]), Math.abs(s.v[i] - ref.v[i]));
  return worst;
}

/** Largest component difference over all three bodies' positions and velocities. */
export function stateError(s: SystemState, ref: SystemState): number {
  let worst = 0;
  for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(s.x[i] - ref.x[i]), Math.abs(s.v[i] - ref.v[i]));
  return worst;
}
