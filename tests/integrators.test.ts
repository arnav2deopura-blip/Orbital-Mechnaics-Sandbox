import { describe, expect, it } from 'vitest';
import { computeAccel } from '../src/sim/forces';
import { Euler } from '../src/sim/integrators/euler';
import { Leapfrog } from '../src/sim/integrators/leapfrog';
import { RK4 } from '../src/sim/integrators/rk4';
import type { Integrator } from '../src/sim/integrators/types';
import { createCounters, snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { angularMomentum, energy, kepler, lScale, momentum, norm, pairError } from './helpers';

const makers: Record<string, () => Integrator> = {
  euler: () => new Euler(),
  'symplectic euler': () => new Euler(true),
  leapfrog: () => new Leapfrog(),
  rk4: () => new RK4(),
};

function run(integ: Integrator, s: SystemState, dt: number, steps: number) {
  const counters = createCounters();
  integ.init(s, { dt, counters });
  for (let n = 0; n < steps; n++) integ.step(s);
  return counters;
}

describe('integrator contract', () => {
  it.each([
    ['euler', 1, false, 1],
    ['symplectic euler', 1, true, 1],
    ['leapfrog', 2, true, 1],
    ['rk4', 4, false, 4],
  ])('%s declares order %i, symplectic %s, %i force evals per step', (name, order, symplectic, evals) => {
    const integ = makers[name]();
    expect(integ.order).toBe(order);
    expect(integ.symplectic).toBe(symplectic);
    expect(integ.adaptive).toBe(false);
    expect(integ.forceEvalsPerStep).toBe(evals);
  });

  it.each(Object.keys(makers))('%s returns the signed dt taken and advances s.t by it', (name) => {
    const { s } = kepler();
    const integ = makers[name]();
    integ.init(s, { dt: 0.01, counters: createCounters() });
    expect(integ.step(s)).toBe(0.01);
    expect(s.t).toBe(0.01);
    integ.setDirection(-1);
    expect(integ.step(s)).toBe(-0.01);
    expect(s.t).toBeCloseTo(0, 15);
  });

  it.each(Object.keys(makers))('%s picks up a change to params.dt on the next step', (name) => {
    const { s } = kepler();
    const p = { dt: 0.01, counters: createCounters() };
    const integ = makers[name]();
    integ.init(s, p);
    integ.step(s);
    p.dt = 0.02;
    expect(integ.step(s)).toBe(0.02);
  });
});

describe('force evaluation cost', () => {
  it.each([
    ['euler', 100],
    ['symplectic euler', 100],
    ['rk4', 400],
  ])('%s uses exactly its declared evals per step: %i for 100 steps', (name, expected) => {
    expect(run(makers[name](), kepler().s, 0.01, 100).forceEvals).toBe(expected);
  });

  it('leapfrog caches the closing acceleration: 1 eval per step plus 1 to prime it', () => {
    expect(run(new Leapfrog(), kepler().s, 0.01, 100).forceEvals).toBe(101);
  });

  it('leapfrog pays one extra eval after reset() and after a direction flip, but not a repeat flip', () => {
    const { s } = kepler();
    const counters = createCounters();
    const lf = new Leapfrog();
    lf.init(s, { dt: 0.01, counters });
    lf.step(s); // prime + 1
    lf.step(s); // +1
    expect(counters.forceEvals).toBe(3);
    lf.reset();
    lf.step(s);
    expect(counters.forceEvals).toBe(5);
    lf.setDirection(-1);
    lf.step(s);
    expect(counters.forceEvals).toBe(7);
    lf.setDirection(-1); // same direction: cache survives
    lf.step(s);
    expect(counters.forceEvals).toBe(8);
  });

  it('leapfrog with the cache is bit-identical to recomputing both accelerations every step', () => {
    const { s } = kepler();
    const ref = snapshot(s);
    const dt = 0.013;
    const lf = new Leapfrog();
    lf.init(s, { dt, counters: createCounters() });
    const a = new Float64Array(9);
    for (let n = 0; n < 2000; n++) {
      lf.step(s);
      computeAccel(ref, ref.x, a);
      for (let i = 0; i < 9; i++) ref.v[i] += 0.5 * dt * a[i];
      for (let i = 0; i < 9; i++) ref.x[i] += dt * ref.v[i];
      computeAccel(ref, ref.x, a);
      for (let i = 0; i < 9; i++) ref.v[i] += 0.5 * dt * a[i];
    }
    expect(Array.from(s.x)).toEqual(Array.from(ref.x));
    expect(Array.from(s.v)).toEqual(Array.from(ref.v));
  });

  it('leapfrog init() drops the cache, so a re-initialized instance matches a fresh one', () => {
    const lf = new Leapfrog();
    const old = kepler().s;
    lf.init(old, { dt: 0.01, counters: createCounters() });
    for (let n = 0; n < 5; n++) lf.step(old);

    const reused = kepler(0.3, 2).s;
    const fresh = snapshot(reused);
    lf.init(reused, { dt: 0.01, counters: createCounters() });
    lf.step(reused);
    const lf2 = new Leapfrog();
    lf2.init(fresh, { dt: 0.01, counters: createCounters() });
    lf2.step(fresh);
    expect(Array.from(reused.x)).toEqual(Array.from(fresh.x));
    expect(Array.from(reused.v)).toEqual(Array.from(fresh.v));
  });

  it('leapfrog uses a stale cache after an external edit unless reset() is called', () => {
    const edited = (reset: boolean): SystemState => {
      const { s } = kepler();
      const lf = new Leapfrog();
      lf.init(s, { dt: 0.01, counters: createCounters() });
      lf.step(s);
      s.x[0] += 0.05; // a state edit outside step()
      if (reset) lf.reset();
      lf.step(s);
      return s;
    };
    const { s: fresh } = kepler();
    const lf = new Leapfrog();
    lf.init(fresh, { dt: 0.01, counters: createCounters() });
    lf.step(fresh);
    fresh.x[0] += 0.05;
    const copy = snapshot(fresh);
    const lf2 = new Leapfrog();
    lf2.init(copy, { dt: 0.01, counters: createCounters() });
    lf2.step(copy);

    expect(Array.from(edited(true).x)).toEqual(Array.from(copy.x));
    expect(Array.from(edited(false).x)).not.toEqual(Array.from(copy.x));
  });
});

describe('convergence order (global error after one period)', () => {
  // Halving dt should cut the error by 2^p. Each triple of step counts gives two slopes.
  // The counts are chosen so both slopes are in the asymptotic regime: RK4 at 100 steps
  // per orbit is still at slope ~4.3, and the slope settles to within 0.15 by 200.
  const cases: [string, number, number[]][] = [
    ['euler', 1, [8000, 16000, 32000]],
    ['symplectic euler', 1, [2000, 4000, 8000]],
    ['leapfrog', 2, [200, 400, 800]],
    ['rk4', 4, [200, 400, 800]],
  ];

  it.each(cases)('%s converges at order %i', (name, order, counts) => {
    const errors = counts.map((N) => {
      const { s, T } = kepler();
      const ref = snapshot(s);
      run(makers[name](), s, T / N, N);
      return pairError(s, ref);
    });
    for (let i = 0; i < errors.length - 1; i++) {
      const slope = Math.log2(errors[i] / errors[i + 1]);
      expect(Math.abs(slope - order)).toBeLessThan(0.15);
    }
  });
});

describe('conservation', () => {
  it.each(Object.keys(makers))('%s conserves linear momentum to roundoff (nonzero total P)', (name) => {
    const { s, T } = kepler();
    for (let i = 0; i < 2; i++) {
      s.v[3 * i] += 0.3;
      s.v[3 * i + 1] -= 0.2;
    }
    const P0 = momentum(s);
    expect(Math.hypot(...P0)).toBeGreaterThan(0.3);
    run(makers[name](), s, T / 400, 4000);
    expect(norm(momentum(s), P0)).toBeLessThan(1e-13);
  });

  it.each(['leapfrog', 'symplectic euler'])('%s conserves angular momentum to roundoff', (name) => {
    const { s, T } = kepler();
    const L0 = angularMomentum(s);
    const scale = lScale(s);
    run(makers[name](), s, T / 200, 20000);
    expect(norm(angularMomentum(s), L0) / scale).toBeLessThan(1e-13);
  });

  it('leapfrog energy error stays bounded over 10^4 orbits (no secular drift)', () => {
    const { s, T } = kepler();
    const E0 = energy(s);
    const perOrbit = 100;
    const lf = new Leapfrog();
    lf.init(s, { dt: T / perOrbit, counters: createCounters() });
    let first = 0;
    let last = 0;
    const orbits = 10000;
    for (let n = 0; n < orbits * perOrbit; n++) {
      lf.step(s);
      const err = Math.abs(energy(s) - E0) / Math.abs(E0);
      if (n < 10 * perOrbit) first = Math.max(first, err);
      if (n >= (orbits - 10) * perOrbit) last = Math.max(last, err);
    }
    expect(first).toBeGreaterThan(1e-6); // the error is real, not zero by accident
    expect(first).toBeLessThan(0.1);
    expect(last).toBeLessThan(1.5 * first);
  });

  it('explicit Euler gains energy while the symplectic variant stays bounded', () => {
    const peak = (name: string): { max: number; final: number } => {
      const { s, T } = kepler();
      const E0 = energy(s);
      const integ = makers[name]();
      integ.init(s, { dt: T / 1000, counters: createCounters() });
      let max = 0;
      for (let n = 0; n < 20000; n++) {
        integ.step(s);
        max = Math.max(max, Math.abs(energy(s) - E0) / Math.abs(E0));
      }
      return { max, final: (energy(s) - E0) / Math.abs(E0) };
    };
    const explicit = peak('euler');
    const symplectic = peak('symplectic euler');
    expect(explicit.final).toBeGreaterThan(0);
    expect(symplectic.max).toBeLessThan(0.05);
    expect(explicit.max).toBeGreaterThan(10 * symplectic.max);
  });
});

describe('time reversal', () => {
  /** N steps forward, flip direction, N steps back. Returns the distance from the start. */
  const roundTrip = (name: string): number => {
    const { s, T } = kepler();
    const start = snapshot(s);
    const integ = makers[name]();
    integ.init(s, { dt: T / 200, counters: createCounters() });
    for (let n = 0; n < 1000; n++) integ.step(s);
    integ.setDirection(-1);
    for (let n = 0; n < 1000; n++) integ.step(s);
    expect(s.t).toBeCloseTo(0, 12);
    return pairError(s, start);
  };

  it('leapfrog retraces its path to roundoff', () => {
    expect(roundTrip('leapfrog')).toBeLessThan(1e-12);
  });

  it.each(['euler', 'rk4'])('%s does not retrace its path', (name) => {
    expect(roundTrip(name)).toBeGreaterThan(1e-8);
  });
});

describe('state handling', () => {
  it.each(Object.keys(makers))('%s never modifies m, G or eps2', (name) => {
    const { s } = kepler();
    s.G = 2;
    s.eps2 = 0.01;
    const m = Array.from(s.m);
    run(makers[name](), s, 0.01, 10);
    expect(Array.from(s.m)).toEqual(m);
    expect(s.G).toBe(2);
    expect(s.eps2).toBe(0.01);
  });
});
