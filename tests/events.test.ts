import { describe, expect, it } from 'vitest';
import { SimLoop } from '../src/app/loop';
import { arrowLength } from '../src/render/vectors';
import { hasEscaped, minSeparationSquared } from '../src/sim/events';
import { Simulation } from '../src/sim/simulation';
import { createState } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { kepler } from './helpers';

describe('minSeparationSquared', () => {
  it('is the smallest pair distance squared, in 3D', () => {
    const x = Float64Array.of(0, 0, 0, 3, 0, 4, 3, 0, 4.5);
    expect(minSeparationSquared(x)).toBe(0.25);
  });
});

function pair(separation: number, speed: number, thirdAt: number): SystemState {
  // Bodies 0 and 1 of unit mass at rest at the origin, and body 2 (massless) at `thirdAt` on x with speed on x.
  const s = createState();
  s.m.set([1, 1, 0]);
  s.x.set([-0.5 * separation, 0, 0, 0.5 * separation, 0, 0, thirdAt, 0, 0]);
  s.v.set([0, 0, 0, 0, 0, 0, speed, 0, 0]);
  return s;
}

describe('hasEscaped', () => {
  // The pair has mass 2 at the origin: escape speed from r is sqrt(2 G M / r) = sqrt(4 / r).
  it('needs both distance and an unbound orbit', () => {
    const r = 100;
    const escape = Math.sqrt(4 / r);
    expect(hasEscaped(pair(1, 1.1 * escape, r), 2, 20)).toBe(true);
    expect(hasEscaped(pair(1, 0.9 * escape, r), 2, 20)).toBe(false); // far but bound
    expect(hasEscaped(pair(1, 10 * escape, 5), 2, 20)).toBe(false); // fast but near
  });

  it('measures the radius from the COM of the other two, and the speed relative to it', () => {
    const s = pair(1, 0, 100);
    for (let i = 0; i < 3; i++) s.v[3 * i + 1] += 50; // everyone drifts together: nothing changes
    s.x[1] += 1e6;
    s.x[4] += 1e6;
    s.x[7] += 1e6;
    expect(hasEscaped(s, 2, 20)).toBe(false);
  });

  it('only flags the one that left: the two behind, now far from each other, are not escapers', () => {
    const s = pair(1, 10, 100); // body 2 fast and far, bodies 0 and 1 close together
    expect([0, 1, 2].map((k) => hasEscaped(s, k, 20))).toEqual([false, false, true]);
    // Spread all three out far beyond the radius: no compact remainder, so nobody is singled out.
    s.x[0] = -100;
    s.x[3] = 100;
    expect([0, 1, 2].map((k) => hasEscaped(s, k, 20))).toEqual([false, false, false]);
  });

  it('is false when the other two have no mass', () => {
    const s = pair(1, 1e6, 1e6);
    s.m.fill(0);
    expect(hasEscaped(s, 2, 20)).toBe(false);
  });
});

describe('close encounters in Simulation', () => {
  const eccentric = (): Simulation => {
    const { s, T } = kepler(0.9, 0); // starts at pericenter, separation 0.1 a
    return new Simulation(s, { integrator: 'ias15', params: { dt: T / 100 } });
  };

  it('does nothing while the radius is 0', () => {
    const sim = eccentric();
    sim.advanceTo(2, Infinity);
    expect(sim.encounter).toBeNull();
  });

  it('notes an encounter once on entering it, with when and how close, and keeps running', () => {
    const sim = eccentric();
    sim.encounterRadius = 0.3;
    sim.stopOnEncounter = false;
    const result = sim.advanceTo(3, Infinity);
    expect(result.status).toBe('reached');
    expect(sim.encounter).toMatch(/^close encounter at t=\d/);
    expect(sim.encounter).toMatch(/separation 0\.[01]\d*/);
  });

  it('stops at the encounter when asked, and carries on past it from there', () => {
    const { s, T } = kepler(0.9, 3); // starts near apocenter: the encounter comes later
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100 } });
    sim.encounterRadius = 0.2;
    sim.stopOnEncounter = true;
    const result = sim.advanceTo(T, Infinity);
    expect(result.status).toBe('event');
    const stoppedAt = sim.state.t;
    expect(stoppedAt).toBeLessThan(T);
    expect(Math.sqrt(minSeparationSquared(sim.state.x))).toBeLessThan(0.2);

    // Still inside the encounter: continuing does not stop again at once, but runs through it.
    const next = sim.advanceTo(stoppedAt + 0.01 * T, Infinity);
    expect(next.status).toBe('reached');
    // Out and in again: a second event on the next pass.
    const later = sim.advanceTo(stoppedAt + 1.2 * T, Infinity);
    expect(later.status).toBe('event');
    expect(sim.state.t).toBeGreaterThan(stoppedAt + 0.5 * T);
  });

  it('clears on load and reset', () => {
    const sim = eccentric();
    sim.encounterRadius = 0.3;
    sim.advanceTo(1, Infinity);
    expect(sim.encounter).not.toBeNull();
    sim.reset();
    expect(sim.encounter).toBeNull();
    sim.advanceTo(1, Infinity);
    expect(sim.encounter).not.toBeNull(); // the run meets it again
  });

  it('does not stop a single step, and does not leave a stop pending for the next run', () => {
    const sim = eccentric();
    sim.encounterRadius = 0.3;
    sim.stopOnEncounter = true;
    expect(sim.step()).toBe(true); // enters the encounter
    expect(sim.encounter).not.toBeNull();
    const result = sim.advanceTo(0.5, Infinity);
    expect(result.steps).toBeGreaterThan(1);
  });

  it('pauses a SimLoop, which then draws where it stopped', () => {
    const { s, T } = kepler(0.9, 3);
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: T / 100 } });
    sim.encounterRadius = 0.2;
    sim.stopOnEncounter = true;
    const loop = new SimLoop(sim, { speed: T, budgetMs: 1e9 }); // no wall-clock limit: the test must not depend on machine load
    const drawn = loop.frame(1);
    expect(loop.settings.running).toBe(false);
    expect(drawn.t).toBeCloseTo(sim.state.t, 12);
  });
});

describe('arrowLength', () => {
  it('is logarithmic: 0 for nothing, the typical length for a typical vector, less than linear above it', () => {
    expect(arrowLength(0, 1, 10)).toBe(0);
    const typical = arrowLength(1, 1, 10);
    expect(typical).toBeCloseTo(0.12 * 10, 12);
    const tenTimes = arrowLength(10, 1, 10);
    expect(tenTimes).toBeGreaterThan(typical);
    expect(tenTimes).toBeLessThan(10 * typical / 2); // far from ten times as long
  });

  it('is nearly linear for small vectors, so direction and relative size still read', () => {
    expect(arrowLength(1e-3, 1, 1) / arrowLength(2e-3, 1, 1)).toBeCloseTo(0.5, 3);
  });

  it('scales with the view distance', () => {
    expect(arrowLength(2, 1, 20)).toBeCloseTo(2 * arrowLength(2, 1, 10), 12);
  });
});
