import { computeAccel } from '../forces';
import { STATE_LEN } from '../state';
import type { SystemState } from '../types';
import type { Integrator, IntegratorParams } from './types';

/**
 * Classic RK4 on y = (x, v), y' = (v, a(x)): order 4, four force evaluations per step
 * (plan §4.3). Accurate per step but not symplectic, so energy drifts secularly.
 *
 * k<n>x is the velocity at stage n and k<n>v the acceleration there. k1x is just v.
 * xt holds the trial positions each acceleration is evaluated at.
 */
export class RK4 implements Integrator {
  readonly id = 'rk4';
  readonly order = 4;
  readonly symplectic = false;
  readonly adaptive = false;
  readonly forceEvalsPerStep = 4;

  private params!: IntegratorParams; // set by init()
  private dir: 1 | -1 = 1;
  private xt = new Float64Array(0);
  private k1v = new Float64Array(0);
  private k2x = new Float64Array(0);
  private k2v = new Float64Array(0);
  private k3x = new Float64Array(0);
  private k3v = new Float64Array(0);
  private k4x = new Float64Array(0);
  private k4v = new Float64Array(0);

  init(_s: SystemState, p: IntegratorParams): void {
    this.params = p;
    this.xt = new Float64Array(STATE_LEN);
    this.k1v = new Float64Array(STATE_LEN);
    this.k2x = new Float64Array(STATE_LEN);
    this.k2v = new Float64Array(STATE_LEN);
    this.k3x = new Float64Array(STATE_LEN);
    this.k3v = new Float64Array(STATE_LEN);
    this.k4x = new Float64Array(STATE_LEN);
    this.k4v = new Float64Array(STATE_LEN);
  }

  step(s: SystemState): number {
    const h = this.dir * this.params.dt;
    const hh = 0.5 * h;
    const x = s.x;
    const v = s.v;
    const xt = this.xt;
    const k1v = this.k1v;
    const k2x = this.k2x;
    const k2v = this.k2v;
    const k3x = this.k3x;
    const k3v = this.k3v;
    const k4x = this.k4x;
    const k4v = this.k4v;
    const counters = this.params.counters;

    computeAccel(s, x, k1v, counters);

    for (let i = 0; i < STATE_LEN; i++) {
      xt[i] = x[i] + hh * v[i];
      k2x[i] = v[i] + hh * k1v[i];
    }
    computeAccel(s, xt, k2v, counters);

    for (let i = 0; i < STATE_LEN; i++) {
      xt[i] = x[i] + hh * k2x[i];
      k3x[i] = v[i] + hh * k2v[i];
    }
    computeAccel(s, xt, k3v, counters);

    for (let i = 0; i < STATE_LEN; i++) {
      xt[i] = x[i] + h * k3x[i];
      k4x[i] = v[i] + h * k3v[i];
    }
    computeAccel(s, xt, k4v, counters);

    // x[i] is advanced before v[i], so the k1x = v term still holds the old velocity.
    const h6 = h / 6;
    for (let i = 0; i < STATE_LEN; i++) {
      x[i] += h6 * (v[i] + 2 * (k2x[i] + k3x[i]) + k4x[i]);
      v[i] += h6 * (k1v[i] + 2 * (k2v[i] + k3v[i]) + k4v[i]);
    }
    s.t += h;
    return h;
  }

  /** Nothing carries over between steps. */
  reset(): void {}

  setDirection(sign: 1 | -1): void {
    this.dir = sign;
  }
}
