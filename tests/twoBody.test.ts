import { describe, expect, it } from 'vitest';
import { KeplerReference } from '../src/sim/analytic';
import { createDiagnostics, characteristicTime, measure, systemSize } from '../src/sim/diagnostics';
import { hasEscaped, minSeparationSquared } from '../src/sim/events';
import { computeAccel, potentialEnergy } from '../src/sim/forces';
import { createIntegrator } from '../src/sim/integrators';
import type { IntegratorId } from '../src/sim/integrators/types';
import { Simulation } from '../src/sim/simulation';
import { createCounters, createState, snapshot } from '../src/sim/state';
import { nudge, rotateState, scaleToBound } from '../src/sim/transforms';
import { shiftToComFrame } from '../src/sim/coords';
import { kepler, keplerPair } from './helpers';

// Two bodies are a system of their own (state.n = 2), not three with a massless one: slot 2 is
// absent, the force kernel skips it, and nothing may ever move it off zero.

const METHODS: { id: IntegratorId; symplecticEuler?: boolean; dt: (T: number) => number }[] = [
  { id: 'euler', dt: (T) => T / 2000 },
  { id: 'euler', symplecticEuler: true, dt: (T) => T / 500 },
  { id: 'leapfrog', dt: (T) => T / 500 },
  { id: 'rk4', dt: (T) => T / 200 },
  { id: 'wh', dt: (T) => T / 50 },
  { id: 'ias15', dt: (T) => T / 100 },
];

function run(s: ReturnType<typeof keplerPair>['s'], method: (typeof METHODS)[number], T: number, periods: number): Simulation {
  const sim = new Simulation(s, {
    integrator: method.id,
    symplecticEuler: method.symplecticEuler,
    params: { dt: method.dt(T) },
    load: { recenter: false },
  });
  sim.advanceTo(periods * T, Infinity);
  return sim;
}

const slot2 = (s: { m: Float64Array; x: Float64Array; v: Float64Array }): number[] => [s.m[2], ...s.x.subarray(6, 9), ...s.v.subarray(6, 9)];

describe('two bodies: the absent slot', () => {
  for (const method of METHODS) {
    it(`${method.id}${method.symplecticEuler ? ' (symplectic)' : ''} leaves slot 2 exactly zero and the pair on its orbit`, () => {
      const { s, T } = keplerPair(0.5);
      const sim = run(s, method, T, 3);
      expect(sim.state.n).toBe(2);
      expect(slot2(sim.state)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(sim.failure).toBeNull();
      // The exact reference is the pair itself. First-order Euler drifts too much over 3 periods
      // for a fixed bound; its order is checked below.
      const err = sim.analyticError();
      expect(Number.isFinite(err)).toBe(true);
      if (method.id !== 'euler') expect(err).toBeLessThan(0.05);
    });
  }

  it('the force kernel gives slot 2 exactly zero and does not read it', () => {
    const { s } = keplerPair();
    // Body 0 at the origin, where the absent slot sits: a massless third body here would be 0 * Infinity.
    s.x.set([0, 0, 0, 1, 0, 0]);
    const a = new Float64Array(9).fill(7);
    computeAccel(s, s.x, a);
    expect(Array.from(a.subarray(6))).toEqual([0, 0, 0]);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(potentialEnergy(s))).toBe(true);
  });

  it('counts one force evaluation per call, as with three bodies', () => {
    const { s } = keplerPair();
    const counters = createCounters();
    computeAccel(s, s.x, new Float64Array(9), counters);
    expect(counters.forceEvals).toBe(1);
  });
});

describe('two bodies: the same physics as a massless third body', () => {
  it('RK4 gives the pair the same motion as the 3-body system with a massless test particle far away', () => {
    const { s: pair, T } = keplerPair(0.6);
    const triple = kepler(0.6, 1, 1, 0.3).s; // body 2 is massless and far away
    const steps = 400;
    const dt = T / 100;
    const a = createIntegrator('rk4');
    const b = createIntegrator('rk4');
    const counters = createCounters();
    a.init(pair, { dt, counters });
    b.init(triple, { dt, counters });
    for (let i = 0; i < steps; i++) {
      a.step(pair);
      b.step(triple);
    }
    for (let i = 0; i < 6; i++) {
      expect(pair.x[i]).toBeCloseTo(triple.x[i], 13);
      expect(pair.v[i]).toBeCloseTo(triple.v[i], 13);
    }
  });

  it('energy and angular momentum agree with the analytic -G m1 m2 / 2a and sqrt(G M a (1 - e^2)) mu', () => {
    const e = 0.5;
    const { s } = keplerPair(e, 1, 1, 0.3);
    const d = createDiagnostics();
    measure(s, d);
    const mu = (1 * 0.3) / 1.3;
    expect(d.energy).toBeCloseTo((-1 * 0.3) / 2, 12);
    expect(d.L[2]).toBeCloseTo(mu * Math.sqrt(1.3 * (1 - e * e)), 12);
    expect(d.minSeparation).toBeCloseTo(Math.hypot(s.x[3] - s.x[0], s.x[4] - s.x[1], s.x[5] - s.x[2]), 15);
  });
});

describe('two bodies: order of accuracy against the exact orbit', () => {
  const errorAt = (id: IntegratorId, T: number, dt: number): number => {
    const { s } = keplerPair(0.3, 1);
    const sim = new Simulation(s, { integrator: id, params: { dt }, load: { recenter: false } });
    sim.advanceTo(T, Infinity);
    return sim.analyticError();
  };

  it('Euler and symplectic Euler are first order', () => {
    const { T } = keplerPair();
    const plain = errorAt('euler', T, T / 2000) / errorAt('euler', T, T / 4000);
    expect(Math.log2(plain)).toBeGreaterThan(0.85);
    expect(Math.log2(plain)).toBeLessThan(1.15);
  });

  it('leapfrog is second order and RK4 fourth order', () => {
    const { T } = keplerPair();
    const lf = errorAt('leapfrog', T, T / 200) / errorAt('leapfrog', T, T / 400);
    const rk = errorAt('rk4', T, T / 40) / errorAt('rk4', T, T / 80);
    expect(Math.log2(lf)).toBeGreaterThan(1.8);
    expect(Math.log2(lf)).toBeLessThan(2.2);
    expect(Math.log2(rk)).toBeGreaterThan(3.7);
    expect(Math.log2(rk)).toBeLessThan(4.3);
  });

  it('IAS15 is exact to its tolerance', () => {
    const { T } = keplerPair();
    expect(errorAt('ias15', 5 * T, T / 50)).toBeLessThan(1e-9);
  });

  it('WH propagates the pair exactly whatever the step: error at roundoff even at T/5', () => {
    const { T } = keplerPair(0.6);
    expect(errorAt('wh', 10 * T, T / 5)).toBeLessThan(1e-11);
  });

  it('WH conserves energy and angular momentum of the pair to roundoff', () => {
    const { s, T } = keplerPair(0.6);
    const sim = run(s, { id: 'wh', dt: (t) => t / 7 }, T, 20);
    const d = createDiagnostics();
    measure(sim.state, d);
    const e0 = createDiagnostics();
    measure(snapshot(sim.baselineSnapshot()), e0);
    expect(Math.abs(d.energy / e0.energy - 1)).toBeLessThan(1e-12);
    expect(Math.abs(d.L[2] / e0.L[2] - 1)).toBeLessThan(1e-12);
    expect(slot2(sim.state)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('WH runs backward and returns to the start', () => {
    const { s, T } = keplerPair(0.4);
    const sim = new Simulation(s, { integrator: 'wh', params: { dt: T / 9 }, load: { recenter: false } });
    sim.advanceTo(3 * T, Infinity);
    sim.setDirection(-1);
    sim.advanceTo(0, Infinity);
    expect(sim.distanceFromBaseline()).toBeLessThan(1e-10);
  });

  it('WH with either body central gives the same orbit', () => {
    const { s, T } = keplerPair(0.4);
    const out = [0, 1].map((central) => {
      const sim = new Simulation(snapshot(s), { integrator: 'wh', params: { dt: T / 10, centralBody: central as 0 | 1 }, load: { recenter: false } });
      sim.advanceTo(2 * T, Infinity);
      return Array.from(sim.state.x.subarray(0, 6));
    });
    out[0].forEach((value, i) => expect(value).toBeCloseTo(out[1][i], 11));
  });
});

describe('two bodies: the analytic reference and the diagnostics', () => {
  it('KeplerReference exists for a pair of massive bodies and not for three', () => {
    expect(KeplerReference.from(keplerPair().s)).not.toBeNull();
    const three = createState();
    three.m.set([1, 1, 1]);
    three.x.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(KeplerReference.from(three)).toBeNull();
  });

  it('closest pair, period and size use only the two bodies', () => {
    const s = createState(1, 0, 2);
    s.m.set([1, 1, 0]);
    s.x.set([100, 0, 0, 102, 0, 0]);
    const d = createDiagnostics();
    measure(s, d);
    expect(d.minSeparation).toBeCloseTo(2, 14);
    expect(minSeparationSquared(s.x, 2)).toBeCloseTo(4, 14);
    expect(systemSize(s)).toBeCloseTo(2, 14); // not the distance to the origin
    expect(characteristicTime(s)).toBeCloseTo(2 * Math.PI * Math.sqrt(8 / 2), 12);
    expect(d.com[0]).toBeCloseTo(101, 14);
  });

  it('the plain mean of two massless bodies is over two', () => {
    const s = createState(1, 0, 2);
    s.x.set([2, 0, 0, 4, 0, 0]);
    const d = createDiagnostics();
    measure(s, d);
    expect(d.com[0]).toBeCloseTo(3, 15);
  });

  it('escape: a hyperbolic pair has both bodies escaping once far apart, a bound one never', () => {
    const bound = keplerPair(0.5).s;
    expect(hasEscaped(bound, 0, 0.1)).toBe(false);
    const fly = createState(1, 0, 2);
    fly.m.set([1, 1, 0]);
    fly.x.set([-50, 0, 0, 50, 0, 0]);
    fly.v.set([-1, 0, 0, 1, 0, 0]);
    expect(hasEscaped(fly, 0, 10)).toBe(true);
    expect(hasEscaped(fly, 1, 10)).toBe(true);
    expect(hasEscaped(fly, 2, 10)).toBe(false);
  });
});

describe('two bodies: edits never move the absent slot', () => {
  const messy = (): ReturnType<typeof keplerPair>['s'] => {
    const { s } = keplerPair(0.5);
    s.x.set([3, 4, 5, 6, 7, 9]);
    s.v.set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    return s;
  };

  it('center-of-mass shift', () => {
    const s = messy();
    shiftToComFrame(s);
    expect(slot2(s)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const d = createDiagnostics();
    measure(s, d);
    expect(Math.hypot(...d.com)).toBeLessThan(1e-14);
    expect(Math.hypot(...d.P)).toBeLessThan(1e-14);
  });

  it('rotation', () => {
    const s = messy();
    rotateState(s, 'x', 30);
    expect(slot2(s)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const d = createDiagnostics();
    const before = createDiagnostics();
    measure(messy(), before);
    measure(s, d);
    expect(d.energy).toBeCloseTo(before.energy, 12);
  });

  it('nudge and scale-to-bound', () => {
    const s = messy();
    nudge(s, { body: 1, target: 'velocity', direction: 'normal', size: 1e-3 });
    scaleToBound(s, 0.5);
    expect(slot2(s)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('snapshot keeps n', () => {
    expect(snapshot(keplerPair().s).n).toBe(2);
    expect(snapshot(kepler().s).n).toBe(3);
  });
});
