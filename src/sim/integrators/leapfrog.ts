import { computeAccel } from '../forces';
import { STATE_LEN } from '../state';
import type { SystemState } from '../types';
import type { Integrator, IntegratorParams } from './types';

/**
 * Leapfrog in kick-drift-kick form (velocity Verlet): order 2, symplectic, time-reversible
 * (plan §4.2).
 *
 *   v += a(x) dt/2;  x += v dt;  a = a(x);  v += a dt/2
 *
 * Acceleration cache: the a computed for the closing kick is exactly the a(x) the next
 * step's opening kick needs, so it stays in the scratch buffer and a step costs one force
 * evaluation instead of two. Only the very first step after init(), reset() or a direction
 * flip pays for an extra evaluation. The state is synchronized at every full step, so
 * diagnostics read s directly.
 *
 * The cache is only valid for the positions it was computed at. Anything that changes s.x
 * outside step() (state edits, restoring prev) must be followed by reset().
 */
export class Leapfrog implements Integrator {
  readonly id = 'leapfrog';
  readonly order = 2;
  readonly symplectic = true;
  readonly adaptive = false;
  readonly forceEvalsPerStep = 1;

  private params!: IntegratorParams; // set by init()
  private a = new Float64Array(0);
  private accValid = false;
  private dir: 1 | -1 = 1;

  init(_s: SystemState, p: IntegratorParams): void {
    this.params = p;
    this.a = new Float64Array(STATE_LEN);
    this.accValid = false;
  }

  step(s: SystemState): number {
    const h = this.dir * this.params.dt;
    const hh = 0.5 * h;
    const x = s.x;
    const v = s.v;
    const a = this.a;
    const counters = this.params.counters;

    if (!this.accValid) {
      computeAccel(s, x, a, counters);
      this.accValid = true;
    }
    for (let i = 0; i < STATE_LEN; i++) {
      v[i] += hh * a[i];
      x[i] += h * v[i];
    }
    computeAccel(s, x, a, counters);
    for (let i = 0; i < STATE_LEN; i++) {
      v[i] += hh * a[i];
    }
    s.t += h;
    return h;
  }

  reset(): void {
    this.accValid = false;
  }

  /** Plan §4.2 drops the cache on a flip. a(x) does not depend on direction, so this costs one extra evaluation and nothing else. */
  setDirection(sign: 1 | -1): void {
    if (sign !== this.dir) {
      this.dir = sign;
      this.accValid = false;
    }
  }
}
