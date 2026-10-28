import { describe, expect, it } from 'vitest';
import {
  advanceThrough,
  Cancelled,
  convergenceSweep,
  fastForward,
  fitSlope,
  geometricSeries,
  lyapunov,
  quietContext,
} from '../src/sim/batch';
import type { BatchContext } from '../src/sim/batch';
import { Simulation } from '../src/sim/simulation';
import { createState } from '../src/sim/state';
import { hierarchical, kepler, pythagorean } from './helpers';

describe('geometricSeries and fitSlope', () => {
  it('spaces values evenly in the logarithm, endpoints included', () => {
    const v = geometricSeries(1, 1000, 4);
    expect(v[0]).toBe(1);
    expect(v[1]).toBeCloseTo(10, 12);
    expect(v[2]).toBeCloseTo(100, 12);
    expect(v[3]).toBeCloseTo(1000, 12);
    expect(geometricSeries(5, 50, 1)).toEqual([5]);
  });

  it('recovers the exponent of a power law exactly', () => {
    const dt = geometricSeries(0.1, 0.001, 8);
    for (const p of [1, 2, 4, 15]) {
      const err = dt.map((d) => 3 * d ** p);
      expect(fitSlope(dt, err, 0, Infinity)).toBeCloseTo(p, 10);
    }
  });

  it('leaves out roundoff (below the floor) and the pre-asymptotic runs (above the ceiling)', () => {
    const dt = geometricSeries(1, 0.001, 8);
    // Second order, but flattened at the bottom by roundoff and saturated at the top.
    const err = dt.map((d) => Math.min(Math.max(d ** 2, 1e-15), 0.5));
    expect(fitSlope(dt, err)).toBeCloseTo(2, 10);
  });

  it('is NaN with fewer than two usable runs', () => {
    expect(fitSlope([1, 2], [1e-15, 1e-16])).toBeNaN();
    expect(fitSlope([], [])).toBeNaN();
  });
});

describe('convergenceSweep: the order of each method (plan §10 test 4)', () => {
  const { s, T } = kepler(0.5);
  const sweep = (integrator: Parameters<typeof convergenceSweep>[0]['integrator'], from: number, to: number, symplecticEuler = false) =>
    convergenceSweep({ state: s, integrator, symplecticEuler, duration: T, values: geometricSeries(T * from, T * to, 8) });

  it('measures order 1 for Euler, explicit and symplectic', async () => {
    expect((await sweep('euler', 1 / 400, 1 / 6400)).slope).toBeCloseTo(1, 0);
    const explicit = await sweep('euler', 1 / 800, 1 / 12800);
    const symplectic = await sweep('euler', 1 / 800, 1 / 12800, true);
    expect(Math.abs(explicit.slope - 1)).toBeLessThan(0.15);
    expect(Math.abs(symplectic.slope - 1)).toBeLessThan(0.15);
  });

  it('measures order 2 for leapfrog and 4 for RK4', async () => {
    expect(Math.abs((await sweep('leapfrog', 1 / 100, 1 / 1600)).slope - 2)).toBeLessThan(0.15);
    expect(Math.abs((await sweep('rk4', 1 / 100, 1 / 600)).slope - 4)).toBeLessThan(0.15);
  });

  it('measures order 2 for Wisdom-Holman on a hierarchical system, against IAS15', async () => {
    const { s: h, T1 } = hierarchical();
    const wh = await convergenceSweep({ state: h, integrator: 'wh', centralBody: 0, duration: 3 * T1, values: geometricSeries(T1 / 10, T1 / 160, 8) });
    expect(wh.reference).toBe('ias15');
    expect(Math.abs(wh.slope - 2)).toBeLessThan(0.15);
  });

  it('measures against the exact Kepler solution when one body is massless, and IAS15 otherwise', async () => {
    expect((await sweep('leapfrog', 1 / 50, 1 / 200)).reference).toBe('exact');
    const sweepAll = await convergenceSweep({ state: pythagorean(), integrator: 'rk4', duration: 0.5, values: [0.05, 0.025, 0.0125] });
    expect(sweepAll.reference).toBe('ias15');
    expect(sweepAll.errors[2]).toBeLessThan(sweepAll.errors[0]);
  });

  it('counts force evaluations, for the work-precision diagram: RK4 buys its accuracy with four evaluations per step', async () => {
    const lf = await sweep('leapfrog', 1 / 100, 1 / 400);
    const rk = await sweep('rk4', 1 / 100, 1 / 400);
    // Leapfrog at T/100 takes 100 steps and 101 evaluations; RK4 takes 400.
    expect(lf.forceEvals[0]).toBe(101);
    expect(rk.forceEvals[0]).toBe(400);
    // At equal cost RK4 is far more accurate: its error at 400 evaluations beats leapfrog's at 401.
    expect(rk.errors[0]).toBeLessThan(lf.errors[lf.errors.length - 1]);
  });

  it('uses a whole number of steps, so the run ends exactly at the end time', async () => {
    const r = await sweep('leapfrog', 1 / 77, 1 / 133);
    for (let i = 0; i < r.values.length; i++) expect(Math.abs(T / r.values[i] - Math.round(T / r.values[i]))).toBeLessThan(1e-9);
  });

  it('takes IAS15 values as tolerances, and reaches roundoff at the tight end with a growing cost', async () => {
    const r = await convergenceSweep({ state: s, integrator: 'ias15', duration: 3 * T, values: [1e-4, 1e-6, 1e-8, 1e-10] });
    expect(r.slope).toBeNaN();
    expect(r.errors[3]).toBeLessThan(1e-12);
    expect(r.errors[0]).toBeGreaterThan(r.errors[3]);
    for (let i = 1; i < 4; i++) expect(r.forceEvals[i]).toBeGreaterThan(r.forceEvals[i - 1]);
  });

  it('reports a run that blows up as a failure, with NaN error, and carries on', async () => {
    const close = createState();
    close.m.set([1, 1, 0]);
    close.x.set([-1e-9, 0, 0, 1e-9, 0, 0, 5, 0, 0]);
    close.v.set([0, 1, 0, 0, -1, 0, 0, 0, 0]);
    const r = await convergenceSweep({ state: close, integrator: 'euler', duration: 1, values: [0.5, 1e-3] });
    expect(r.errors).toHaveLength(2);
    expect(r.failures + Array.from(r.errors).filter((e) => e > 1).length).toBeGreaterThan(0);
  });
});

describe('batch context: progress and cancellation', () => {
  const spec = () => {
    const { s, T } = kepler();
    return { state: s, integrator: 'leapfrog' as const, duration: T, values: geometricSeries(T / 50, T / 400, 6) };
  };

  it('reports progress that rises to 1', async () => {
    const seen: number[] = [];
    await convergenceSweep(spec(), { ...quietContext, progress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen.at(-1)).toBe(1);
  });

  it('stops with Cancelled between runs, after the work already done', async () => {
    let runs = 0;
    const ctx: BatchContext = { ...quietContext, cancelled: () => runs >= 2, progress: () => runs++ };
    await expect(convergenceSweep(spec(), ctx)).rejects.toBeInstanceOf(Cancelled);
    expect(runs).toBeLessThan(6);
  });

  it('lets the event loop run between runs (how a Worker hears a cancel message)', async () => {
    let yields = 0;
    await convergenceSweep(spec(), { ...quietContext, yield: async () => void yields++ });
    expect(yields).toBeGreaterThanOrEqual(6);
  });
});

describe('fastForward', () => {
  it('runs a thousand orbits headless and returns the final state and a decimated history', async () => {
    const { s, T } = kepler(0.5);
    const r = await fastForward({ state: s, integrator: 'leapfrog', dt: T / 200, duration: 1000 * T, period: T, points: 500 });
    expect(r.failure).toBeNull();
    expect(r.final.t).toBeGreaterThanOrEqual(1000 * T);
    expect(r.final.t).toBeLessThan(1000 * T + T / 100);
    expect(r.elapsed.length).toBeGreaterThan(200);
    expect(r.elapsed.length).toBeLessThanOrEqual(1000);
    expect(r.energyError.length).toBe(r.elapsed.length);
    // Bounded: leapfrog is symplectic, so the last half of a thousand orbits has no more error than the first.
    const half = Math.floor(r.energyError.length / 2);
    expect(Math.max(...r.energyError)).toBeLessThan(1e-2);
    expect(Math.max(...r.energyError.slice(half)) / Math.max(...r.energyError.slice(0, half))).toBeLessThan(1.5);
    expect(Math.max(...r.angularMomentumError)).toBeLessThan(1e-10);
    expect(r.steps).toBe(Math.round(r.final.t / (T / 200)));
    expect(r.forceEvals).toBeGreaterThan(r.steps);
    expect(r.final.m).toEqual(s.m);
  });

  it('does not touch the state it was given', async () => {
    const { s, T } = kepler();
    const before = Array.from(s.x);
    await fastForward({ state: s, integrator: 'rk4', dt: T / 100, duration: 5 * T, period: T });
    expect(Array.from(s.x)).toEqual(before);
    expect(s.t).toBe(0);
  });

  it('stops and says why when the integration fails', async () => {
    const { s, T } = kepler();
    s.x[0] = NaN;
    const r = await fastForward({ state: s, integrator: 'ias15', dt: T / 100, duration: 5 * T, period: T });
    expect(r.failure).toMatch(/integration failed/);
  });

  it('takes the history from the start time when the system does not start at zero', async () => {
    const { s, T } = kepler();
    s.t = 100;
    const r = await fastForward({ state: s, integrator: 'leapfrog', dt: T / 100, duration: 10 * T, period: T });
    expect(r.final.t).toBeGreaterThanOrEqual(100 + 10 * T);
    expect(r.elapsed[0]).toBe(0);
  });
});

describe('lyapunov', () => {
  const figureEight = () => {
    const s = createState();
    s.m.set([1, 1, 1]);
    s.x.set([0.97000436, -0.24308753, 0, -0.97000436, 0.24308753, 0, 0, 0, 0]);
    s.v.set([0.46620368, 0.43236573, 0, 0.46620368, 0.43236573, 0, -0.93240737, -0.86473146, 0]);
    return s;
  };

  it('finds an estimate that keeps falling for a regular orbit (like ln t / t), and one that holds up for chaos', async () => {
    const regular = await lyapunov({ state: figureEight(), duration: 63, period: 6.3259, intervals: 100 });
    expect(regular.times.length).toBe(100);
    expect(regular.exponent[99] / regular.exponent[24]).toBeLessThan(0.5);
    const chaotic = await lyapunov({ state: pythagorean(), duration: 40, period: 10.9, intervals: 100 });
    expect(chaotic.final).toBeGreaterThan(0.1);
    expect(chaotic.exponent[99] / chaotic.exponent[49]).toBeGreaterThan(1);
    expect(chaotic.lyapunovTime).toBeCloseTo(1 / chaotic.final, 12);
    expect(chaotic.lyapunovTime).toBeLessThan(20);
  });

  it('gives an infinite Lyapunov time when the exponent is not positive, and a time axis that starts after zero', async () => {
    const r = await lyapunov({ state: kepler().s, duration: 10, period: 5.5, intervals: 20 });
    expect(r.times[0]).toBeGreaterThan(0);
    expect(r.times.at(-1)).toBeCloseTo(10, 10);
    expect(r.final < 0 ? r.lyapunovTime : 0).toBe(r.final < 0 ? Infinity : 0);
  });

  it('can be cancelled', async () => {
    let n = 0;
    await expect(lyapunov({ state: figureEight(), duration: 10, period: 6.3, intervals: 50 }, { ...quietContext, cancelled: () => n++ > 3 })).rejects.toBeInstanceOf(Cancelled);
  });

  it('does not touch the state it was given', async () => {
    const s = figureEight();
    const before = Array.from(s.x);
    await lyapunov({ state: s, duration: 6, period: 6.3, intervals: 10 });
    expect(Array.from(s.x)).toEqual(before);
  });
});

describe('advanceThrough', () => {
  it('rides out the stops a live run would pause at, which a headless run has no use for', () => {
    const { s, T } = kepler(0.5);
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    sim.encounterRadius = 10; // inside it from the start
    sim.stopOnEncounter = true;
    const stopped = sim.advanceTo(1, Infinity);
    expect(stopped.status).toBe('event');
    expect(sim.state.t).toBeLessThan(1);

    expect(advanceThrough(sim, 1)).toBe(true);
    expect(sim.state.t).toBeGreaterThanOrEqual(1);
  });

  it('says false when the run failed', () => {
    const s = kepler().s;
    s.x[0] = NaN;
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: 0.01 } });
    expect(advanceThrough(sim, 1)).toBe(false);
    expect(sim.failure).not.toBeNull();
  });
});

describe('batch jobs on a run that fails', () => {
  const onTop = () => {
    const s = createState();
    s.m.set([1, 1, 1]);
    s.x.set([0, 0, 0, 0, 0, 0, 3, 0, 0]); // two bodies on the same spot
    s.v.set([0, 0, 0, 0, 0, 0, 0, 1, 0]);
    return s;
  };

  it('says so in the Lyapunov result instead of looking like a run with no chaos', async () => {
    const r = await lyapunov({ state: onTop(), duration: 5, period: 5, intervals: 10 });
    expect(r.failure).toMatch(/integration failed/);
    expect(r.times.length).toBe(0);
    expect(Number.isNaN(r.final)).toBe(true);
  });

  it('has no failure to report for a run that went through', async () => {
    const r = await lyapunov({ state: pythagorean(), duration: 5, period: 10.9, intervals: 10 });
    expect(r.failure).toBeNull();
    expect(r.times.length).toBe(10);
  });

  it('refuses to measure a sweep against a reference run that failed', async () => {
    await expect(convergenceSweep({ state: onTop(), integrator: 'rk4', duration: 2, values: [0.1, 0.05] })).rejects.toThrow(/reference run failed/);
  });
});
