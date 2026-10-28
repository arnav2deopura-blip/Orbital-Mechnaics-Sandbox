import { describe, expect, it } from 'vitest';
import { angularMomentumError, energyError } from '../src/sim/diagnostics';
import type { Integrator } from '../src/sim/integrators/types';
import { Simulation } from '../src/sim/simulation';
import type { SimulationOptions } from '../src/sim/simulation';
import { createState, snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { hierarchical, kepler, keplerExact, pairError, stateError } from './helpers';

const FOREVER = Infinity;

function leapfrogSim(extra: Partial<SimulationOptions> = {}, e = 0.5): { sim: Simulation; T: number; dt: number } {
  const { s, T } = kepler(e);
  const dt = T / 1000;
  return { sim: new Simulation(s, { integrator: 'leapfrog', params: { dt }, ...extra }), T, dt };
}

describe('load', () => {
  it('copies the system, moves it to the COM frame and takes the reference from it', () => {
    const { s } = kepler();
    for (let i = 0; i < 3; i++) {
      s.x[3 * i] += 100;
      s.v[3 * i + 1] += 2;
    }
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: 0.01 } });
    expect(sim.state).not.toBe(s);
    const d = sim.refreshDiagnostics();
    expect(Math.hypot(...d.com)).toBeLessThan(1e-12);
    expect(Math.hypot(...d.P)).toBeLessThan(1e-12);
    expect(sim.reference.energy).toBeCloseTo(d.energy, 14);
    expect(s.x[0]).toBeGreaterThan(50); // the input was not touched
  });

  it('keeps the offset when recenter is false', () => {
    const { s } = kepler();
    s.x[0] += 1e3;
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: 0.01 } });
    sim.load(s, { recenter: false });
    expect(sim.state.x[0]).toBe(s.x[0]);
  });

  it('restarts counters and bumps the revision, but keeps t from the new state', () => {
    const { sim } = leapfrogSim();
    sim.advanceTo(0.5, FOREVER);
    expect(sim.counters.stepCount).toBeGreaterThan(0);
    const before = sim.revision;
    const edited = snapshot(sim.state);
    edited.m[2] = 0.1;
    sim.load(edited);
    expect(sim.counters).toEqual({ stepCount: 0, forceEvals: 0, rejectedSteps: 0 });
    expect(sim.revision).toBeGreaterThan(before);
    expect(sim.state.t).toBe(edited.t);
    expect(sim.state.m[2]).toBe(0.1);
  });

  it('re-baselines on an edit: errors are measured from the edited state', () => {
    const { sim } = leapfrogSim();
    sim.advanceTo(1, FOREVER);
    const edited = snapshot(sim.state);
    edited.x[8] += 3; // move body 2 out of the plane
    sim.load(edited, { recenter: false });
    const d = sim.refreshDiagnostics();
    expect(energyError(d, sim.reference)).toBe(0);
    expect(angularMomentumError(d, sim.reference)).toBe(0);
    expect(sim.reference.energy).toBeCloseTo(d.energy, 15);
  });

  it('declares a period for T_char when given one, and measures it otherwise', () => {
    const { s } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: 0.01 } });
    const measured = sim.reference.period;
    sim.load(s, { period: 12.5 });
    expect(sim.reference.period).toBe(12.5);
    sim.load(s);
    expect(sim.reference.period).toBe(measured);
  });
});

describe('advanceTo', () => {
  it('runs until the state has just passed the target, with the target inside the last step', () => {
    const { sim, T, dt } = leapfrogSim();
    const target = T / 3;
    const result = sim.advanceTo(target, FOREVER);
    expect(result.status).toBe('reached');
    expect(sim.state.t).toBeGreaterThanOrEqual(target);
    expect(sim.state.t - target).toBeLessThan(dt);
    expect(sim.prev.t).toBeLessThan(target);
    expect(result.steps).toBe(Math.ceil(target / dt));
    expect(sim.counters.stepCount).toBe(result.steps);
  });

  it('takes no step when the state is already past the target', () => {
    const { sim } = leapfrogSim();
    sim.advanceTo(1, FOREVER);
    const t = sim.state.t;
    const result = sim.advanceTo(0.5, FOREVER);
    expect(result.steps).toBe(0);
    expect(sim.state.t).toBe(t);
  });

  it('runs backward to a target in the past after a direction flip', () => {
    const { sim, dt } = leapfrogSim();
    sim.advanceTo(1, FOREVER);
    sim.setDirection(-1);
    const result = sim.advanceTo(0.25, FOREVER);
    expect(result.status).toBe('reached');
    expect(sim.state.t).toBeLessThanOrEqual(0.25);
    expect(0.25 - sim.state.t).toBeLessThan(dt);
  });

  it('stops at the deadline, which it reads every 32 steps', () => {
    let now = 0;
    const { sim } = leapfrogSim({ clock: () => now++ });
    // The deadline is already behind the first reading.
    const result = sim.advanceTo(100, -1);
    expect(result.status).toBe('budget');
    expect(result.steps).toBe(32);
    expect(sim.state.t).toBeLessThan(100);
  });

  it('does not check the clock for a short job, whatever the deadline', () => {
    const { sim } = leapfrogSim({ clock: () => 1e9 });
    const result = sim.advanceTo(0.01, 0); // 5 steps
    expect(result.status).toBe('reached');
    expect(result.steps).toBeLessThan(32);
  });

  it('can continue after a budget stop', () => {
    let now = 0;
    const { sim } = leapfrogSim({ clock: () => now++ });
    sim.advanceTo(100, -1);
    const t = sim.state.t;
    sim.advanceTo(100, -1);
    expect(sim.state.t).toBeGreaterThan(t);
  });

  it('calls onStep with the true state after each accepted step', () => {
    const { sim } = leapfrogSim();
    const times: number[] = [];
    sim.onStep = (s) => times.push(s.t);
    sim.advanceTo(0.05, FOREVER);
    expect(times).toHaveLength(sim.counters.stepCount);
    expect(times[0]).toBeCloseTo(sim.params.dt, 15);
  });

  it('reuses its result object', () => {
    const { sim } = leapfrogSim();
    expect(sim.advanceTo(0.1, FOREVER)).toBe(sim.advanceTo(0.2, FOREVER));
  });

  it('picks up a changed dt on the next step, since the integrator shares params', () => {
    const { sim, dt } = leapfrogSim();
    sim.step();
    sim.params.dt = 3 * dt;
    sim.step();
    expect(sim.state.t).toBeCloseTo(4 * dt, 14);
    expect(sim.currentDt()).toBe(3 * dt);
  });
});

describe('step', () => {
  it('takes exactly one step, in the running direction', () => {
    const { sim, dt } = leapfrogSim();
    expect(sim.step()).toBe(true);
    expect(sim.state.t).toBeCloseTo(dt, 15);
    sim.setDirection(-1);
    sim.step();
    expect(sim.state.t).toBeCloseTo(0, 15);
  });
});

describe('failure', () => {
  const nanOnSecondStep = (): Integrator => {
    let calls = 0;
    return {
      id: 'euler',
      order: 1,
      symplectic: false,
      adaptive: false,
      forceEvalsPerStep: 1,
      init() {},
      step(s) {
        s.t += 0.1;
        s.x[0] += 0.1;
        if (++calls === 2) s.x[4] = NaN;
        return 0.1;
      },
      reset() {},
      setDirection() {},
    };
  };

  it('puts back the last good state, says where, and refuses to go on', () => {
    const { sim } = leapfrogSim();
    sim.integrator = nanOnSecondStep();
    const result = sim.advanceTo(10, FOREVER);
    expect(result.status).toBe('failed');
    expect(result.steps).toBe(1);
    expect(Number.isFinite(sim.state.x[4])).toBe(true);
    expect(sim.state.t).toBeCloseTo(0.1, 15);
    expect(sim.failure).toMatch(/integration failed at t=0\.100000, min separation \d/);
    expect(sim.counters.stepCount).toBe(1);

    const again = sim.advanceTo(10, FOREVER);
    expect(again.status).toBe('failed');
    expect(again.steps).toBe(0);
    expect(sim.step()).toBe(false);
  });

  it('is cleared by reset, and by switching integrator', () => {
    const { sim } = leapfrogSim();
    sim.integrator = nanOnSecondStep();
    sim.advanceTo(10, FOREVER);
    sim.reset();
    expect(sim.failure).toBeNull();

    sim.integrator = nanOnSecondStep();
    sim.advanceTo(10, FOREVER);
    expect(sim.failure).not.toBeNull();
    sim.setIntegrator('rk4');
    expect(sim.failure).toBeNull();
    expect(sim.advanceTo(0.2, FOREVER).status).toBe('reached');
  });

  it('does not call a state failed because its numbers are large: only NaN and infinity are', () => {
    const { sim } = leapfrogSim();
    sim.integrator = {
      id: 'euler',
      order: 1,
      symplectic: false,
      adaptive: false,
      forceEvalsPerStep: 1,
      init() {},
      step(s) {
        s.t += 0.1;
        return 0.1;
      },
      reset() {},
      setDirection() {},
    };
    // Each coordinate is finite, but their sum is not.
    sim.state.x[0] = 1e308;
    sim.state.x[3] = 1e308;
    sim.state.v[1] = 1e308;
    sim.state.v[4] = 1e308;
    expect(sim.advanceTo(0.3, FOREVER).status).toBe('reached');
    expect(sim.failure).toBeNull();
    sim.state.x[4] = Infinity;
    expect(sim.advanceTo(1, FOREVER).status).toBe('failed');
  });

  it('treats an adaptive method that cannot step (IAS15 on a NaN state) as a failure', () => {
    const s = kepler().s;
    s.x[0] = NaN;
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: 0.01 } });
    expect(sim.step()).toBe(false);
    expect(sim.failure).toMatch(/integration failed/);
  });
});

describe('setIntegrator', () => {
  it('continues from the current state and keeps the reference, so errors reflect the new method', () => {
    const { sim } = leapfrogSim();
    sim.advanceTo(1, FOREVER);
    const ref = sim.reference;
    const before = snapshot(sim.state);
    const revision = sim.revision;
    sim.setIntegrator('rk4');
    expect(sim.integrator.id).toBe('rk4');
    expect(sim.reference).toBe(ref);
    expect(sim.state).toEqual(before);
    expect(sim.revision).toBeGreaterThan(revision);
    sim.advanceTo(2, FOREVER);
    expect(sim.state.t).toBeGreaterThanOrEqual(2);
    expect(energyError(sim.refreshDiagnostics(), sim.reference)).toBeLessThan(1e-4);
  });

  it('selects the symplectic form of Euler', () => {
    const { sim } = leapfrogSim();
    sim.setIntegrator('euler', true);
    expect(sim.integrator.symplectic).toBe(true);
    sim.setIntegrator('euler');
    expect(sim.integrator.symplectic).toBe(false);
  });

  it('keeps the direction', () => {
    const { sim, dt } = leapfrogSim();
    sim.setDirection(-1);
    sim.setIntegrator('rk4');
    sim.step();
    expect(sim.state.t).toBeCloseTo(-dt, 15);
  });

  it('rejects WH with softening and leaves the running method alone', () => {
    const { sim } = leapfrogSim();
    sim.advanceTo(0.1, FOREVER);
    const edited = snapshot(sim.state);
    edited.eps2 = 1e-4;
    sim.load(edited);
    expect(() => sim.setIntegrator('wh')).toThrow(RangeError);
    expect(sim.integrator.id).toBe('leapfrog');
  });

  it('runs WH on a hierarchical system', () => {
    const { s, T1 } = hierarchical();
    const sim = new Simulation(s, { integrator: 'wh', params: { dt: T1 / 50 } });
    sim.advanceTo(3 * T1, FOREVER);
    expect(energyError(sim.refreshDiagnostics(), sim.reference)).toBeLessThan(1e-4);
  });
});

describe('reset', () => {
  it('returns to the state of the last load, with fresh counters and no failure', () => {
    const { sim } = leapfrogSim();
    const start = snapshot(sim.state);
    sim.advanceTo(1, FOREVER);
    sim.reset();
    expect(sim.state).toEqual(start);
    expect(sim.counters.stepCount).toBe(0);
    expect(sim.counters.forceEvals).toBe(0);
  });

  it('returns to the edited state after an edit, which is the new baseline', () => {
    const { sim } = leapfrogSim();
    sim.advanceTo(1, FOREVER);
    const edited = snapshot(sim.state);
    edited.m[0] = 2;
    sim.load(edited);
    const baseline = snapshot(sim.state);
    sim.advanceTo(2, FOREVER);
    sim.reset();
    expect(sim.state).toEqual(baseline);
  });

  it('keeps the reference and the direction', () => {
    const { sim, dt } = leapfrogSim();
    const ref = sim.reference;
    sim.setDirection(-1);
    sim.advanceTo(-1, FOREVER);
    sim.reset();
    expect(sim.reference).toBe(ref);
    expect(sim.direction).toBe(-1);
    sim.step();
    expect(sim.state.t).toBeCloseTo(-dt, 15);
  });

  it('restarts IAS15 from its first-guess dt', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100, epsTol: 1e-9 } });
    expect(sim.currentDt()).toBe(T / 100);
    sim.advanceTo(T, FOREVER);
    sim.reset();
    expect(sim.currentDt()).toBe(T / 100);
  });
});

describe('time reversal', () => {
  it('retraces the path under leapfrog to roundoff', () => {
    const { sim } = leapfrogSim();
    const start = snapshot(sim.state);
    for (let i = 0; i < 300; i++) sim.step();
    expect(stateError(sim.state, start)).toBeGreaterThan(0.01);
    sim.setDirection(-1);
    for (let i = 0; i < 300; i++) sim.step();
    expect(stateError(sim.state, start)).toBeLessThan(1e-11);
    expect(Math.abs(sim.state.t)).toBeLessThan(1e-13);
  });

  it('does not bump the revision when the direction is unchanged', () => {
    const { sim } = leapfrogSim();
    const revision = sim.revision;
    sim.setDirection(1);
    expect(sim.revision).toBe(revision);
  });
});

describe('stateAt', () => {
  it('is exact at both ends of the step and clamps outside it', () => {
    const { sim } = leapfrogSim();
    sim.advanceTo(0.1, FOREVER);
    const out = createState();
    sim.stateAt(sim.state.t, out);
    expect(out.x).toEqual(sim.state.x);
    expect(out.v).toEqual(sim.state.v);
    sim.stateAt(sim.prev.t, out);
    expect(out.x).toEqual(sim.prev.x);
    sim.stateAt(1e6, out);
    expect(out.t).toBe(sim.state.t);
    sim.stateAt(-1e6, out);
    expect(out.t).toBe(sim.prev.t);
  });

  it('copies the masses, G and softening', () => {
    const { sim } = leapfrogSim();
    const out = createState(7, 0.5);
    sim.stateAt(0, out);
    expect(Array.from(out.m)).toEqual(Array.from(sim.state.m));
    expect(out.G).toBe(sim.state.G);
    expect(out.eps2).toBe(sim.state.eps2);
  });

  it('interpolates a coarse step far better than a straight line, and its velocity is the derivative of its position', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'rk4', params: { dt: T / 25 } });
    sim.step();
    const mid = 0.5 * (sim.prev.t + sim.state.t);
    const out = createState();
    sim.stateAt(mid, out);
    const exact = keplerExact(0.5, 1, mid);
    const hermiteError = pairError(out, exact);
    const linear = createState();
    for (let i = 0; i < 9; i++) linear.x[i] = 0.5 * (sim.prev.x[i] + sim.state.x[i]);
    const linearError = pairError(linear, exact);
    expect(hermiteError).toBeLessThan(linearError / 20);

    const delta = 1e-5 * T;
    const lo = createState();
    const hi = createState();
    sim.stateAt(mid - delta, lo);
    sim.stateAt(mid + delta, hi);
    for (let i = 0; i < 9; i++) {
      expect(out.v[i]).toBeCloseTo((hi.x[i] - lo.x[i]) / (2 * delta), 7);
    }
  });

  it('evaluates IAS15 dense output inside a step, to the accuracy of the step itself', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 12, epsTol: 1e-9 } });
    sim.step();
    const span = sim.state.t - sim.prev.t;
    expect(span).toBeGreaterThan(0.004 * T); // IAS15 shrinks the first guess, but it is still a sizeable step
    const out = createState();
    for (const f of [0.1, 0.37, 0.5, 0.9]) {
      const t = sim.prev.t + f * span;
      sim.stateAt(t, out);
      expect(pairError(out, keplerExact(0.5, 1, t))).toBeLessThan(2e-9);
    }
  });

  it('gives back the state when nothing has been stepped since a load or edit', () => {
    const { sim } = leapfrogSim();
    const out = createState();
    sim.stateAt(5, out);
    expect(out.x).toEqual(sim.state.x);
    expect(out.t).toBe(sim.state.t);
  });
});

describe('diagnostics through the simulation', () => {
  it('shows bounded energy error and conserved angular momentum for leapfrog over many orbits', () => {
    const { sim, T } = leapfrogSim();
    let worst = 0;
    for (let k = 1; k <= 20; k++) {
      sim.advanceTo(k * T, FOREVER);
      worst = Math.max(worst, energyError(sim.refreshDiagnostics(), sim.reference));
    }
    expect(worst).toBeLessThan(1e-4);
    expect(worst).toBeGreaterThan(0);
    expect(angularMomentumError(sim.refreshDiagnostics(), sim.reference)).toBeLessThan(1e-12);
  });

  it('counts force evaluations from the integrator', () => {
    const { sim } = leapfrogSim();
    sim.advanceTo(0.2, FOREVER);
    expect(sim.counters.forceEvals).toBe(sim.counters.stepCount + 1);
  });

  it('keeps an out-of-plane system out of the plane (z is dynamic, not decoration)', () => {
    const { s, T } = kepler();
    s.x[8] = 4; // body 2, the test particle, off the plane
    s.v[8] = 0.02;
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100 } });
    sim.advanceTo(2 * T, FOREVER);
    // The pair stays in the plane; a body given a z velocity keeps moving in z.
    expect(Math.abs(sim.state.x[2])).toBeLessThan(1e-12);
    expect(Math.abs(sim.state.x[8])).toBeGreaterThan(0.1);
  });
});

describe('state passed to load is not retained', () => {
  it('copies it, so later edits to the original do nothing', () => {
    const s: SystemState = kepler().s;
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: 0.01 } });
    const x0 = sim.state.x[0];
    s.x[0] = 1e9;
    sim.step();
    expect(Math.abs(sim.state.x[0] - x0)).toBeLessThan(0.1);
  });
});
