import { computeAccel } from '../forces';
import { STATE_LEN } from '../state';
import type { SystemState } from '../types';
import type { Integrator, IntegratorParams } from './types';

/**
 * Euler, order 1, one force evaluation per step (plan §4.1).
 *
 * Explicit:                 x += v dt;  v += a(x) dt   (old x and v on the right)
 * Symplectic (semi-implicit): v += a(x) dt;  x += v dt   (the new v moves x)
 *
 * Reordering one line is the whole difference. The explicit form gains energy every
 * step and orbits spiral outward. The symplectic form keeps energy bounded.
 */
export class Euler implements Integrator {
  readonly id = 'euler';
  readonly order = 1;
  readonly symplectic: boolean;
  readonly adaptive = false;
  readonly forceEvalsPerStep = 1;

  private params!: IntegratorParams; // set by init()
  private a = new Float64Array(0);
  private dir: 1 | -1 = 1;

  constructor(symplectic = false) {
    this.symplectic = symplectic;
  }

  init(_s: SystemState, p: IntegratorParams): void {
    this.params = p;
    this.a = new Float64Array(STATE_LEN);
  }

  step(s: SystemState): number {
    const h = this.dir * this.params.dt;
    const x = s.x;
    const v = s.v;
    const a = this.a;

    computeAccel(s, x, a, this.params.counters);
    if (this.symplectic) {
      for (let i = 0; i < STATE_LEN; i++) {
        v[i] += h * a[i];
        x[i] += h * v[i];
      }
    } else {
      for (let i = 0; i < STATE_LEN; i++) {
        x[i] += h * v[i];
        v[i] += h * a[i];
      }
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
