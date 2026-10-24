import { inertialToJacobi, jacobiToInertial } from '../coords';
import { computeAccel } from '../forces';
import { keplerDrift } from '../kepler';
import { createState, STATE_LEN } from '../state';
import type { SystemState } from '../types';
import type { Integrator, IntegratorParams } from './types';

/**
 * Wisdom-Holman in Jacobi coordinates, drift-kick-drift: order 2 in dt, symplectic and
 * time-reversible (plan §4.4; Wisdom & Holman 1991, Rein & Tamayo 2015).
 *
 * The Hamiltonian splits into Kepler motion plus an interaction. In Jacobi coordinates
 * each of the two relative coordinates i moves on an exact Kepler orbit with mu_i = G eta_i
 * (eta_1 = m0 + m1, eta_2 = M). The interaction is whatever the full pairwise force adds to
 * that Kepler acceleration, applied as a kick:
 *
 *   drift dt/2:  COM moves freely, coordinates 1 and 2 follow Kepler orbits
 *   kick  dt:    a' = Jacobi map of the full inertial accelerations;
 *                v'_i += dt (a'_i + mu_i r'_i / |r'_i|^3)
 *   drift dt/2
 *
 * The error per step scales as (perturbation mass ratio) x dt^2, so it excels when one body
 * dominates and loses that edge for comparable masses or close passages (plan §4.4). Rule
 * of thumb: dt below about 1/20 of the shortest orbital period.
 *
 * Bodies are reordered internally as (central, inner, outer), with the outer two sorted by
 * distance from the central body at init(). The state s keeps its own ordering and is
 * synchronized after every full step. The COM need not be at rest at the origin.
 *
 * Only the choice of OUTER body changes the map: making the inner companion central instead
 * flips r'1 to -r'1 and is the identical step. So for a star-planet-moon system the planet
 * (or moon) must be the central body, which makes the star the outer one. With the star
 * central, the outer body would be whichever of planet and moon sits farther from it, and
 * the split would be poor.
 *
 * Softening is not supported: the Kepler part is unsoftened, so a softened interaction
 * would be inconsistent. init() rejects eps2 != 0.
 */
export class WH implements Integrator {
  readonly id = 'wh';
  readonly order = 2;
  readonly symplectic = true;
  readonly adaptive = false;
  readonly forceEvalsPerStep = 1;

  /** Kepler root solves that failed to converge since init(). For the failure events of plan §7.5. */
  keplerFailures = 0;

  private params!: IntegratorParams; // set by init()
  private dir: 1 | -1 = 1;
  /** perm[k] is the index in s of the k-th body of (central, inner, outer). */
  private perm = new Uint8Array(3);
  /** The system in perm order with eps2 = 0: the kernel's input, and the inertial buffers x and v. */
  private w = createState();
  private wa = new Float64Array(0);
  /** Jacobi positions, velocities and accelerations: [COM, inner, outer] x 3. */
  private jx = new Float64Array(0);
  private jv = new Float64Array(0);
  private ja = new Float64Array(0);
  /** Jacobi positions and velocities at the start of the step, to measure what changed. */
  private jx0 = new Float64Array(0);
  private jv0 = new Float64Array(0);
  /** Scratch: the change in Jacobi coordinates, and the same change in inertial coordinates. */
  private dj = new Float64Array(0);
  private dq = new Float64Array(0);
  /** Inertial positions at the kick. */
  private xm = new Float64Array(0);

  init(s: SystemState, p: IntegratorParams): void {
    if (s.eps2 !== 0) {
      throw new RangeError('WH does not support softening: set eps2 = 0 before init()');
    }
    this.params = p;
    this.keplerFailures = 0;

    let central: number = p.centralBody ?? 0;
    if (p.centralBody === undefined) {
      for (let i = 1; i < 3; i++) if (s.m[i] > s.m[central]) central = i;
    }
    const a = (central + 1) % 3;
    const b = (central + 2) % 3;
    const dist2 = (i: number): number =>
      (s.x[3 * i] - s.x[3 * central]) ** 2 +
      (s.x[3 * i + 1] - s.x[3 * central + 1]) ** 2 +
      (s.x[3 * i + 2] - s.x[3 * central + 2]) ** 2;
    const aIsInner = dist2(a) <= dist2(b);
    this.perm[0] = central;
    this.perm[1] = aIsInner ? a : b;
    this.perm[2] = aIsInner ? b : a;

    if (!(s.m[this.perm[0]] + s.m[this.perm[1]] > 0)) {
      throw new RangeError('WH needs the central and inner bodies to have nonzero total mass');
    }

    this.w = createState(s.G, 0);
    this.wa = new Float64Array(STATE_LEN);
    this.jx = new Float64Array(STATE_LEN);
    this.jv = new Float64Array(STATE_LEN);
    this.ja = new Float64Array(STATE_LEN);
    this.jx0 = new Float64Array(STATE_LEN);
    this.jv0 = new Float64Array(STATE_LEN);
    this.dj = new Float64Array(STATE_LEN);
    this.dq = new Float64Array(STATE_LEN);
    this.xm = new Float64Array(STATE_LEN);
  }

  step(s: SystemState): number {
    const h = this.dir * this.params.dt;
    const hh = 0.5 * h;
    const perm = this.perm;
    const w = this.w;
    const wa = this.wa;
    const jx = this.jx;
    const jv = this.jv;
    const ja = this.ja;
    const jx0 = this.jx0;
    const jv0 = this.jv0;
    const dq = this.dq;
    const xm = this.xm;

    // Into perm order, with the current masses and G.
    w.G = s.G;
    for (let k = 0; k < 3; k++) {
      const b = perm[k];
      w.m[k] = s.m[b];
      for (let c = 0; c < 3; c++) {
        w.x[3 * k + c] = s.x[3 * b + c];
        w.v[3 * k + c] = s.v[3 * b + c];
      }
    }
    const eta1 = w.m[0] + w.m[1];
    const mu1 = w.G * eta1;
    const mu2 = w.G * (eta1 + w.m[2]);

    inertialToJacobi(w.m, w.x, jx);
    inertialToJacobi(w.m, w.v, jv);
    jx0.set(jx);
    jv0.set(jv);

    this.drift(hh, mu1, mu2);

    // Kick: the full acceleration at the drifted positions, minus the Kepler part.
    this.jacobiChange(jx, jx0, hh, dq);
    for (let i = 0; i < STATE_LEN; i++) xm[i] = w.x[i] + dq[i];
    computeAccel(w, xm, wa, this.params.counters);
    inertialToJacobi(w.m, wa, ja);
    for (let i = 1; i < 3; i++) {
      const o = 3 * i;
      const mu = i === 1 ? mu1 : mu2;
      const rx = jx[o];
      const ry = jx[o + 1];
      const rz = jx[o + 2];
      const r2 = rx * rx + ry * ry + rz * rz;
      const k = mu / (r2 * Math.sqrt(r2));
      jv[o] += h * (ja[o] + k * rx);
      jv[o + 1] += h * (ja[o + 1] + k * ry);
      jv[o + 2] += h * (ja[o + 2] + k * rz);
    }

    this.drift(hh, mu1, mu2);

    // Apply the step's change to the inertial state, then back to the caller's ordering.
    this.jacobiChange(jx, jx0, h, dq);
    for (let i = 0; i < STATE_LEN; i++) w.x[i] += dq[i];
    this.jacobiChange(jv, jv0, 0, dq);
    for (let i = 0; i < STATE_LEN; i++) w.v[i] += dq[i];
    for (let k = 0; k < 3; k++) {
      const b = perm[k];
      for (let c = 0; c < 3; c++) {
        s.x[3 * b + c] = w.x[3 * k + c];
        s.v[3 * b + c] = w.v[3 * k + c];
      }
    }
    s.t += h;
    return h;
  }

  /** The state is synchronized every step and nothing is cached. */
  reset(): void {}

  setDirection(sign: 1 | -1): void {
    this.dir = sign;
  }

  /** Kepler-advances the two relative coordinates. The COM moves freely and is handled in jacobiChange(). */
  private drift(hh: number, mu1: number, mu2: number): void {
    if (!keplerDrift(mu1, hh, this.jx, this.jv, 3)) this.keplerFailures++;
    if (!keplerDrift(mu2, hh, this.jx, this.jv, 6)) this.keplerFailures++;
  }

  /**
   * out = the inertial-frame equivalent of the change in a Jacobi vector from `before` to
   * `after`, where the COM entry moves by comTime x V (0 for a velocity, which a drift and
   * kick leave unchanged).
   *
   * Updating the state by this change, rather than rebuilding it from the Jacobi vector,
   * keeps roundoff proportional to the step's change instead of the full coordinate. A
   * rebuild is not rounding-neutral: with nothing happening at all, repeating it drifts
   * momentum and angular momentum by about an ulp per step, linearly in the step count.
   */
  private jacobiChange(after: Float64Array, before: Float64Array, comTime: number, out: Float64Array): void {
    const dj = this.dj;
    const jv = this.jv;
    dj[0] = comTime * jv[0];
    dj[1] = comTime * jv[1];
    dj[2] = comTime * jv[2];
    for (let i = 3; i < STATE_LEN; i++) dj[i] = after[i] - before[i];
    jacobiToInertial(this.w.m, dj, out);
  }
}
