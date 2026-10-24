import { describe, expect, it } from 'vitest';
import { Leapfrog } from '../src/sim/integrators/leapfrog';
import { RK4 } from '../src/sim/integrators/rk4';
import type { Integrator, IntegratorParams } from '../src/sim/integrators/types';
import { WH } from '../src/sim/integrators/wh';
import { createCounters, createState, snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import {
  angularMomentum,
  energy,
  hierarchical,
  invertOrder,
  kepler,
  keplerExact,
  lScale,
  momentum,
  norm,
  pairError,
  permute,
  stateError,
} from './helpers';

function run(integ: Integrator, s: SystemState, dt: number, steps: number, extra: Partial<IntegratorParams> = {}) {
  const counters = createCounters();
  integ.init(s, { dt, counters, ...extra });
  for (let n = 0; n < steps; n++) integ.step(s);
  return counters;
}

describe('WH contract', () => {
  it('declares itself a second-order symplectic fixed-step method with one force eval per step', () => {
    const wh = new WH();
    expect(wh.id).toBe('wh');
    expect(wh.order).toBe(2);
    expect(wh.symplectic).toBe(true);
    expect(wh.adaptive).toBe(false);
    expect(wh.forceEvalsPerStep).toBe(1);
  });

  it('returns the signed dt taken, advances s.t by it, and follows params.dt changes', () => {
    const { s } = hierarchical();
    const p = { dt: 0.01, counters: createCounters() };
    const wh = new WH();
    wh.init(s, p);
    expect(wh.step(s)).toBe(0.01);
    p.dt = 0.02;
    expect(wh.step(s)).toBe(0.02);
    wh.setDirection(-1);
    expect(wh.step(s)).toBe(-0.02);
    expect(s.t).toBeCloseTo(0.01, 15);
  });

  it('costs exactly one force evaluation per step and never fails a Kepler solve', () => {
    const wh = new WH();
    const counters = run(wh, hierarchical().s, 0.05, 100);
    expect(counters.forceEvals).toBe(100);
    expect(wh.keplerFailures).toBe(0);
  });

  it('rejects softening, which would be inconsistent with the unsoftened Kepler part', () => {
    const { s } = hierarchical();
    s.eps2 = 1e-4;
    expect(() => new WH().init(s, { dt: 0.01, counters: createCounters() })).toThrow(RangeError);
  });

  it('rejects a central/inner pair with no mass', () => {
    const s = createState();
    s.m.set([0, 0, 1]);
    s.x.set([0, 0, 0, 1, 0, 0, 5, 0, 0]);
    expect(() => new WH().init(s, { dt: 0.01, counters: createCounters(), centralBody: 0 })).toThrow(RangeError);
  });
});

describe('WH on a two-body problem (third body massless)', () => {
  // Bodies 0 and 1 then depend only on the inner Jacobi coordinate. Its Kepler drift is exact
  // and its interaction kick is exactly zero, so WH is exact at ANY dt, even one longer than the
  // period. This ties the Jacobi maps, the mu values, the drift/kick plumbing and the Kepler
  // solver together. Leapfrog at the same dt is off by O(1).
  const e = 0.5;
  const f0 = 1;

  it.each([1 / 50, 1 / 7, 1.9])('reproduces the exact orbit with dt = %s periods', (frac) => {
    const { s, T } = kepler(e, f0);
    run(new WH(), s, frac * T, 3);
    expect(pairError(s, keplerExact(e, f0, s.t))).toBeLessThan(2e-12);
  });

  it('is exact backward in time too', () => {
    const { s, T } = kepler(e, f0);
    const wh = new WH();
    wh.init(s, { dt: T / 7, counters: createCounters() });
    wh.setDirection(-1);
    for (let n = 0; n < 10; n++) wh.step(s);
    expect(s.t).toBeLessThan(0);
    expect(pairError(s, keplerExact(e, f0, s.t))).toBeLessThan(1e-13);
  });

  it.each([undefined, 0, 1] as const)('is exact whichever of the pair is the central body (centralBody = %s)', (centralBody) => {
    const { s, T } = kepler(e, f0);
    run(new WH(), s, T / 7, 21, { centralBody });
    expect(pairError(s, keplerExact(e, f0, s.t))).toBeLessThan(3e-13);
  });

  it('is exact with the bodies listed in any order, and writes results back to the right indices', () => {
    for (const order of [[2, 1, 0], [1, 2, 0], [2, 0, 1]]) {
      const { s: base, T } = kepler(e, f0);
      const s = permute(base, order);
      run(new WH(), s, T / 7, 21);
      const exact = permute(keplerExact(e, f0, s.t), order);
      expect(pairError(permute(s, invertOrder(order)), permute(exact, invertOrder(order)))).toBeLessThan(3e-13);
    }
  });

  it('is exact when the massive pair is (central, OUTER) around a massless inner body', () => {
    // A planet (central) and a heavy star (outer) with a massless moon between them, as in a
    // star-planet-moon system with the planet as the central body. Bodies 0 and 1 then depend
    // only on the OUTER Jacobi coordinate, whose Kepler motion needs mu2 = G M. A wrong mu2
    // (say G (m0 + m1)) would still be a consistent symplectic split, just a poor one, so only
    // an exactness test can pin it.
    const [mA, mB] = [1e-3, 1];
    const { s, T } = kepler(0.3, 1, mA, mB);
    s.x[6] = s.x[0] + 0.01;
    s.x[7] = s.x[1];
    s.x[8] = s.x[2];
    s.v[6] = s.v[0];
    s.v[7] = s.v[1] + Math.sqrt(mA / 0.01);
    s.v[8] = s.v[2];
    run(new WH(), s, T / 7, 21, { centralBody: 0 });
    expect(pairError(s, keplerExact(0.3, 1, s.t, mA, mB))).toBeLessThan(3e-13);
  });

  it('does something leapfrog cannot: the same dt leaves leapfrog far off', () => {
    const { s, T } = kepler(e, f0);
    run(new Leapfrog(), s, T / 50, 150);
    expect(pairError(s, keplerExact(e, f0, s.t))).toBeGreaterThan(1e-3);
  });
});

describe('WH body ordering on a real three-body system', () => {
  const dt = 0.31;
  const steps = 200;

  it('gives the same physics for every labeling of the bodies', () => {
    const { s: base } = hierarchical();
    run(new WH(), base, dt, steps);
    for (const order of [[1, 0, 2], [2, 0, 1], [1, 2, 0], [2, 1, 0], [0, 2, 1]]) {
      const s = permute(hierarchical().s, order);
      run(new WH(), s, dt, steps);
      expect(stateError(permute(s, invertOrder(order)), base)).toBeLessThan(1e-14);
    }
  });

  it('treats an explicit centralBody equal to the default as the default, bit for bit', () => {
    const a = hierarchical().s;
    const b = hierarchical().s;
    run(new WH(), a, dt, steps);
    run(new WH(), b, dt, steps, { centralBody: 0 });
    expect(Array.from(b.x)).toEqual(Array.from(a.x));
    expect(Array.from(b.v)).toEqual(Array.from(a.v));
  });

  it('is unaffected by which of the inner pair is central: only the outermost body matters', () => {
    // Swapping central and inner flips r'1 to -r'1 and leaves the Kepler motion, mu1 and the
    // pair COM unchanged, so it is the very same map.
    const a = hierarchical().s;
    const b = hierarchical().s;
    run(new WH(), a, dt, steps);
    run(new WH(), b, dt, steps, { centralBody: 1 });
    expect(stateError(b, a)).toBeLessThan(1e-14);
  });

  it('makes a poorer split, but the same dynamics at small dt, with the outer planet central', () => {
    const { s: ref, T1 } = hierarchical();
    const small = T1 / 400;
    run(new WH(), ref, small, 400);
    const s = hierarchical().s;
    const wh = new WH();
    run(wh, s, small, 400, { centralBody: 2 });
    expect(wh.keplerFailures).toBe(0);
    const err = stateError(s, ref);
    expect(err).toBeGreaterThan(1e-6); // a different split, not the same map
    expect(err).toBeLessThan(1e-3);
  });
});

describe('WH accuracy on a hierarchical system', () => {
  /** Reference solution: RK4 at 1/4000 of the inner period, far finer than any WH step tested. */
  function reference(tEnd: number): SystemState {
    const { s, T1 } = hierarchical();
    run(new RK4(), s, T1 / 4000, Math.round(tEnd / (T1 / 4000)));
    return s;
  }

  it('converges at second order in dt (plan test 4, tolerance +/-0.15)', () => {
    const { T1 } = hierarchical();
    const ref = reference(2 * T1);
    const errors = [20, 40, 80].map((perOrbit) => {
      const s = hierarchical().s;
      run(new WH(), s, T1 / perOrbit, 2 * perOrbit);
      return stateError(s, ref);
    });
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(Math.log2(errors[i] / errors[i + 1]) - 2)).toBeLessThan(0.15);
    }
  });

  it('beats leapfrog at the same dt when one body dominates', () => {
    const { T1 } = hierarchical();
    const ref = reference(2 * T1);
    const errorOf = (integ: Integrator): number => {
      const s = hierarchical().s;
      run(integ, s, T1 / 20, 40);
      return stateError(s, ref);
    };
    expect(errorOf(new WH())).toBeLessThan(errorOf(new Leapfrog()) / 1000);
  });
});

describe('WH conservation', () => {
  it('conserves linear momentum, and the COM moves uniformly (a boosted system)', () => {
    const { s, T1 } = hierarchical();
    const boost = [0.1, -0.2, 0.05];
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) s.v[3 * i + c] += boost[c];
    const P0 = momentum(s);
    const M = s.m[0] + s.m[1] + s.m[2];
    run(new WH(), s, T1 / 20, 3000);
    expect(norm(momentum(s), P0)).toBeLessThan(1e-14);
    for (let c = 0; c < 3; c++) {
      const com = (s.m[0] * s.x[c] + s.m[1] * s.x[3 + c] + s.m[2] * s.x[6 + c]) / M;
      // The COM travels to ~V t ~ 100, where one ulp is 1e-14, so allow roundoff relative to that.
      expect(Math.abs(com - boost[c] * s.t)).toBeLessThan(1e-13 * (1 + Math.abs(boost[c] * s.t)));
    }
  });

  it('conserves angular momentum to roundoff', () => {
    const { s, T1 } = hierarchical();
    const L0 = angularMomentum(s);
    const scale = lScale(s);
    run(new WH(), s, T1 / 20, 5000);
    expect(norm(angularMomentum(s), L0) / scale).toBeLessThan(1e-13);
  });

  it('keeps the energy error bounded over 2000 inner orbits (symplectic: no secular drift)', () => {
    const { s, T1 } = hierarchical();
    const E0 = energy(s);
    const perOrbit = 20;
    const orbits = 2000;
    const wh = new WH();
    wh.init(s, { dt: T1 / perOrbit, counters: createCounters() });
    let first = 0;
    let last = 0;
    for (let n = 0; n < orbits * perOrbit; n++) {
      wh.step(s);
      const err = Math.abs(energy(s) - E0) / Math.abs(E0);
      if (n < 20 * perOrbit) first = Math.max(first, err);
      if (n >= (orbits - 20) * perOrbit) last = Math.max(last, err);
    }
    expect(first).toBeGreaterThan(1e-9); // the error is real, not zero by accident
    expect(first).toBeLessThan(1e-5);
    expect(last).toBeLessThan(1.25 * first);
  });
});

describe('WH time reversal and units', () => {
  it('retraces its path to roundoff after a direction flip (symmetric DKD)', () => {
    const { s, T1 } = hierarchical();
    const start = snapshot(s);
    const wh = new WH();
    wh.init(s, { dt: T1 / 20, counters: createCounters() });
    for (let n = 0; n < 1000; n++) wh.step(s);
    wh.setDirection(-1);
    for (let n = 0; n < 1000; n++) wh.step(s);
    expect(s.t).toBeCloseTo(0, 12);
    expect(stateError(s, start)).toBeLessThan(1e-11);
  });

  it('picks up a change to G or a mass between steps, exactly as a fresh integrator would', () => {
    // WH keeps no history, so editing s mid-run must equal starting over from the edited state.
    const { s, T1 } = hierarchical();
    const dt = T1 / 20;
    const wh = new WH();
    wh.init(s, { dt, counters: createCounters() });
    for (let n = 0; n < 5; n++) wh.step(s);
    s.G = 2;
    s.m[1] *= 3;
    const fresh = snapshot(s);
    for (let n = 0; n < 5; n++) wh.step(s);

    const wh2 = new WH();
    wh2.init(fresh, { dt, counters: createCounters() });
    for (let n = 0; n < 5; n++) wh2.step(fresh);
    expect(Array.from(s.x)).toEqual(Array.from(fresh.x));
    expect(Array.from(s.v)).toEqual(Array.from(fresh.v));
  });

  it('uses the current G: G = 3 with speeds x sqrt 3 and dt / sqrt 3 is the same motion', () => {
    const { s: a, T1 } = hierarchical();
    const b = snapshot(a);
    b.G = 3;
    for (let i = 0; i < 9; i++) b.v[i] *= Math.sqrt(3);
    run(new WH(), a, T1 / 20, 300);
    run(new WH(), b, T1 / 20 / Math.sqrt(3), 300);
    for (let i = 0; i < 9; i++) {
      // Equal up to roundoff: the two dt differ by a rounding, and 300 steps amplify it.
      expect(Math.abs(b.x[i] - a.x[i])).toBeLessThan(2e-12);
      expect(Math.abs(b.v[i] / Math.sqrt(3) - a.v[i])).toBeLessThan(2e-12);
    }
  });
});
