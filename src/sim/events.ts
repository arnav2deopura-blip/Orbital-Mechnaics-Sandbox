import type { SystemState } from './types';

// Events (plan §7.5): a close encounter between two bodies, and a body escaping. The NaN/Inf
// guard lives in Simulation, which owns the step loop. Point masses never collide physically,
// and bodies are never merged (that would change N and break WH's Jacobi setup), so a
// "collision" is a close encounter with a radius the user chose, optionally stopping the run.

/** The smallest pair distance squared, over the first n bodies. Allocates nothing. */
export function minSeparationSquared(x: Float64Array, n = 3): number {
  let dx = x[3] - x[0];
  let dy = x[4] - x[1];
  let dz = x[5] - x[2];
  let best = dx * dx + dy * dy + dz * dz;
  if (n === 2) return best;
  dx = x[6] - x[0];
  dy = x[7] - x[1];
  dz = x[8] - x[2];
  best = Math.min(best, dx * dx + dy * dy + dz * dz);
  dx = x[6] - x[3];
  dy = x[7] - x[4];
  dz = x[8] - x[5];
  return Math.min(best, dx * dx + dy * dy + dz * dz);
}

/**
 * With two bodies, each is measured against the other: farther than `radius` and unbound.
 *
 * Whether body k has escaped (plan §7.5): it is farther than `radius` from the center of mass of
 * the other two, and unbound to them: the energy of the two-body problem of k against that pair,
 * per unit reduced mass, is positive. False if the other two have no mass to be bound to.
 *
 * The other two must also be within `radius` of each other. Without that, once one body leaves,
 * each of the two left behind is far from the center of mass of its partner and the escaper,
 * and would be flagged as well.
 */
export function hasEscaped(s: SystemState, k: number, radius: number): boolean {
  if (s.n === 2) {
    if (k > 1 || !(s.m[0] + s.m[1] > 0)) return false;
    const other = 1 - k;
    const r = Math.hypot(s.x[3 * k] - s.x[3 * other], s.x[3 * k + 1] - s.x[3 * other + 1], s.x[3 * k + 2] - s.x[3 * other + 2]);
    if (!(r > radius)) return false;
    const v2 = (s.v[3 * k] - s.v[3 * other]) ** 2 + (s.v[3 * k + 1] - s.v[3 * other + 1]) ** 2 + (s.v[3 * k + 2] - s.v[3 * other + 2]) ** 2;
    return 0.5 * v2 - (s.G * (s.m[0] + s.m[1])) / r > 0;
  }
  const a = (k + 1) % 3;
  const b = (k + 2) % 3;
  const pairMass = s.m[a] + s.m[b];
  if (!(pairMass > 0)) return false;
  const apart = Math.hypot(s.x[3 * a] - s.x[3 * b], s.x[3 * a + 1] - s.x[3 * b + 1], s.x[3 * a + 2] - s.x[3 * b + 2]);
  if (!(apart <= radius)) return false;
  let r2 = 0;
  let v2 = 0;
  for (let c = 0; c < 3; c++) {
    const pairX = (s.m[a] * s.x[3 * a + c] + s.m[b] * s.x[3 * b + c]) / pairMass;
    const pairV = (s.m[a] * s.v[3 * a + c] + s.m[b] * s.v[3 * b + c]) / pairMass;
    r2 += (s.x[3 * k + c] - pairX) ** 2;
    v2 += (s.v[3 * k + c] - pairV) ** 2;
  }
  const r = Math.sqrt(r2);
  if (!(r > radius)) return false;
  return 0.5 * v2 - (s.G * (s.m[k] + pairMass)) / r > 0;
}
