import { potentialEnergy } from './forces';
import type { SystemState } from './types';

// Diagnostics (plan §3.2, §6): the conserved quantities, the reference values they are judged
// against, and the scales that make the errors meaningful. Everything is computed from true
// integrator states, never interpolated ones.

/** Below this fraction of K + |U|, |E0| counts as tiny and energy error is measured against K + |U|. */
const ENERGY_TINY = 1e-6;

/** One measurement of the system. measure() fills it in place and allocates nothing. */
export interface Diagnostics {
  kinetic: number;
  potential: number;
  energy: number;
  /** Total angular momentum about the origin, length 3. */
  L: Float64Array;
  /** Total linear momentum, length 3. */
  P: Float64Array;
  /** Center of mass, length 3. The plain mean of the bodies when every mass is zero. */
  com: Float64Array;
  /** Smallest pair distance (not softened). */
  minSeparation: number;
}

export function createDiagnostics(): Diagnostics {
  return {
    kinetic: 0,
    potential: 0,
    energy: 0,
    L: new Float64Array(3),
    P: new Float64Array(3),
    com: new Float64Array(3),
    minSeparation: 0,
  };
}

/**
 * The kinetic energy of the motion relative to the center of mass: what is left after the bulk
 * drift, 0.5 |P|² / M, is taken out. Whether a system is bound is a statement about this, not
 * about the lab-frame kinetic energy, which a drift of the whole system inflates.
 */
export function internalKinetic(d: Diagnostics, totalMass: number): number {
  if (!(totalMass > 0)) return d.kinetic;
  const drift = 0.5 * (d.P[0] * d.P[0] + d.P[1] * d.P[1] + d.P[2] * d.P[2]) / totalMass;
  return Math.max(d.kinetic - drift, 0);
}

export function measure(s: SystemState, out: Diagnostics): void {
  const { m, x, v } = s;
  const n = s.n;
  let kinetic = 0;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const mi = m[i];
    const xi = x[3 * i];
    const yi = x[3 * i + 1];
    const zi = x[3 * i + 2];
    const vx = v[3 * i];
    const vy = v[3 * i + 1];
    const vz = v[3 * i + 2];
    kinetic += 0.5 * mi * (vx * vx + vy * vy + vz * vz);
    lx += mi * (yi * vz - zi * vy);
    ly += mi * (zi * vx - xi * vz);
    lz += mi * (xi * vy - yi * vx);
    px += mi * vx;
    py += mi * vy;
    pz += mi * vz;
    cx += mi * xi;
    cy += mi * yi;
    cz += mi * zi;
  }
  const M = m[0] + m[1] + m[2];
  if (M > 0) {
    cx /= M;
    cy /= M;
    cz /= M;
  } else {
    cx = (x[0] + x[3] + x[6]) / n;
    cy = (x[1] + x[4] + x[7]) / n;
    cz = (x[2] + x[5] + x[8]) / n;
  }

  out.kinetic = kinetic;
  out.potential = potentialEnergy(s);
  out.energy = kinetic + out.potential;
  out.L[0] = lx;
  out.L[1] = ly;
  out.L[2] = lz;
  out.P[0] = px;
  out.P[1] = py;
  out.P[2] = pz;
  out.com[0] = cx;
  out.com[1] = cy;
  out.com[2] = cz;
  out.minSeparation = Math.hypot(x[3] - x[0], x[4] - x[1], x[5] - x[2]);
  if (n === 3) {
    out.minSeparation = Math.min(
      out.minSeparation,
      Math.hypot(x[6] - x[0], x[7] - x[1], x[8] - x[2]),
      Math.hypot(x[6] - x[3], x[7] - x[4], x[8] - x[5]),
    );
  }
}

/** The reference values (plan §3.2) the running errors are measured against. */
export interface Reference {
  /** E0, and the K + |U| used as its scale when it is tiny. */
  energy: number;
  energyScale: number;
  /** L0, and Lscale, the normalizer for angular momentum error. */
  L: Float64Array;
  Lscale: number;
  /** P0, the starting linear momentum. About zero in the COM frame. */
  P: Float64Array;
  /** The normalizer for momentum error: the sum of |m v| of the bodies (from the energy when they start at rest). */
  Pscale: number;
  /** T_char: the declared period of the preset if it has one, else the shortest pair period. */
  period: number;
  /** The size of the system when the reference was taken (systemSize): escape is measured in multiples of it. */
  size: number;
}

/**
 * Takes the reference values from s. Allocates, so call it on load or edit only.
 *
 * Lscale is sum m |x||v|, because many presets (figure-eight, Šuvakov) have L = 0 and a
 * relative error would be undefined. Starting from rest (Pythagorean) makes that zero too, so
 * the velocity is then characteristicSpeed().
 */
export function createReference(s: SystemState, period?: number): Reference {
  const d = createDiagnostics();
  measure(s, d);
  const parts = d.kinetic + Math.abs(d.potential);
  const energyScale = Math.abs(d.energy) > ENERGY_TINY * parts ? Math.abs(d.energy) : parts;

  let Lscale = 0;
  let Pscale = 0;
  let sumMx = 0;
  for (let i = 0; i < s.n; i++) {
    const r = Math.hypot(s.x[3 * i], s.x[3 * i + 1], s.x[3 * i + 2]);
    const speed = Math.hypot(s.v[3 * i], s.v[3 * i + 1], s.v[3 * i + 2]);
    Lscale += s.m[i] * r * speed;
    Pscale += s.m[i] * speed;
    sumMx += s.m[i] * r;
  }
  const M = s.m[0] + s.m[1] + s.m[2];
  if (!(Lscale > 0) && M > 0) Lscale = sumMx * characteristicSpeed(s);
  if (!(Pscale > 0) && M > 0) Pscale = M * characteristicSpeed(s);

  return {
    energy: d.energy,
    energyScale: energyScale > 0 ? energyScale : 1,
    L: d.L,
    Lscale: Lscale > 0 ? Lscale : 1,
    P: d.P,
    Pscale: Pscale > 0 ? Pscale : 1,
    period: period ?? characteristicTime(s),
    size: systemSize(s),
  };
}

/** |E - E0| / |E0|, or / (K + |U|) when E0 is tiny. */
export function energyError(d: Diagnostics, ref: Reference): number {
  return Math.abs(d.energy - ref.energy) / ref.energyScale;
}

/** |L - L0| / Lscale, the vector norm. */
export function angularMomentumError(d: Diagnostics, ref: Reference): number {
  return Math.hypot(d.L[0] - ref.L[0], d.L[1] - ref.L[1], d.L[2] - ref.L[2]) / ref.Lscale;
}

/**
 * |P - P0| / Pscale. P0 is about zero (the COM frame), so it cannot be the divisor; the momenta of
 * the bodies, whose sum cancels to it, are the scale roundoff comes in.
 */
export function momentumError(d: Diagnostics, ref: Reference): number {
  return Math.hypot(d.P[0] - ref.P[0], d.P[1] - ref.P[1], d.P[2] - ref.P[2]) / ref.Pscale;
}

/**
 * A speed typical of the system, sqrt(2 (K + |U|) / M), from its energy: it is not zero for a
 * system at rest. 1 if the bodies have no mass or no energy.
 */
export function characteristicSpeed(s: SystemState): number {
  const d = createDiagnostics();
  measure(s, d);
  const M = s.m[0] + s.m[1] + s.m[2];
  const v = M > 0 ? Math.sqrt((2 * (d.kinetic + Math.abs(d.potential))) / M) : 0;
  return v > 0 ? v : 1;
}

/**
 * T_char (plan §3.2): the shortest two-body period over the pairs, 2 pi sqrt(r^3 / (G (mi + mj))).
 * Pairs of two test particles have no period. Returns 1 when no pair has one.
 */
export function characteristicTime(s: SystemState): number {
  let best = Infinity;
  for (let i = 0; i < s.n; i++) {
    for (let j = i + 1; j < s.n; j++) {
      const mu = s.G * (s.m[i] + s.m[j]);
      const r = Math.hypot(
        s.x[3 * j] - s.x[3 * i],
        s.x[3 * j + 1] - s.x[3 * i + 1],
        s.x[3 * j + 2] - s.x[3 * i + 2],
      );
      if (mu > 0 && r > 0) best = Math.min(best, 2 * Math.PI * Math.sqrt((r * r * r) / mu));
    }
  }
  return best < Infinity ? best : 1;
}

/** The diameter of the sphere about the COM that just holds every body, for framing the camera. 1 if they coincide. */
export function systemSize(s: SystemState): number {
  const d = createDiagnostics();
  measure(s, d);
  let r = 0;
  for (let i = 0; i < s.n; i++) {
    r = Math.max(
      r,
      Math.hypot(s.x[3 * i] - d.com[0], s.x[3 * i + 1] - d.com[1], s.x[3 * i + 2] - d.com[2]),
    );
  }
  return r > 0 ? 2 * r : 1;
}
