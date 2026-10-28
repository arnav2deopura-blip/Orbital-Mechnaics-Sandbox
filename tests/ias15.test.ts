import { describe, expect, it } from 'vitest';
import { IAS15 } from '../src/sim/integrators/ias15';
import type { IntegratorParams } from '../src/sim/integrators/types';
import { createCounters, snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import {
  angularMomentum,
  energy,
  kepler,
  keplerExact,
  lScale,
  momentum,
  norm,
  pairError,
  pythagorean,
} from './helpers';

/** Steps until s.t reaches tEnd. Calls onStep(dt) after each. Returns the integrator and its counters. */
function runUntil(
  s: SystemState,
  tEnd: number,
  p: Partial<IntegratorParams> & { dt: number },
  onStep?: (dt: number, ias: IAS15) => void,
) {
  const counters = createCounters();
  const ias = new IAS15();
  ias.init(s, { counters, ...p });
  let steps = 0;
  while (s.t < tEnd) {
    const dt = ias.step(s);
    // A regression should fail here, not hang: time must advance, and not through millions of steps.
    if (dt === 0 || ++steps > 3_000_000) throw new Error(`integration stalled at t = ${s.t} after ${steps} steps`);
    onStep?.(dt, ias);
  }
  return { ias, counters, steps };
}

describe('IAS15 contract', () => {
  it('declares itself a 15th-order adaptive, non-symplectic method with variable cost', () => {
    const ias = new IAS15();
    expect(ias.id).toBe('ias15');
    expect(ias.order).toBe(15);
    expect(ias.symplectic).toBe(false);
    expect(ias.adaptive).toBe(true);
    expect(ias.forceEvalsPerStep).toBe('variable');
  });

  it.each([0, -1, NaN])('rejects a first-guess dt of %s', (dt) => {
    expect(() => new IAS15().init(kepler().s, { dt, counters: createCounters() })).toThrow(RangeError);
  });

  it('returns the signed dt taken, advances s.t by it, and adapts dtNext', () => {
    const { s, T } = kepler(0.5, 1);
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, counters: createCounters() });
    expect(ias.dtNext).toBe(T / 100);
    const dt = ias.step(s);
    expect(dt).toBeGreaterThan(0);
    expect(s.t).toBe(dt);
    expect(ias.dtNext).not.toBe(T / 100);
    ias.setDirection(-1);
    const back = ias.step(s);
    expect(back).toBeLessThan(0);
    expect(s.t).toBeCloseTo(dt + back, 15);
  });
});

describe('IAS15 accuracy', () => {
  it('keeps the energy error near machine precision over 100 orbits (default tolerance)', () => {
    const { s, T } = kepler(0.5, 1);
    const E0 = energy(s);
    let worst = 0;
    runUntil(s, 100 * T, { dt: T / 100 }, () => {
      worst = Math.max(worst, Math.abs((energy(s) - E0) / E0));
    });
    expect(worst).toBeLessThan(1e-14);
    expect(pairError(s, keplerExact(0.5, 1, s.t))).toBeLessThan(1e-11);
  });

  it('lets the energy error grow like a random walk, not linearly, out to 1000 orbits', () => {
    // Kahan-compensated updates: errors in x and v do not pile up in one direction.
    const { s, T } = kepler(0.5, 1);
    const E0 = energy(s);
    let m100 = 0;
    let m1000 = 0;
    runUntil(s, 1000 * T, { dt: T / 100 }, () => {
      const err = Math.abs((energy(s) - E0) / E0);
      m1000 = Math.max(m1000, err);
      if (s.t < 100 * T) m100 = Math.max(m100, err);
    });
    expect(m1000).toBeLessThan(3e-14);
    expect(m1000 / m100).toBeLessThan(6); // sqrt(10) ~ 3.2 for a random walk, 10 for linear growth
  });

  it('keeps s.t equal to the exact sum of the steps it took (time is summed with compensation too)', () => {
    // Exact reference: Neumaier's compensated sum of the returned dt. A plain running sum drifts
    // from it by ~15 ulp over 24,000 steps; the compensated s.t stays within an ulp.
    const { s, T } = kepler(0.5, 1);
    let sum = 0;
    let carry = 0;
    runUntil(s, 200 * T, { dt: T / 100 }, (dt) => {
      const t = sum + dt;
      carry += Math.abs(sum) >= Math.abs(dt) ? sum - t + dt : dt - t + sum;
      sum = t;
    });
    const exact = sum + carry;
    const ulp = 2 ** (Math.floor(Math.log2(exact)) - 52);
    expect(Math.abs(s.t - exact)).toBeLessThan(3 * ulp);
  });

  it('is 15th order: forced to a fixed step, the error after one period falls as dt^15', () => {
    const errorAt = (N: number): number => {
      const { s, T } = kepler(0.5, 1);
      const start = snapshot(s);
      const ias = new IAS15();
      ias.init(s, { dt: T / N, dtMin: T / N, dtMax: T / N, epsTol: 1e9, counters: createCounters() });
      for (let n = 0; n < N; n++) ias.step(s);
      return pairError(s, start);
    };
    // Single ratios scatter (phase errors partly cancel), so fit across a wide span of N.
    const slope = Math.log(errorAt(8) / errorAt(20)) / Math.log(20 / 8);
    expect(slope).toBeGreaterThan(14);
    expect(slope).toBeLessThan(16.5);
  });

  it('takes ~eps^(-1/7) as many steps for a tighter tolerance, at the expected level', () => {
    const stepsPerOrbit = (epsTol: number): number => {
      const { s, T } = kepler(0.5, 1);
      return runUntil(s, 20 * T, { dt: T / 100, epsTol }).steps / 20;
    };
    const loose = stepsPerOrbit(1e-6);
    const normal = stepsPerOrbit(1e-9);
    const tight = stepsPerOrbit(1e-12);
    expect(normal / loose).toBeGreaterThan(2.2);
    expect(normal / loose).toBeLessThan(3.3); // 1000^(1/7) = 2.7
    expect(tight / normal).toBeGreaterThan(2.2);
    expect(tight / normal).toBeLessThan(3.3);
    // Pins the error criterion itself: e = 0.5 takes ~120 steps per orbit at 1e-9.
    expect(normal).toBeGreaterThan(100);
    expect(normal).toBeLessThan(140);
  });

  it('is much less accurate when told to be: a loose tolerance leaves a real error', () => {
    // At 1e-2 the controller grows dt until the corrector sometimes diverges, so this also
    // exercises recovery: every step must still complete.
    const errorAt = (epsTol: number): number => {
      const { s, T } = kepler(0.5, 1);
      const { ias } = runUntil(s, 20 * T, { dt: T / 100, epsTol });
      expect(ias.stepFailures).toBe(0);
      expect(Number.isFinite(s.x[0])).toBe(true);
      return pairError(s, keplerExact(0.5, 1, s.t));
    };
    expect(errorAt(1e-2)).toBeGreaterThan(30 * errorAt(1e-9));
  });

  it('conserves linear momentum to roundoff and angular momentum nearly so', () => {
    const { s, T } = kepler(0.5, 1);
    for (let i = 0; i < 2; i++) {
      s.v[3 * i] += 0.3;
      s.v[3 * i + 1] -= 0.2;
    }
    const P0 = momentum(s);
    const L0 = angularMomentum(s);
    const scale = lScale(s);
    runUntil(s, 100 * T, { dt: T / 100 });
    expect(norm(momentum(s), P0)).toBeLessThan(2e-15);
    expect(norm(angularMomentum(s), L0) / scale).toBeLessThan(2e-13);
  });
});

describe('IAS15 step control', () => {
  it('takes small steps near pericenter and large ones near apocenter (e = 0.9)', () => {
    const { s, T } = kepler(0.9, 1);
    let smallest = Infinity;
    let largest = 0;
    let sepAtSmallest = 0;
    let sepAtLargest = 0;
    runUntil(s, 5 * T, { dt: T / 100 }, (dt) => {
      const sep = Math.hypot(s.x[3] - s.x[0], s.x[4] - s.x[1], s.x[5] - s.x[2]);
      if (Math.abs(dt) < smallest) [smallest, sepAtSmallest] = [Math.abs(dt), sep];
      if (Math.abs(dt) > largest) [largest, sepAtLargest] = [Math.abs(dt), sep];
    });
    expect(largest / smallest).toBeGreaterThan(30);
    expect(sepAtSmallest).toBeLessThan(0.2); // pericenter is 0.1
    expect(sepAtLargest).toBeGreaterThan(1.5); // apocenter is 1.9
  });

  it('caps dt growth at 4x per step, and reaches the cap from a far-too-small first guess', () => {
    // Once dt is right, a smooth orbit only asks for a few percent per step, so the cap only
    // binds at the start. A first guess 1000x too small should grow by exactly 4x. At the
    // default 1e-9 the error estimate's roundoff noise (~2e-13) holds the first step to 3.3x,
    // so use a looser tolerance to get clear of it.
    const { s, T } = kepler(0.5, 1);
    let worst = 0;
    runUntil(s, 5 * T, { dt: T / 100000, epsTol: 1e-6 }, (dt, ias) => {
      worst = Math.max(worst, ias.dtNext / Math.abs(dt));
    });
    expect(worst).toBeLessThanOrEqual(4 * (1 + 1e-12));
    expect(worst).toBeGreaterThanOrEqual(4 * (1 - 1e-12));
  });

  it('rejects and redoes a first guess that is far too large, then proceeds accurately', () => {
    const { s, T } = kepler(0.9, 1);
    const E0 = energy(s);
    const { counters } = runUntil(s, 5 * T, { dt: T / 2 });
    expect(counters.rejectedSteps).toBeGreaterThan(0);
    expect(Math.abs((energy(s) - E0) / E0)).toBeLessThan(1e-14);
  });

  it('honors dtMax', () => {
    const { s, T } = kepler(0.5, 1);
    let largest = 0;
    runUntil(s, 2 * T, { dt: T / 100, dtMax: T / 300 }, (dt) => {
      largest = Math.max(largest, Math.abs(dt));
    });
    expect(largest).toBeLessThanOrEqual(T / 300);
  });

  it('honors dtMin, and counts the steps it had to accept although they needed a smaller dt', () => {
    const { s, T } = kepler(0.9, 1);
    let smallest = Infinity;
    const { ias } = runUntil(s, 2 * T, { dt: T / 100, dtMin: T / 20, epsTol: 1e-12 }, (dt) => {
      smallest = Math.min(smallest, Math.abs(dt));
    });
    expect(smallest).toBeGreaterThanOrEqual(T / 20);
    expect(ias.dtMinHits).toBeGreaterThan(0);
    expect(Number.isFinite(s.x[0])).toBe(true);
  });

  it('stays at 2-4 corrector sweeps per step at the default tolerance (plan: typically 2-3)', () => {
    const { s, T } = kepler(0.5, 1);
    const { counters, steps } = runUntil(s, 20 * T, { dt: T / 100 });
    const sweeps = (counters.forceEvals / steps - 1) / 7; // one force eval for a0, seven per sweep
    expect(sweeps).toBeGreaterThan(2);
    expect(sweeps).toBeLessThan(4);
    expect(counters.rejectedSteps).toBeLessThan(3);
  });

  it('recovers from a first guess so large that the corrector diverges to astronomical errors', () => {
    // 1e30 periods in one step: the first sweeps blow up (the error estimate is ~1e144), and a
    // handful of rejections bring dt back to something sensible before it goes on normally.
    const { s, T } = kepler(0.9, 1);
    const E0 = energy(s);
    const { ias, counters } = runUntil(s, 3 * T, { dt: 1e30 * T });
    expect(counters.rejectedSteps).toBeGreaterThanOrEqual(3);
    expect(ias.stepFailures).toBe(0);
    expect(Math.abs((energy(s) - E0) / E0)).toBeLessThan(5e-14);
  });

  it('restarts from zero, not from rescaled coefficients, when a corrector run produces NaN', () => {
    // A NaN error needs two bodies landing exactly on top of each other at a node, so inject it:
    // the first corrector run leaves NaN in b, as a diverged one would, and reports a NaN error.
    // Rescaling NaN gives NaN, so a retry that kept b could never recover.
    const { s, T } = kepler(0.5, 1);
    const counters = createCounters();
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, counters });
    const internals = ias as unknown as { iterate(s: SystemState, dt: number): number; b: Float64Array };
    const real = internals.iterate.bind(ias);
    let calls = 0;
    internals.iterate = (state, dt) => {
      if (calls++ > 0) return real(state, dt);
      internals.b.fill(NaN);
      return NaN;
    };
    const E0 = energy(s);
    const dt = ias.step(s);
    expect(ias.stepFailures).toBe(0);
    expect(counters.rejectedSteps).toBe(1);
    expect(dt).toBeCloseTo(T / 100 / 8, 12); // the retry is one eighth of the failed dt
    for (let n = 0; n < 20; n++) ias.step(s);
    expect(Math.abs((energy(s) - E0) / E0)).toBeLessThan(1e-14);
  });

  it('refuses a state that is already NaN: no step, s untouched, a failure counted', () => {
    const { s, T } = kepler(0.5, 1);
    s.x[0] = NaN;
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, counters: createCounters() });
    expect(ias.step(s)).toBe(0);
    expect(ias.stepFailures).toBe(1);
    expect(s.t).toBe(0);
    expect(Number.isNaN(s.x[0])).toBe(true);
    expect(s.v[1]).toBe(kepler(0.5, 1).s.v[1]);
  });
});

describe('IAS15 on the Pythagorean problem (close encounters)', () => {
  it('resolves the encounters and ejects the lightest body, leaving a bound 4-5 binary (t <= 80)', () => {
    const s = pythagorean();
    const E0 = energy(s);
    let worst = 0;
    let smallest = Infinity;
    runUntil(s, 80, { dt: 1e-3 }, (dt) => {
      smallest = Math.min(smallest, Math.abs(dt));
      worst = Math.max(worst, Math.abs((energy(s) - E0) / E0));
    });
    expect(worst).toBeLessThan(1e-8);
    expect(smallest).toBeLessThan(1e-6); // dt really did shrink through the closest approach
    // Body 0 (mass 3) is far away and still receding...
    const r = Math.hypot(s.x[0], s.x[1], s.x[2]);
    expect(r).toBeGreaterThan(30);
    expect(s.x[0] * s.v[0] + s.x[1] * s.v[1] + s.x[2] * s.v[2]).toBeGreaterThan(0);
    // ...and bodies 1 and 2 (masses 4 and 5) are bound to each other.
    const dx = [s.x[6] - s.x[3], s.x[7] - s.x[4], s.x[8] - s.x[5]];
    const dv = [s.v[6] - s.v[3], s.v[7] - s.v[4], s.v[8] - s.v[5]];
    const mu = s.m[1] + s.m[2];
    const binaryEnergy = 0.5 * (dv[0] ** 2 + dv[1] ** 2 + dv[2] ** 2) - mu / Math.hypot(...dx);
    expect(binaryEnergy).toBeLessThan(0);
  });
});

describe('IAS15 dense output', () => {
  /** A Kepler run advanced 50 steps, then one more step whose start state is returned. */
  function oneStep() {
    const { s, T } = kepler(0.5, 1);
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, counters: createCounters() });
    for (let n = 0; n < 50; n++) ias.step(s);
    const start = snapshot(s);
    const dt = ias.step(s);
    return { ias, s, start, dt };
  }

  it('starts at the start of the step and ends at the state the step produced', () => {
    const { ias, s, start } = oneStep();
    const x = new Float64Array(9);
    const v = new Float64Array(9);
    ias.dense(0, x, v);
    expect(Array.from(x)).toEqual(Array.from(start.x));
    expect(Array.from(v)).toEqual(Array.from(start.v));
    ias.dense(1, x, v);
    // About two ulps of the value, not an absolute bound: one body sits near x = 50, where one ulp is
    // 7e-15, and the last bit of dense(1) differs from the step's own sum between Node versions.
    for (let i = 0; i < 9; i++) {
      expect(Math.abs(x[i] - s.x[i])).toBeLessThan(3e-16 * Math.max(1, Math.abs(s.x[i])));
      expect(Math.abs(v[i] - s.v[i])).toBeLessThan(3e-16 * Math.max(1, Math.abs(s.v[i])));
    }
  });

  it('follows the true orbit inside the step to ~1e-15 (positions and velocities)', () => {
    const { ias, start, dt } = oneStep();
    const x = new Float64Array(9);
    const v = new Float64Array(9);
    for (const h of [0.1, 0.25, 0.37, 0.5, 0.9]) {
      ias.dense(h, x, v);
      const exact = keplerExact(0.5, 1, start.t + h * dt);
      for (let i = 0; i < 6; i++) {
        expect(Math.abs(x[i] - exact.x[i])).toBeLessThan(1e-14);
        expect(Math.abs(v[i] - exact.v[i])).toBeLessThan(1e-14);
      }
    }
  });
});

describe('IAS15 direction and reset', () => {
  it('runs backward as accurately as forward', () => {
    const { s, T } = kepler(0.5, 1);
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, counters: createCounters() });
    while (s.t < 2 * T) ias.step(s);
    ias.setDirection(-1);
    while (s.t > -T) expect(ias.step(s)).toBeLessThan(0);
    expect(pairError(s, keplerExact(0.5, 1, s.t))).toBeLessThan(1e-13);
  });

  it('does not retrace its path exactly after a flip, only closely', () => {
    const { s, T } = kepler(0.5, 1);
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, epsTol: 1e-12, counters: createCounters() });
    while (s.t < 3 * T) ias.step(s);
    ias.setDirection(-1);
    while (s.t > 0) ias.step(s);
    // It overshoots t = 0 by up to one step, so compare with the exact orbit at the time it reached.
    expect(pairError(s, keplerExact(0.5, 1, s.t))).toBeLessThan(1e-13);
  });

  it('after reset() continues exactly like a fresh integrator started from the edited state', () => {
    const { s, T } = kepler(0.5, 1);
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, counters: createCounters() });
    for (let n = 0; n < 30; n++) ias.step(s);
    s.x[0] += 0.01; // an edit outside step()
    ias.reset();
    const fresh = snapshot(s);
    const ias2 = new IAS15();
    ias2.init(fresh, { dt: ias.dtNext, counters: createCounters() });
    for (let n = 0; n < 20; n++) {
      ias.step(s);
      ias2.step(fresh);
    }
    expect(Array.from(s.x)).toEqual(Array.from(fresh.x));
    expect(Array.from(s.v)).toEqual(Array.from(fresh.v));
  });

  it('is still correct after an edit without reset(), only not bit-identical (stale predictor)', () => {
    // The start-of-step acceleration is recomputed every step, so an edit cannot corrupt the physics.
    // The two runs choose slightly different dt (the b6 estimate carries roundoff noise), so they
    // are at slightly different times; compare what must hold in both: the new energy is conserved.
    const run = (reset: boolean): { s: SystemState; drift: number } => {
      const { s, T } = kepler(0.5, 1);
      const ias = new IAS15();
      ias.init(s, { dt: T / 100, counters: createCounters() });
      for (let n = 0; n < 30; n++) ias.step(s);
      s.x[0] += 0.01;
      if (reset) ias.reset();
      const E0 = energy(s);
      let drift = 0;
      for (let n = 0; n < 40; n++) {
        ias.step(s);
        drift = Math.max(drift, Math.abs((energy(s) - E0) / E0));
      }
      return { s, drift };
    };
    const withReset = run(true);
    const without = run(false);
    expect(withReset.drift).toBeLessThan(3e-15);
    expect(without.drift).toBeLessThan(3e-15);
    expect(Array.from(without.s.x)).not.toEqual(Array.from(withReset.s.x));
  });
});

describe('IAS15 corrector convergence', () => {
  const failuresOver = (steps: number, init: Partial<IntegratorParams>, e = 0.5): { failures: number; n: number } => {
    const { s, T } = kepler(e, 1);
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, counters: createCounters(), ...init });
    for (let n = 0; n < steps; n++) ias.step(s);
    return { failures: ias.convergenceFailures, n: steps };
  };

  it('does not call an ordinary step a failure when roundoff keeps the last coefficient from settling', () => {
    // These counted 1 to 121 per 5000 steps before: the sweeps polish roundoff far below the tolerance.
    for (const epsTol of [1e-6, 1e-9]) expect(failuresOver(5000, { epsTol }).failures, `epsTol ${epsTol}`).toBe(0);
  });

  it('still reports a corrector that really is not converging: a step forced to a quarter of the orbit', () => {
    const { s, T } = kepler(0.5, 1);
    const ias = new IAS15();
    ias.init(s, { dt: T / 4, dtMin: T / 4, dtMax: T / 4, epsTol: 1e9, counters: createCounters() });
    for (let n = 0; n < 40; n++) ias.step(s);
    expect(ias.convergenceFailures).toBeGreaterThan(10);
  });

  it('keeps its accuracy: the energy error is no worse than before the change', () => {
    const { s, T } = kepler(0.5, 1);
    const e0 = energy(s);
    const ias = new IAS15();
    ias.init(s, { dt: T / 100, epsTol: 1e-9, counters: createCounters() });
    for (let n = 0; n < 3000; n++) ias.step(s);
    expect(Math.abs(energy(s) - e0) / Math.abs(e0)).toBeLessThan(1e-13);
  });
});
