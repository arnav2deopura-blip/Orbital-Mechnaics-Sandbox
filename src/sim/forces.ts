import type { CostCounters, SystemState } from './types';

/**
 * Accelerations of the three bodies at positions x, written to a (plan §3.1).
 *
 * x is a parameter rather than s.x so integrators can evaluate at stage or predictor
 * positions (RK4, IAS15, WH) without disturbing the synchronized state. s supplies
 * m, G and eps2. Both x and a have length 9. a is overwritten, not accumulated into,
 * and is allocated once by the caller in init().
 *
 * Pair (i, j) with d = x_j - x_i and r2 = |d|^2 + eps2:
 *   a_i += G m_j d / r2^(3/2),   a_j -= G m_i d / r2^(3/2)
 * The mass in each term belongs to the other body, so a test particle (m = 0) feels
 * the others and exerts no force on them.
 *
 * Allocation rule: no new, array literals, closures or spreads. Scalar locals only.
 * counters is optional so diagnostics and rendering can evaluate accelerations without
 * inflating the cost metric.
 */
export function computeAccel(
  s: SystemState,
  x: Float64Array,
  a: Float64Array,
  counters?: CostCounters,
): void {
  const m0 = s.m[0];
  const m1 = s.m[1];
  const m2 = s.m[2];
  const G = s.G;
  const eps2 = s.eps2;

  const x0 = x[0];
  const y0 = x[1];
  const z0 = x[2];
  const x1 = x[3];
  const y1 = x[4];
  const z1 = x[5];
  const x2 = x[6];
  const y2 = x[7];
  const z2 = x[8];

  // Pair (0, 1)
  let dx = x1 - x0;
  let dy = y1 - y0;
  let dz = z1 - z0;
  let r2 = dx * dx + dy * dy + dz * dz + eps2;
  let k = G / (r2 * Math.sqrt(r2));
  let ki = k * m1; // pull on body 0, toward body 1
  let kj = k * m0; // pull on body 1, toward body 0
  let a0x = ki * dx;
  let a0y = ki * dy;
  let a0z = ki * dz;
  let a1x = -kj * dx;
  let a1y = -kj * dy;
  let a1z = -kj * dz;

  // Pair (0, 2)
  dx = x2 - x0;
  dy = y2 - y0;
  dz = z2 - z0;
  r2 = dx * dx + dy * dy + dz * dz + eps2;
  k = G / (r2 * Math.sqrt(r2));
  ki = k * m2;
  kj = k * m0;
  a0x += ki * dx;
  a0y += ki * dy;
  a0z += ki * dz;
  let a2x = -kj * dx;
  let a2y = -kj * dy;
  let a2z = -kj * dz;

  // Pair (1, 2)
  dx = x2 - x1;
  dy = y2 - y1;
  dz = z2 - z1;
  r2 = dx * dx + dy * dy + dz * dz + eps2;
  k = G / (r2 * Math.sqrt(r2));
  ki = k * m2;
  kj = k * m1;
  a1x += ki * dx;
  a1y += ki * dy;
  a1z += ki * dz;
  a2x -= kj * dx;
  a2y -= kj * dy;
  a2z -= kj * dz;

  a[0] = a0x;
  a[1] = a0y;
  a[2] = a0z;
  a[3] = a1x;
  a[4] = a1y;
  a[5] = a1z;
  a[6] = a2x;
  a[7] = a2y;
  a[8] = a2z;

  if (counters !== undefined) counters.forceEvals++;
}

/**
 * U = -G sum_{i<j} m_i m_j / sqrt(r_ij^2 + eps2).
 * Uses the softened potential whenever eps2 > 0; the unsoftened one would make the
 * energy diagnostic wrong (plan §3.1).
 */
export function potentialEnergy(s: SystemState): number {
  const m = s.m;
  const x = s.x;
  const eps2 = s.eps2;

  let dx = x[3] - x[0];
  let dy = x[4] - x[1];
  let dz = x[5] - x[2];
  let u = (m[0] * m[1]) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);

  dx = x[6] - x[0];
  dy = x[7] - x[1];
  dz = x[8] - x[2];
  u += (m[0] * m[2]) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);

  dx = x[6] - x[3];
  dy = x[7] - x[4];
  dz = x[8] - x[5];
  u += (m[1] * m[2]) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);

  return -s.G * u;
}
