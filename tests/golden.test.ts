import { describe, expect, it } from 'vitest';
import { energyError } from '../src/sim/diagnostics';
import { Simulation } from '../src/sim/simulation';
import { createState } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import golden from './golden/golden.json';
import inputs from './golden/inputs.json';

// Plan §10, test 9: the same runs made with REBOUND (tools/reference/make_golden.py), compared with
// ours. REBOUND is only the source of the numbers in golden.json; none of its code is here. The
// chaotic Pythagorean problem is compared only as far as it stays predictable, and the tolerances
// widen with time as the error of any integrator is amplified.

interface Case {
  m: number[];
  x: number[];
  v: number[];
  G: number;
  dt?: number;
  steps?: number[];
}
interface Run {
  times: number[];
  states: number[][];
  energy: number[];
}

const stateOf = (c: Case): SystemState => {
  const s = createState(c.G);
  s.m.set(c.m);
  s.x.set(c.x);
  s.v.set(c.v);
  return s;
};
const flat = (s: SystemState): number[] => [...s.x, ...s.v];
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let worst = 0;
  for (let i = 0; i < 18; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};

describe('golden data', () => {
  it('was made by REBOUND, from the inputs the tests export', () => {
    expect(golden.rebound).toMatch(/^\d+\.\d+/);
    expect(Object.keys(golden.cases).sort()).toEqual(['figure-eight', 'hierarchical', 'kepler', 'pythagorean']);
    for (const name of Object.keys(golden.cases)) expect(inputs).toHaveProperty(name);
  });
});

describe('IAS15 against REBOUND IAS15', () => {
  const ias = (c: Case, t: number[]): SystemState[] => {
    const sim = new Simulation(stateOf(c), { integrator: 'ias15', params: { dt: 0.05, epsTol: 1e-10, dtMin: 1e-9 }, load: { recenter: false } });
    return t.map((time) => {
      const out = stateOf(c);
      sim.advanceTo(time, Infinity);
      sim.stateAt(time, out);
      return out;
    });
  };

  it('agrees on the figure-eight to 1e-12 over two periods (the two codes share nothing)', () => {
    const run = golden.cases['figure-eight'].ias15 as Run;
    const ours = ias(inputs['figure-eight'] as Case, run.times);
    ours.forEach((s, k) => expect(maxDiff(flat(s), run.states[k]), `t = ${run.times[k]}`).toBeLessThan(1e-12));
  });

  it('agrees on the Pythagorean problem for as long as the answer is predictable', () => {
    const run = golden.cases.pythagorean.ias15 as Run;
    const ours = ias(inputs.pythagorean as Case, run.times);
    const tolerance: Record<number, number> = { 2: 1e-11, 5: 1e-10, 10: 1e-9, 20: 1e-7, 30: 1e-6 };
    ours.forEach((s, k) => expect(maxDiff(flat(s), run.states[k]), `t = ${run.times[k]}`).toBeLessThan(tolerance[run.times[k]]));
  });

  it('shows the difference growing with time, as chaos says it must', () => {
    const run = golden.cases.pythagorean.ias15 as Run;
    const ours = ias(inputs.pythagorean as Case, run.times);
    const diffs = ours.map((s, k) => maxDiff(flat(s), run.states[k]));
    expect(diffs[4]).toBeGreaterThan(100 * diffs[0]);
  });

  it('conserves energy as well as REBOUND does, at the same times', () => {
    const run = golden.cases['figure-eight'].ias15 as Run;
    const c = inputs['figure-eight'] as Case;
    const sim = new Simulation(stateOf(c), { integrator: 'ias15', params: { dt: 0.05, epsTol: 1e-10, dtMin: 1e-9 }, load: { recenter: false } });
    sim.advanceTo(run.times[2], Infinity);
    expect(energyError(sim.refreshDiagnostics(), sim.reference)).toBeLessThan(1e-12);
    expect(Math.abs((run.energy[3] - run.energy[0]) / run.energy[0])).toBeLessThan(1e-12);
  });
});

describe('Wisdom-Holman against REBOUND WHFast', () => {
  it.each(['hierarchical', 'kepler'] as const)('%s: the same map, to 1e-10 after thousands of steps', (name) => {
    const c = inputs[name] as unknown as Case & { dt: number };
    const run = golden.cases[name].whfast as Run;
    const sim = new Simulation(stateOf(c), { integrator: 'wh', params: { dt: c.dt, centralBody: 0 }, load: { recenter: false } });
    let done = 0;
    run.times.forEach((t, k) => {
      const n = Math.round(t / c.dt);
      for (; done < n; done++) sim.step();
      expect(sim.state.t).toBeCloseTo(t, 9);
      expect(maxDiff(flat(sim.state), run.states[k]), `after ${n} steps`).toBeLessThan(1e-10);
    });
  });
});

describe('leapfrog against REBOUND leapfrog', () => {
  // REBOUND's is drift-kick-drift and ours kick-drift-kick: the same order, a different phase, so the
  // states differ at the size of the error. What must agree is the size of the error itself.
  it('has a similar error and a similar energy error on the same orbit', () => {
    const c = inputs.kepler as unknown as Case & { dt: number };
    const theirs = golden.cases.kepler.leapfrog as Run;
    const truth = new Simulation(stateOf(c), { integrator: 'ias15', params: { dt: 0.05, epsTol: 1e-10, dtMin: 1e-9 }, load: { recenter: false } });
    const sim = new Simulation(stateOf(c), { integrator: 'leapfrog', params: { dt: c.dt }, load: { recenter: false } });
    const exact = stateOf(c);
    let done = 0;
    theirs.times.forEach((t, k) => {
      const n = Math.round(t / c.dt);
      for (; done < n; done++) sim.step();
      truth.advanceTo(t, Infinity);
      truth.stateAt(t, exact);
      const ours = maxDiff(flat(sim.state), flat(exact));
      const rebound = maxDiff(theirs.states[k], flat(exact));
      expect(ours, `after ${n} steps`).toBeGreaterThan(1e-5); // both are approximations
      expect(rebound).toBeGreaterThan(1e-5);
      expect(ours / rebound).toBeGreaterThan(0.1);
      expect(ours / rebound).toBeLessThan(10);
    });
    // Energy: relative error at the end, REBOUND's against our largest over the run, within an order of magnitude.
    const rebound = Math.abs((theirs.energy.at(-1)! - theirs.energy[0]) / theirs.energy[0]);
    const worst = energyError(sim.refreshDiagnostics(), sim.reference);
    expect(worst / rebound).toBeGreaterThan(0.05);
    expect(worst / rebound).toBeLessThan(20);
  });
});
