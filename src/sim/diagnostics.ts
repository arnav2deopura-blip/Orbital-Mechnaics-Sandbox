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

export function measure(s: SystemState, out: Diagnostics): void {
  const { m, x, v } = s;
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
  for (let i = 0; i < 3; i++) {
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
    cx = (x[0] + x[3] + x[6]) / 3;
    cy = (x[1] + x[4] + x[7]) / 3;
    cz = (x[2] + x[5] + x[8]) / 3;
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
  out.minSeparation = Math.min(
    Math.hypot(x[3] - x[0], x[4] - x[1], x[5] - x[2]),
    Math.hypot(x[6] - x[0], x[7] - x[1], x[8] - x[2]),
    Math.hypot(x[6] - x[3], x[7] - x[4], x[8] - x[5]),
  );
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
  /** T_char: the declared period of the preset if it has one, else the shortest pair period. */
  period: number;
}

/**
 * Takes the reference values from s. Allocates, so call it on load or edit only.
 *
 * Lscale is sum m |x||v|, because many presets (figure-eight, Šuvakov) have L = 0 and a
 * relative error would be undefined. Starting from rest (Pythagorean) makes that zero too, so
 * the velocity is then taken from the energy: v ~ sqrt(2 (K + |U|) / M).
 */
export function createReference(s: SystemState, period?: number): Reference {
  const d = createDiagnostics();
  measure(s, d);
  const parts = d.kinetic + Math.abs(d.potential);
  const energyScale = Math.abs(d.energy) > ENERGY_TINY * parts ? Math.abs(d.energy) : parts;

  let Lscale = 0;
  let sumMx = 0;
  for (let i = 0; i < 3; i++) {
    const r = Math.hypot(s.x[3 * i], s.x[3 * i + 1], s.x[3 * i + 2]);
    Lscale += s.m[i] * r * Math.hypot(s.v[3 * i], s.v[3 * i + 1], s.v[3 * i + 2]);
    sumMx += s.m[i] * r;
  }
  const M = s.m[0] + s.m[1] + s.m[2];
  if (!(Lscale > 0) && M > 0) Lscale = sumMx * Math.sqrt((2 * parts) / M);

  return {
    energy: d.energy,
    energyScale: energyScale > 0 ? energyScale : 1,
    L: d.L,
    Lscale: Lscale > 0 ? Lscale : 1,
    P: d.P,
    period: period ?? characteristicTime(s),
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

/** |P - P0|. Absolute: P0 is about zero, so there is nothing to divide by. */
export function momentumError(d: Diagnostics, ref: Reference): number {
  return Math.hypot(d.P[0] - ref.P[0], d.P[1] - ref.P[1], d.P[2] - ref.P[2]);
}

/**
 * T_char (plan §3.2): the shortest two-body period over the pairs, 2 pi sqrt(r^3 / (G (mi + mj))).
 * Pairs of two test particles have no period. Returns 1 when no pair has one.
 */
export function characteristicTime(s: SystemState): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
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
  for (let i = 0; i < 3; i++) {
    r = Math.max(
      r,
      Math.hypot(s.x[3 * i] - d.com[0], s.x[3 * i + 1] - d.com[1], s.x[3 * i + 2] - d.com[2]),
    );
  }
  return r > 0 ? 2 * r : 1;
}
