import { describe, expect, it } from 'vitest';
import { SimLoop } from '../src/app/loop';
import type { Integrator } from '../src/sim/integrators/types';
import { Simulation } from '../src/sim/simulation';
import { kepler } from './helpers';

/** A leapfrog Kepler simulation and a loop sharing a clock the test controls. */
function setup(speed = 1, clock: () => number = () => 0): { sim: Simulation; loop: SimLoop; dt: number } {
  const { s, T } = kepler();
  const dt = T / 1000;
  const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt }, clock });
  const loop = new SimLoop(sim, { speed }, clock);
  return { sim, loop, dt };
}

describe('SimLoop', () => {
  it('does not move while paused, and draws the current state', () => {
    const { sim, loop } = setup();
    loop.settings.running = false;
    const drawn = loop.frame(0.5);
    expect(sim.state.t).toBe(0);
    expect(drawn.t).toBe(0);
    expect(drawn.x).toEqual(sim.state.x);
  });

  it('advances the time target by dt x speed each frame, and draws the state at the target', () => {
    const { sim, loop, dt } = setup(2);
    let drawn = loop.frame(0.1);
    expect(drawn.t).toBeCloseTo(0.2, 12);
    expect(sim.state.t - 0.2).toBeLessThan(dt); // the true state is at most a step ahead
    expect(sim.state.t).toBeGreaterThanOrEqual(0.2);
    for (let i = 0; i < 9; i++) drawn = loop.frame(0.1);
    expect(drawn.t).toBeCloseTo(2, 11);
  });

  it('draws a smooth state between steps, not a snap to the last one', () => {
    const { sim, loop, dt } = setup(1);
    // Frames far shorter than a step: the drawn state moves although the true one does not.
    loop.frame(0.5 * dt);
    const first = loop.rendered.x[0];
    const t1 = sim.state.t;
    loop.frame(0.25 * dt);
    expect(sim.state.t).toBe(t1);
    expect(loop.rendered.x[0]).not.toBe(first);
    expect(loop.rendered.t).toBeCloseTo(0.75 * dt, 15);
  });

  it('runs backward when the simulation does', () => {
    const { sim, loop } = setup(1);
    sim.setDirection(-1);
    const drawn = loop.frame(0.3);
    expect(drawn.t).toBeCloseTo(-0.3, 12);
  });

  it('resyncs its target when the simulation is reset, edited or reversed', () => {
    const { sim, loop } = setup(1);
    loop.frame(1);
    sim.reset();
    loop.settings.running = false;
    expect(loop.frame(0).t).toBe(0);

    loop.settings.running = true;
    loop.frame(1);
    sim.setDirection(-1);
    loop.settings.running = false;
    expect(loop.frame(0).t).toBe(sim.state.t); // not the stale forward target
  });

  it('drops the backlog when the budget runs out, instead of catching up later', () => {
    let now = 0;
    const clock = (): number => (now += 1);
    const { sim, loop } = setup(1000, clock);
    loop.settings.budgetMs = 0.5; // every reading of the clock is already past the deadline
    loop.frame(0.1); // asks for 100 time units, about 18,000 steps
    const reached = sim.state.t;
    expect(reached).toBeLessThan(1);
    expect(loop.rendered.t).toBeCloseTo(reached, 12); // draws where it got to, not where it was asked to be

    // Without the backlog, a modest request next frame is modest.
    loop.settings.speed = 1;
    loop.settings.budgetMs = 1e9;
    loop.frame(0.1);
    expect(loop.rendered.t).toBeCloseTo(reached + 0.1, 9);
    expect(sim.state.t).toBeLessThan(reached + 0.2);
  });

  it('reports the fraction of the requested speed it achieved', () => {
    let now = 0;
    const clock = (): number => (now += 1);
    const { loop } = setup(1000, clock);
    loop.settings.budgetMs = 0.5;
    for (let i = 0; i < 100; i++) loop.frame(0.1);
    expect(loop.stats.achieved).toBeLessThan(0.1);
    expect(loop.stats.achieved).toBeGreaterThan(0);

    loop.settings.speed = 1;
    loop.settings.budgetMs = 1e9;
    for (let i = 0; i < 100; i++) loop.frame(0.1);
    expect(loop.stats.achieved).toBeGreaterThan(0.99);
  });

  it('pauses itself when the integration fails, and stops stepping', () => {
    const { sim, loop } = setup(1);
    const bad: Integrator = {
      id: 'euler',
      order: 1,
      symplectic: false,
      adaptive: false,
      forceEvalsPerStep: 1,
      init() {},
      step(s) {
        s.x[0] = NaN;
        s.t += 0.01;
        return 0.01;
      },
      reset() {},
      setDirection() {},
    };
    sim.integrator = bad;
    const drawn = loop.frame(0.1);
    expect(loop.settings.running).toBe(false);
    expect(sim.failure).not.toBeNull();
    expect(Number.isFinite(drawn.x[0])).toBe(true);
    const steps = sim.counters.stepCount;
    loop.frame(0.1);
    expect(sim.counters.stepCount).toBe(steps);
  });

  it('stepOnce pauses, takes one step, and draws the new state', () => {
    const { sim, loop, dt } = setup();
    loop.stepOnce();
    expect(loop.settings.running).toBe(false);
    expect(sim.counters.stepCount).toBe(1);
    expect(loop.frame(0.5).t).toBeCloseTo(dt, 15);
  });

  it('averages steps, force evaluations and sim time per window', () => {
    const { loop } = setup(1);
    for (let i = 0; i < 6; i++) loop.frame(0.05); // 0.3 s, one window
    const { stepsPerSec, forceEvalsPerSec } = loop.stats;
    expect(stepsPerSec).toBeGreaterThan(0);
    // Leapfrog pays one force evaluation per step.
    expect(forceEvalsPerSec / stepsPerSec).toBeCloseTo(1, 0);
  });
});
