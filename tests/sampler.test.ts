import { describe, expect, it } from 'vitest';
import { KeplerReference } from '../src/sim/analytic';
import { angularMomentumError, energyError } from '../src/sim/diagnostics';
import { IAS15 } from '../src/sim/integrators/ias15';
import { WH } from '../src/sim/integrators/wh';
import { Sampler, SERIES } from '../src/sim/sampler';
import { Simulation } from '../src/sim/simulation';
import { createState, snapshot } from '../src/sim/state';
import { kepler, keplerExact } from './helpers';

const FOREVER = Infinity;

function run(
  capacity: number,
  periods: number,
  e = 0.5,
  integrator: 'leapfrog' | 'ias15' = 'leapfrog',
): { sim: Simulation; sampler: Sampler; T: number } {
  const { s, T } = kepler(e);
  const sim = new Simulation(s, { integrator, params: { dt: integrator === 'ias15' ? T / 100 : T / 1000 } });
  const sampler = new Sampler(capacity);
  sampler.clear(T);
  sampler.record(sim);
  sim.onStep = () => sampler.record(sim);
  sim.advanceTo(periods * T, FOREVER);
  return { sim, sampler, T };
}

describe('Sampler', () => {
  it('takes about 200 samples per period, from true states, starting with the initial one', () => {
    const { sampler, sim } = run(20000, 1);
    expect(sampler.length).toBeGreaterThan(198);
    expect(sampler.length).toBeLessThan(204);
    expect(sampler.x[0]).toBe(0);
    expect(sampler.values.forceEvals[sampler.length - 1]).toBeLessThanOrEqual(sim.counters.forceEvals);
    expect(sampler.values.forceEvals[sampler.length - 1]).toBeGreaterThan(900);
  });

  it('samples every series: errors at roundoff for conserved quantities, bounded for energy', () => {
    const { sampler, sim } = run(20000, 5);
    const n = sampler.length;
    const max = (key: keyof typeof sampler.values): number => Math.max(...sampler.values[key].subarray(0, n));
    expect(max('energyError')).toBeGreaterThan(0);
    expect(max('energyError')).toBeLessThan(1e-4);
    expect(max('angularMomentumError')).toBeLessThan(1e-12);
    expect(max('momentumError')).toBeLessThan(1e-12);
    expect(max('comDrift')).toBeLessThan(1e-12);
    const sep = sampler.values.minSeparation;
    expect(Math.min(...sep.subarray(0, n))).toBeGreaterThan(0.45); // a = 1, e = 0.5: pericenter 0.5
    expect(sampler.values.dt[n - 1]).toBeCloseTo(sim.params.dt, 12);
    // The last sample agrees with measuring the state right then (within one interval's drift).
    const last = energyError(sim.refreshDiagnostics(), sim.reference);
    expect(Math.abs(last - sampler.values.energyError[n - 1])).toBeLessThan(2e-5);
    expect(angularMomentumError(sim.refreshDiagnostics(), sim.reference)).toBeLessThan(1e-12);
  });

  it('measures time as elapsed, so it keeps growing through a reversal', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const sampler = new Sampler(20000);
    sampler.clear(T);
    sampler.record(sim);
    sim.onStep = () => sampler.record(sim);
    sim.advanceTo(T, FOREVER);
    const forward = sampler.length;
    sim.setDirection(-1);
    sim.advanceTo(0, FOREVER);
    expect(sampler.length).toBeGreaterThan(1.9 * forward);
    for (let i = 1; i < sampler.length; i++) expect(sampler.x[i]).toBeGreaterThan(sampler.x[i - 1]);
    expect(sampler.x[sampler.length - 1]).toBeCloseTo(2 * T, 1);
  });

  it('thins 2:1 when full, keeping the whole run and the extremes', () => {
    const small = run(32, 30, 0.8);
    const big = run(20000, 30, 0.8);
    expect(small.sampler.length).toBeLessThanOrEqual(32);
    expect(small.sampler.length).toBeGreaterThan(15);
    // The thinned history still spans the run.
    expect(small.sampler.x[small.sampler.length - 1]).toBeGreaterThan(0.95 * big.sampler.x[big.sampler.length - 1]);
    for (let i = 1; i < small.sampler.length; i++) expect(small.sampler.x[i]).toBeGreaterThan(small.sampler.x[i - 1]);
    // The extremes survive: the largest error and the closest approach are the same as without thinning.
    const extremes = (s: Sampler): [number, number] => [
      Math.max(...s.values.energyError.subarray(0, s.length)),
      Math.min(...s.values.minSeparation.subarray(0, s.length)),
    ];
    const [errSmall, sepSmall] = extremes(small.sampler);
    const [errBig, sepBig] = extremes(big.sampler);
    expect(errSmall).toBeCloseTo(errBig, 12);
    expect(sepSmall).toBe(sepBig);
    // The cumulative cost keeps its last value, so it stays monotone.
    const evals = small.sampler.values.forceEvals;
    for (let i = 1; i < small.sampler.length; i++) expect(evals[i]).toBeGreaterThanOrEqual(evals[i - 1]);
  });

  it('keeps the spacing even after thinning: later samples fold in as many raw ones as the stored ones do', () => {
    const { sampler } = run(32, 60);
    const gaps = [];
    for (let i = 2; i < sampler.length; i++) gaps.push(sampler.x[i] - sampler.x[i - 1]);
    // One bin straddling a thinning is half size; all the rest match.
    const typical = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    expect(gaps.filter((g) => Math.abs(g - typical) > 0.6 * typical).length).toBeLessThanOrEqual(2);
  });

  it('marks the time axis, caps the marks, and clears with the data', () => {
    const { sampler, T } = run(20000, 1);
    sampler.mark('integrator: RK4');
    expect(sampler.markers).toHaveLength(1);
    expect(sampler.markers[0].x).toBeCloseTo(T, 1);
    for (let i = 0; i < 100; i++) sampler.mark(`m${i}`);
    expect(sampler.markers.length).toBe(64);
    expect(sampler.markers.at(-1)?.label).toBe('m99');
    sampler.clear(T, 100);
    expect(sampler.markers).toHaveLength(0);
    expect(sampler.length).toBe(0);
    expect(sampler.interval).toBeCloseTo(T / 100, 15);
  });

  it('bumps its version on every change, so a chart redraws only when needed', () => {
    const { sampler } = run(20000, 0.5);
    const v = sampler.version;
    sampler.mark('x');
    expect(sampler.version).toBeGreaterThan(v);
  });

  it('restarts the elapsed time and the center-of-mass reference after a clear', () => {
    const { sampler, sim, T } = run(20000, 1);
    sampler.clear(T);
    sampler.record(sim);
    expect(sampler.length).toBe(1);
    expect(sampler.x[0]).toBe(0);
  });

  it('reports which series have data: the analytic error needs one massless body', () => {
    const k = run(20000, 0.5);
    expect(k.sampler.has('analyticError')).toBe(true);
    expect(k.sampler.has('energyError')).toBe(true);

    const eight = createState();
    eight.m.set([1, 1, 1]);
    eight.x.set([0.97000436, -0.24308753, 0, -0.97000436, 0.24308753, 0, 0, 0, 0]);
    eight.v.set([0.46620368, 0.43236573, 0, 0.46620368, 0.43236573, 0, -0.93240737, -0.86473146, 0]);
    const sim = new Simulation(eight, { integrator: 'leapfrog', params: { dt: 0.001 } });
    const sampler = new Sampler(1000);
    sampler.clear(6.3);
    sampler.record(sim);
    sim.onStep = () => sampler.record(sim);
    sim.advanceTo(1, FOREVER);
    expect(sampler.has('analyticError')).toBe(false);
  });

  it('writes CSV with only the series that have data', () => {
    const { sampler } = run(20000, 0.25);
    const lines = sampler.toCsv().trim().split('\n');
    expect(lines[0].startsWith('elapsed_time,energyError,angularMomentumError,')).toBe(true);
    expect(lines[0]).toContain('analyticError');
    expect(lines).toHaveLength(sampler.length + 1);
    expect(lines[1].split(',')).toHaveLength(lines[0].split(',').length);
  });

  it('lists every series once, with a hint for the chart', () => {
    expect(new Set(SERIES.map((s) => s.key)).size).toBe(SERIES.length);
    for (const spec of SERIES) expect(spec.hint.length).toBeGreaterThan(10);
  });

  it('shows the energy-error signatures of the methods (plan §6): bounded, linear drift, growth', () => {
    const peak = (id: 'leapfrog' | 'rk4' | 'euler', dtFraction: number, periods: number): { early: number; late: number } => {
      const { s, T } = kepler(0.3);
      const sim = new Simulation(s, { integrator: id, params: { dt: T * dtFraction } });
      const sampler = new Sampler(20000);
      sampler.clear(T);
      sampler.record(sim);
      sim.onStep = () => sampler.record(sim);
      sim.advanceTo(periods * T, FOREVER);
      const v = sampler.values.energyError;
      const n = sampler.length;
      const slice = (a: number, b: number): number => Math.max(...v.subarray(Math.floor(a * n), Math.floor(b * n)));
      return { early: slice(0.1, 0.2), late: slice(0.9, 1) };
    };
    const leap = peak('leapfrog', 1 / 100, 100);
    expect(leap.late / leap.early).toBeLessThan(1.5); // bounded: no growth
    // RK4 drifts: the error is about proportional to time, so 0.95 of the run against 0.15 gives about 6.
    const rk4 = peak('rk4', 1 / 50, 300);
    expect(rk4.late / rk4.early).toBeGreaterThan(3.5);
    expect(rk4.late / rk4.early).toBeLessThan(8);
    // Euler is far worse: a large error that keeps climbing (relative to E0 it saturates toward 1 as the orbit unbinds).
    const euler = peak('euler', 1 / 5000, 30);
    expect(euler.early).toBeGreaterThan(0.05);
    expect(euler.late / euler.early).toBeGreaterThan(2.5);
  });
});

describe('KeplerReference', () => {
  it('exists only for exactly one massless body and no softening', () => {
    expect(KeplerReference.from(kepler().s)).not.toBeNull();
    const eight = kepler().s;
    eight.m[2] = 1;
    expect(KeplerReference.from(eight)).toBeNull();
    const softened = kepler().s;
    softened.eps2 = 1e-4;
    expect(KeplerReference.from(softened)).toBeNull();
    const two = kepler().s;
    two.m[1] = 0;
    expect(KeplerReference.from(two)).toBeNull();
  });

  it('is zero at the start and tracks IAS15 to its tolerance, forward and backward', () => {
    const { s, T } = kepler(0.5);
    const ref = KeplerReference.from(s)!;
    expect(ref.error(s)).toBeLessThan(1e-15);
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100, epsTol: 1e-12 } });
    sim.advanceTo(3.3 * T, FOREVER);
    expect(sim.analyticError()).toBeLessThan(1e-8);
    sim.setDirection(-1);
    sim.advanceTo(-1.7 * T, FOREVER);
    expect(sim.analyticError()).toBeLessThan(1e-8);
  });

  it('sees the error of a fixed-step method grow, and agrees with the closed form of the test helpers', () => {
    const { s, T } = kepler(0.5);
    const sim = new Simulation(s, { integrator: 'euler', params: { dt: T / 2000 } });
    sim.advanceTo(2 * T, FOREVER);
    const err = sim.analyticError();
    expect(err).toBeGreaterThan(1e-3);

    // Independent check: perturb the exact solution of the helpers by 1e-3 in x of body 0.
    const t = 0.7 * T;
    const exact = keplerExact(0.5, 1, t);
    const off = snapshot(exact);
    off.x[0] += 1e-3;
    expect(KeplerReference.from(kepler(0.5).s)!.error(off)).toBeCloseTo(1e-3, 9);
  });

  it('follows a pair whose center of mass moves and is off the origin', () => {
    const { s, T } = kepler(0.5);
    for (let i = 0; i < 3; i++) {
      s.x[3 * i] += 7;
      s.x[3 * i + 2] -= 2;
      s.v[3 * i + 1] += 0.3;
    }
    // RK4, not IAS15: far from the origin IAS15's error estimate reads roundoff as truncation error and
    // its step collapses (see the note in ias15.ts), which is a limit of the method, not of this check.
    const sim = new Simulation(s, { integrator: 'rk4', params: { dt: T / 4000 }, load: { recenter: false } });
    sim.advanceTo(2.2 * T, FOREVER);
    expect(sim.analyticError()).toBeLessThan(1e-7);
  });

  it('is NaN in the Simulation when there is nothing to compare with', () => {
    const s = kepler().s;
    s.m[2] = 0.5;
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: 0.01 } });
    expect(sim.analyticError()).toBeNaN();
  });
});

describe('integrator health events', () => {
  it('stops at the first minimum-step hit of IAS15, once, and keeps counting', () => {
    const { s, T } = kepler(0.9, 3);
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100, dtMin: T / 8 } });
    const events: string[] = [];
    sim.onEvent = (message) => events.push(message);
    const first = sim.advanceTo(T, FOREVER);
    expect(first.status).toBe('event');
    expect(events[0]).toBe('IAS15 reached its minimum step: a close encounter it cannot resolve');
    expect(sim.warning).toMatch(/minimum step 1 time: close encounter unresolved/);

    const next = sim.advanceTo(1.5 * T, FOREVER);
    expect(next.status).toBe('reached'); // does not stop on every step after the first
    expect(events.filter((e) => e.includes('minimum step'))).toHaveLength(1);
    expect((sim.integrator as IAS15).dtMinHits).toBeGreaterThan(1);
    expect(sim.warning).toMatch(/minimum step \d+ times/);

    sim.reset();
    expect(sim.warning).toBeNull();
  });

  it('notes a corrector that did not converge without stopping', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100 } });
    (sim.integrator as IAS15).convergenceFailures = 3;
    expect(sim.step()).toBe(true);
    expect(sim.warning).toMatch(/did not converge 3 times/);
  });

  it('stops when the Kepler solver of Wisdom-Holman fails', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'wh', params: { dt: T / 100 } });
    const events: string[] = [];
    sim.onEvent = (message) => events.push(message);
    (sim.integrator as WH).keplerFailures = 1;
    expect(sim.advanceTo(T, FOREVER).status).toBe('event');
    expect(events).toEqual(['the Kepler solver did not converge']);
    expect(sim.warning).toMatch(/Kepler solver failed to converge 1 time$/);
  });

  it('reports close encounters to onEvent', () => {
    const { s, T } = kepler(0.9, 3);
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100 } });
    const events: string[] = [];
    sim.onEvent = (message) => events.push(message);
    sim.encounterRadius = 0.3;
    sim.advanceTo(T, FOREVER);
    expect(events).toEqual(['close encounter']);
    expect(sim.warning).toBeNull(); // an encounter is not a fault of the integrator
  });

  it('clears the warning when the method is switched', () => {
    const { s, T } = kepler(0.9, 3);
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100, dtMin: T / 8 } });
    sim.advanceTo(T, FOREVER);
    expect(sim.warning).not.toBeNull();
    sim.setIntegrator('leapfrog');
    expect(sim.warning).toBeNull();
  });

  it('says nothing for the fixed-step methods', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'rk4', params: { dt: T / 200 } });
    sim.advanceTo(T, FOREVER);
    expect(sim.warning).toBeNull();
  });
});
