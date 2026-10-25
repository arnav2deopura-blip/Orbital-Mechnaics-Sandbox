/// <reference types="node" />
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { IntegratorId } from '../src/sim/integrators/types';
import { Sampler } from '../src/sim/sampler';
import { Simulation } from '../src/sim/simulation';
import { hierarchical, kepler } from './helpers';

// Plan §10, test 10: a long run does not make the heap grow. Plan §3 asks that the step loop not
// allocate; what was measured is that it does not *retain* anything, and allocates only a little
// short-lived garbage (a double returned from a function that is not inlined is boxed: about 16
// bytes a step for Euler, more for Wisdom-Holman, whose Kepler solver passes several). A scavenge
// of a young generation with nothing alive in it takes a fraction of a millisecond, so this is no
// hitch. The ceiling below is for catching a regression such as an array built every step.

// A function that forces a full collection, which Node only gives out when asked for at start-up.
v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc') as () => void;
const used = (): number => v8.getHeapStatistics().used_heap_size;

/** Heap bytes still in use after `work`, relative to before, with a full collection on each side. */
function retained(work: () => void): number {
  collect();
  const before = used();
  work();
  collect();
  return used() - before;
}

/** Heap bytes allocated while `work` runs, for a run short enough that no scavenge happens in it. */
function allocated(work: () => void): number {
  collect();
  const before = used();
  work();
  return used() - before;
}

const STEPS = 100_000;
const cases: [IntegratorId, boolean][] = [
  ['euler', false],
  ['leapfrog', false],
  ['rk4', false],
  ['wh', true],
  ['ias15', false],
];

function simulation(id: IntegratorId, hierarchicalSystem: boolean): Simulation {
  const { s, T } = hierarchicalSystem ? { s: hierarchical().s, T: hierarchical().T1 } : kepler(0.3);
  const sim = new Simulation(s, { integrator: id, params: { dt: T / (id === 'ias15' ? 100 : 400), centralBody: 0 } });
  for (let i = 0; i < 20_000; i++) sim.step(); // warm up: compilation is not what is being measured
  return sim;
}

describe('a long run does not make the heap grow', () => {
  it('(control) holding on to an array per step is seen', () => {
    const kept: Float64Array[] = [];
    expect(retained(() => {
      for (let i = 0; i < STEPS; i++) kept.push(new Float64Array(9));
    })).toBeGreaterThan(5_000_000);
    expect(kept.length).toBe(STEPS);
  });

  it.each(cases)('%s: %i steps retain nothing', (id, hierarchicalSystem) => {
    const sim = simulation(id, hierarchicalSystem);
    const grew = retained(() => {
      for (let i = 0; i < STEPS; i++) sim.step();
    });
    expect(sim.failure).toBeNull();
    expect(grew).toBeLessThan(256 * 1024);
  });

  it.each(cases)('%s: and allocates no more than a little short-lived garbage per step', (id, hierarchicalSystem) => {
    const sim = simulation(id, hierarchicalSystem);
    const steps = 20_000;
    const bytes = allocated(() => {
      for (let i = 0; i < steps; i++) sim.step();
    });
    expect(bytes / steps).toBeLessThan(256); // an array or object built every step would be over this
  });

  it('advanceTo, which copies the state before each step, retains nothing', () => {
    const { s, T } = kepler(0.3);
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 400 } });
    sim.advanceTo(100, Infinity);
    const grew = retained(() => {
      sim.advanceTo(sim.state.t + STEPS * (T / 400), Infinity);
    });
    expect(grew).toBeLessThan(256 * 1024);
  });

  it('the chart sampler retains nothing, and takes a sample in under a kilobyte of garbage', () => {
    const { s, T } = kepler(0.3);
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 400 } });
    const sampler = new Sampler(2000); // small, so it fills and thins many times
    sampler.clear(T, 400);
    sim.onStep = () => sampler.record(sim);
    for (let i = 0; i < 20_000; i++) sim.step();
    const grew = retained(() => {
      for (let i = 0; i < STEPS; i++) sim.step();
    });
    expect(grew).toBeLessThan(256 * 1024);
    const samples = 5_000;
    const bytes = allocated(() => {
      for (let i = 0; i < samples; i++) sim.step();
    });
    expect(bytes / samples).toBeLessThan(1024);
    expect(sampler.length).toBeGreaterThan(100);
  });
});
