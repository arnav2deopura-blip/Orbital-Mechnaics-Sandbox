import type { SystemState } from './types';

// Center-of-mass shift (plan §3.2) and Jacobi <-> inertial transforms (plan §4.4).
//
// Jacobi coordinates for three bodies ordered (central, inner companion, outer), with
// eta1 = m0 + m1 and M = m0 + m1 + m2:
//
//   j[0..2] = COM             = (m0 q0 + m1 q1 + m2 q2) / M
//   j[3..5] = q1 - q0                      (inner body about the central one)
//   j[6..8] = q2 - (m0 q0 + m1 q1) / eta1  (outer body about the inner pair's COM)
//
// m is in the same body order as q and j, and needs eta1 > 0. The map is linear, so one
// function converts positions, velocities and accelerations alike. For accelerations of a
// pairwise force, j[0..2] = sum m a / M is zero up to roundoff.
//
// Both functions allocate nothing, and the output may be the same array as the input:
// each component's three entries are all read before any of them is written.

/**
 * Moves s into its center-of-mass frame (plan §3.2): the mass-weighted mean position and
 * velocity are subtracted from every body, so the COM sits at the origin and total momentum
 * is zero. A system of test particles only (total mass 0) has no COM and is left as it is.
 */
export function shiftToComFrame(s: SystemState): void {
  const { m, x, v } = s;
  const M = m[0] + m[1] + m[2];
  if (!(M > 0)) return;
  for (let c = 0; c < 3; c++) {
    const rc = (m[0] * x[c] + m[1] * x[3 + c] + m[2] * x[6 + c]) / M;
    const vc = (m[0] * v[c] + m[1] * v[3 + c] + m[2] * v[6 + c]) / M;
    for (let i = 0; i < s.n; i++) {
      x[3 * i + c] -= rc;
      v[3 * i + c] -= vc;
    }
  }
}

/** Inertial -> Jacobi. */
export function inertialToJacobi(m: Float64Array, q: Float64Array, j: Float64Array): void {
  const m0 = m[0];
  const m1 = m[1];
  const m2 = m[2];
  const eta1 = m0 + m1;
  const M = eta1 + m2;
  for (let c = 0; c < 3; c++) {
    const q0 = q[c];
    const q1 = q[3 + c];
    const q2 = q[6 + c];
    const pair = m0 * q0 + m1 * q1;
    j[c] = (pair + m2 * q2) / M;
    j[3 + c] = q1 - q0;
    j[6 + c] = q2 - pair / eta1;
  }
}

/** Jacobi -> inertial. The inverse of inertialToJacobi, using the COM entry j[0..2] as given. */
export function jacobiToInertial(m: Float64Array, j: Float64Array, q: Float64Array): void {
  const m0 = m[0];
  const m1 = m[1];
  const m2 = m[2];
  const eta1 = m0 + m1;
  const M = eta1 + m2;
  const outerShare = m2 / M;
  const w0 = m0 / eta1;
  const w1 = m1 / eta1;
  for (let c = 0; c < 3; c++) {
    const r1 = j[3 + c];
    const r2 = j[6 + c];
    const pairCom = j[c] - outerShare * r2; // COM of bodies 0 and 1
    q[c] = pairCom - w1 * r1;
    q[3 + c] = pairCom + w0 * r1;
    q[6 + c] = pairCom + r2;
  }
}
