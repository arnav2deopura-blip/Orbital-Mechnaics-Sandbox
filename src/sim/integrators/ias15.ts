import { computeAccel } from '../forces';
import { STATE_LEN } from '../state';
import type { SystemState } from '../types';
import { IAS15_C, IAS15_D, IAS15_H, IAS15_NP } from './ias15_constants';
import type { Integrator, IntegratorParams } from './types';

const NODES = 7;
const MAX_ITER = 12;
/** Corrector sweeps stop when the last coefficient changes by less than this fraction of the largest acceleration. */
const CONVERGED = 1e-16;
/** A step is rejected when the error estimate would shrink dt by more than this factor (plan §4.5). */
const SAFETY = 0.25;
const GROWTH = 1 / SAFETY;
const DEFAULT_EPS_TOL = 1e-9;
/** Shrink factor when the error estimate is not a number (the step blew up). */
const BLOWUP_FACTOR = 0.125;
const MAX_REJECTS = 50;

/** Integrating a(h) = a0 + sum b_k h^(k+1) once gives b_k / (k + 2), twice b_k / ((k + 2)(k + 3)). */
const VEL = Float64Array.from({ length: NODES }, (_, k) => 1 / (k + 2));
const POS = Float64Array.from({ length: NODES }, (_, k) => 1 / ((k + 2) * (k + 3)));
/** BINOM[8 j + m] = C(j, m), for moving the expansion point of the polynomial to the end of a step. */
const BINOM = new Float64Array(64);
for (let j = 0; j <= NODES; j++) {
  BINOM[8 * j] = 1;
  for (let m = 1; m <= j; m++) BINOM[8 * j + m] = BINOM[8 * (j - 1) + m - 1] + BINOM[8 * (j - 1) + m];
}

/**
 * IAS15: 15th-order adaptive Gauss-Radau integrator (Rein & Spiegel 2015, after Everhart 1985),
 * plan §4.5. Written from the mathematics; the tables come from tools/gen_ias15_constants.py.
 *
 * Over one step the acceleration is the polynomial a(h) = a0 + sum_(k=0..6) b_k h^(k+1) in the
 * fraction h of the step, fixed by its values at the seven Radau nodes. Integrating it gives the
 * position and velocity at every h. A step is a predictor-corrector iteration:
 *
 *   - predictor: b from the previous step, moved to the new origin and rescaled for the new dt
 *   - corrector: for each node in turn, predict the position there from the current b, evaluate
 *     the force, and fold the new value into b. Later nodes in the same sweep already see the
 *     earlier corrections. Sweeps repeat until the last coefficient stops changing.
 *
 * b6 measures how well a degree-7 polynomial describes the acceleration, so max|b6| / max|a| is
 * the error estimate: dt_new = dt (epsTol / error)^(1/7). A step that would shrink dt by more than
 * 4x is rejected and redone; otherwise it is accepted and dt may grow by up to 4x. Positions and
 * velocities are advanced with compensated (Kahan) summation, which is what lets the energy error
 * sit near machine precision and grow only like a random walk.
 *
 * Parameters (IntegratorParams): dt is only the first guess; epsTol (default 1e-9), dtMin and
 * dtMax are read every step. If dt cannot shrink any further the step is accepted anyway and
 * dtMinHits counts it, the plan's "close encounter: unresolved" event. If the corrector produces
 * NaN or infinity even at tiny dt (or s already holds them), step() leaves s unchanged, returns 0
 * and counts stepFailures. A caller must treat a 0 as a failure, never as progress.
 *
 * The predictor (b from the previous step) and the compensation terms belong to the trajectory s
 * has been following, so after anything that changes s outside step() (edits to positions,
 * velocities, masses, G or softening, or rolling back to prev) call reset(). The acceleration at
 * the start of a step is recomputed every step, so skipping reset() is not wrong, but the next
 * steps then start from a stale predictor and old compensation terms. A direction flip drops
 * the predictor too, so the next step takes a few more sweeps. Unlike the fixed-step methods
 * IAS15 does not retrace its path exactly after a flip, since the step sizes it picks are not
 * symmetric in time.
 *
 * The error estimate b6 is a 7th divided difference of the node accelerations, which amplifies
 * their roundoff: its noise is about 2e-13 of the acceleration (measured on a Kepler orbit). An
 * epsTol down to 1e-12 behaves as truncation theory says (steps grow like epsTol^(-1/7)), but at
 * 1e-13 and below the estimate is mostly noise and dt collapses toward zero. The plan's slider
 * floor of 1e-12 is the right limit; dtMin is the safety net.
 *
 * Known limit of this (original, global) error criterion: a tight pair far from the origin
 * carries roundoff noise in its accelerations, about one ulp of its position relative to its
 * separation, and b6 reads that as truncation error. Shrinking dt does not shrink the noise, so
 * dt collapses. The Pythagorean problem's final 4-5 binary at t ~ 87 needs 311,681 steps from
 * t = 85 to 89 as is, but 1,559 with the binary recentered on the origin. dtMin bounds the cost,
 * and the newer criterion of Pham, Rein & Spiegel 2024 (plan §4.5, v2) is the real fix.
 */
export class IAS15 implements Integrator {
  readonly id = 'ias15';
  readonly order = 15;
  readonly symplectic = false;
  readonly adaptive = true;
  readonly forceEvalsPerStep = 'variable';

  /** Magnitude of the step the next step() will try first. */
  dtNext = 0;
  /** Steps accepted although the error estimate asked for a smaller dt than dtMin allowed. */
  dtMinHits = 0;
  /** Corrector runs that used all their sweeps without converging. */
  convergenceFailures = 0;
  /** step() calls that could not take a step at all (they returned 0 and left s untouched). */
  stepFailures = 0;

  private params!: IntegratorParams; // set by init()
  private dir: 1 | -1 = 1;

  /** Acceleration at the start of the step (and, after it, of the step just taken, for dense()). */
  private a0 = new Float64Array(0);
  /** Start-of-step state, kept after the step for dense(). */
  private xs = new Float64Array(0);
  private vs = new Float64Array(0);
  /** Coefficients b_k, then the Newton-basis g_k of the same polynomial, each [k][component]. */
  private b = new Float64Array(0);
  private g = new Float64Array(0);
  /** Trial positions at a node, and the acceleration there. */
  private xn = new Float64Array(0);
  private an = new Float64Array(0);
  /** Kahan compensation for x, v and t. */
  private csx = new Float64Array(0);
  private csv = new Float64Array(0);
  private cst = 0;

  /** Signed dt of the last accepted step, or 0 before the first. */
  private dtDone = 0;
  private havePrev = false;

  init(_s: SystemState, p: IntegratorParams): void {
    if (!(p.dt > 0)) throw new RangeError('IAS15 needs a positive first guess for dt');
    this.params = p;
    this.a0 = new Float64Array(STATE_LEN);
    this.xs = new Float64Array(STATE_LEN);
    this.vs = new Float64Array(STATE_LEN);
    this.b = new Float64Array(NODES * STATE_LEN);
    this.g = new Float64Array(NODES * STATE_LEN);
    this.xn = new Float64Array(STATE_LEN);
    this.an = new Float64Array(STATE_LEN);
    this.csx = new Float64Array(STATE_LEN);
    this.csv = new Float64Array(STATE_LEN);
    this.dtNext = p.dt;
    this.dtMinHits = 0;
    this.convergenceFailures = 0;
    this.stepFailures = 0;
    this.dtDone = 0;
    this.reset();
  }

  step(s: SystemState): number {
    const p = this.params;
    const epsTol = p.epsTol ?? DEFAULT_EPS_TOL;
    const dtMin = p.dtMin ?? 0;
    const dtMax = p.dtMax ?? Infinity;

    computeAccel(s, s.x, this.a0, p.counters); // once per step, reused if the step is redone
    let size = 0;
    for (let i = 0; i < STATE_LEN; i++) size += Math.abs(this.a0[i]);
    if (!(size < Infinity)) return this.fail(); // the state itself is already NaN or infinite
    this.xs.set(s.x);
    this.vs.set(s.v);

    let dtAbs = Math.min(Math.max(this.dtNext, dtMin), dtMax);
    if (this.havePrev) this.shiftB(dtAbs / Math.abs(this.dtDone));
    else this.b.fill(0);
    this.gFromB();

    let factor: number;
    for (let rejects = 0; ; rejects++) {
      const error = this.iterate(s, this.dir * dtAbs);
      const finite = error < Infinity; // false for NaN too: the corrector diverged
      factor = error <= 0 ? GROWTH : finite ? Math.pow(epsTol / error, 1 / 7) : BLOWUP_FACTOR;
      if (factor >= SAFETY) break;
      const smaller = Math.max(dtAbs * factor, dtMin);
      if (smaller >= dtAbs || rejects >= MAX_REJECTS) {
        if (!finite) return this.fail(); // nothing usable to accept
        this.dtMinHits++; // cannot shrink any further: accept, and say so
        break;
      }
      p.counters.rejectedSteps++;
      // A diverged b is NaN or huge and would poison the retry, so start again from nothing.
      if (finite) this.scaleB(smaller / dtAbs);
      else this.b.fill(0);
      this.gFromB();
      dtAbs = smaller;
    }

    const dt = this.dir * dtAbs;
    this.advance(s, dt);
    this.dtDone = dt;
    this.havePrev = true;
    this.dtNext = Math.min(Math.max(dtAbs * Math.min(factor, GROWTH), dtMin), dtMax);
    return dt;
  }

  /** A step that cannot be taken: s is left as it was, and 0 tells the caller no time passed. */
  private fail(): number {
    this.stepFailures++;
    this.havePrev = false;
    return 0;
  }

  /** Drops the predictor and the compensation terms. dtNext is kept. */
  reset(): void {
    this.havePrev = false;
    this.csx.fill(0);
    this.csv.fill(0);
    this.cst = 0;
  }

  /** A flip invalidates the predictor, which describes the acceleration along the forward path. */
  setDirection(sign: 1 | -1): void {
    if (sign !== this.dir) {
      this.dir = sign;
      this.havePrev = false;
    }
  }

  /**
   * Position and velocity at the fraction h of the most recent accepted step (0 is its start,
   * 1 its end), from the same polynomial that took the step. Valid until the next step().
   */
  dense(h: number, xOut: Float64Array, vOut: Float64Array): void {
    const dt = this.dtDone;
    const { a0, xs, vs, b } = this;
    for (let i = 0; i < STATE_LEN; i++) {
      let px = b[6 * STATE_LEN + i] * POS[6];
      let pv = b[6 * STATE_LEN + i] * VEL[6];
      for (let k = 5; k >= 0; k--) {
        px = b[k * STATE_LEN + i] * POS[k] + h * px;
        pv = b[k * STATE_LEN + i] * VEL[k] + h * pv;
      }
      px = 0.5 * a0[i] + h * px;
      pv = a0[i] + h * pv;
      xOut[i] = xs[i] + h * dt * vs[i] + h * dt * (h * dt) * px;
      vOut[i] = vs[i] + h * dt * pv;
    }
  }

  /**
   * Corrector sweeps at step size dt, from the predicted b and g. Leaves the converged b and g
   * in place and returns the error estimate max|b6| / max|a|.
   */
  private iterate(s: SystemState, dt: number): number {
    const { a0, xs, vs, b, g, xn, an } = this;
    const counters = this.params.counters;
    let maxa = 0;
    let converged = false;

    for (let sweep = 0; sweep < MAX_ITER && !converged; sweep++) {
      maxa = 0;
      let maxdb6 = 0;
      for (let n = 1; n <= NODES; n++) {
        const hn = IAS15_H[n - 1];
        // Position at this node from the current polynomial.
        for (let i = 0; i < STATE_LEN; i++) {
          let acc = b[6 * STATE_LEN + i] * POS[6];
          for (let k = 5; k >= 0; k--) acc = b[k * STATE_LEN + i] * POS[k] + hn * acc;
          acc = 0.5 * a0[i] + hn * acc;
          xn[i] = xs[i] + hn * dt * vs[i] + hn * dt * (hn * dt) * acc;
        }
        computeAccel(s, xn, an, counters);

        // Fold the new acceleration into g_n, and from there into the b_m with m <= n.
        const row = (n * (n - 1)) / 2;
        for (let i = 0; i < STATE_LEN; i++) {
          let rhs = an[i] - a0[i];
          for (let k = 1; k < n; k++) rhs -= g[(k - 1) * STATE_LEN + i] * IAS15_NP[row + k - 1];
          const gNew = rhs / IAS15_NP[row + n - 1];
          const d = gNew - g[(n - 1) * STATE_LEN + i];
          g[(n - 1) * STATE_LEN + i] = gNew;
          for (let m = 1; m <= n; m++) b[(m - 1) * STATE_LEN + i] += d * IAS15_C[row + m - 1];
          const mag = Math.abs(an[i]);
          if (mag > maxa) maxa = mag;
          if (n === NODES && Math.abs(d) > maxdb6) maxdb6 = Math.abs(d); // d is the change in b6
        }
      }
      converged = maxdb6 <= CONVERGED * maxa;
    }
    if (!converged) this.convergenceFailures++;

    let maxb6 = 0;
    for (let i = 0; i < STATE_LEN; i++) {
      const mag = Math.abs(b[6 * STATE_LEN + i]);
      if (mag > maxb6) maxb6 = mag;
    }
    return maxa > 0 ? maxb6 / maxa : 0;
  }

  /** Takes the step: x and v advanced by the integrated polynomial with Kahan summation. */
  private advance(s: SystemState, dt: number): void {
    const { a0, vs, b, csx, csv } = this;
    const x = s.x;
    const v = s.v;
    for (let i = 0; i < STATE_LEN; i++) {
      let px = 0.5 * a0[i];
      let pv = a0[i];
      for (let k = 0; k < NODES; k++) {
        px += b[k * STATE_LEN + i] * POS[k];
        pv += b[k * STATE_LEN + i] * VEL[k];
      }
      const dx = dt * (vs[i] + dt * px) - csx[i];
      const dv = dt * pv - csv[i];
      const xNew = x[i] + dx;
      const vNew = v[i] + dv;
      csx[i] = xNew - x[i] - dx;
      csv[i] = vNew - v[i] - dv;
      x[i] = xNew;
      v[i] = vNew;
    }
    const yt = dt - this.cst;
    const tNew = s.t + yt;
    this.cst = tNew - s.t - yt;
    s.t = tNew;
  }

  /**
   * Re-expands b about the end of the step and rescales it for a step q times as long: with
   * a(h) = a0 + sum_(j=1..7) alpha_j h^j and h = 1 + q h', the coefficient of h'^m is
   * q^m sum_(j >= m) C(j, m) alpha_j. Ascending m, so each new b_(m-1) only needs old b_(j-1), j >= m.
   */
  private shiftB(q: number): void {
    const b = this.b;
    let qm = 1;
    for (let m = 1; m <= NODES; m++) {
      qm *= q;
      for (let i = 0; i < STATE_LEN; i++) {
        let sum = 0;
        for (let j = m; j <= NODES; j++) sum += BINOM[8 * j + m] * b[(j - 1) * STATE_LEN + i];
        b[(m - 1) * STATE_LEN + i] = qm * sum;
      }
    }
  }

  /** Rescales b for a shorter retry from the same start: the coefficient of h^(k+1) scales as q^(k+1). */
  private scaleB(q: number): void {
    const b = this.b;
    let qk = 1;
    for (let k = 0; k < NODES; k++) {
      qk *= q;
      for (let i = 0; i < STATE_LEN; i++) b[k * STATE_LEN + i] *= qk;
    }
  }

  /** g from b, so the Newton-basis form matches the predicted polynomial. */
  private gFromB(): void {
    const { b, g } = this;
    for (let k = 0; k < NODES; k++) {
      for (let i = 0; i < STATE_LEN; i++) {
        let sum = 0;
        for (let j = k; j < NODES; j++) sum += IAS15_D[NODES * k + j] * b[j * STATE_LEN + i];
        g[k * STATE_LEN + i] = sum;
      }
    }
  }
}
