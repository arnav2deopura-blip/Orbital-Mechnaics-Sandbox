import { keplerDrift } from './kepler';
import type { SystemState } from './types';

/**
 * The exact solution for a system with one massless body (plan §6, "Analytic error"): the other
 * two are a two-body Kepler problem, which has a closed form whatever the third does, since a
 * massless body exerts no force. Built from the state it starts at; error() then compares a
 * later state of the same run with the exact one, in the positions of the two massive bodies.
 *
 * The pair's center of mass moves in a straight line, so the solution does not need the COM to
 * be at rest or at the origin. Softening breaks the closed form, so it has none.
 */
export class KeplerReference {
  private readonly t0: number;
  private readonly mu: number;
  /** Indices of the two massive bodies, and their masses over the pair's total. */
  private readonly a: number;
  private readonly b: number;
  private readonly wa: number;
  private readonly wb: number;
  private readonly com0 = new Float64Array(3);
  private readonly comV = new Float64Array(3);
  /** The relative position and velocity (b - a) at t0, and the working copy that is drifted. */
  private readonly r0 = new Float64Array(3);
  private readonly v0 = new Float64Array(3);
  private readonly r = new Float64Array(3);
  private readonly v = new Float64Array(3);

  private constructor(s: SystemState, a: number, b: number) {
    this.t0 = s.t;
    this.a = a;
    this.b = b;
    const M = s.m[a] + s.m[b];
    this.mu = s.G * M;
    this.wa = s.m[a] / M;
    this.wb = s.m[b] / M;
    for (let c = 0; c < 3; c++) {
      this.com0[c] = this.wa * s.x[3 * a + c] + this.wb * s.x[3 * b + c];
      this.comV[c] = this.wa * s.v[3 * a + c] + this.wb * s.v[3 * b + c];
      this.r0[c] = s.x[3 * b + c] - s.x[3 * a + c];
      this.v0[c] = s.v[3 * b + c] - s.v[3 * a + c];
    }
  }

  /** The reference for s, or null if it does not have exactly one massless body, or is softened. */
  static from(s: SystemState): KeplerReference | null {
    if (s.eps2 !== 0) return null;
    const massless = [0, 1, 2].filter((i) => s.m[i] === 0);
    if (massless.length !== 1) return null;
    const [a, b] = [0, 1, 2].filter((i) => i !== massless[0]);
    if (!(s.m[a] > 0 && s.m[b] > 0 && s.G > 0)) return null;
    const ref = new KeplerReference(s, a, b);
    return Math.hypot(ref.r0[0], ref.r0[1], ref.r0[2]) > 0 ? ref : null;
  }

  /**
   * The largest difference in position, over the two massive bodies, between s and the exact
   * solution at s.t. Allocates nothing. NaN if the Kepler solver fails.
   */
  error(s: SystemState): number {
    const dt = s.t - this.t0;
    this.r.set(this.r0);
    this.v.set(this.v0);
    if (!keplerDrift(this.mu, dt, this.r, this.v, 0)) return NaN;
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const com = this.com0[c] + this.comV[c] * dt;
      const xa = com - this.wb * this.r[c];
      const xb = com + this.wa * this.r[c];
      worst = Math.max(worst, Math.abs(s.x[3 * this.a + c] - xa), Math.abs(s.x[3 * this.b + c] - xb));
    }
    return worst;
  }
}
