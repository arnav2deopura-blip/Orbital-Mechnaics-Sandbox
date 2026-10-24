import { describe, expect, it } from 'vitest';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import { presetState } from '../src/presets/schema';
import type { Preset } from '../src/presets/schema';
import { Simulation } from '../src/sim/simulation';
import { snapshot } from '../src/sim/state';
import { momentum, stateError } from './helpers';

describe('presetState', () => {
  it('builds the SystemState: masses, positions, velocities, G, t = 0', () => {
    const s = presetState(FIGURE_EIGHT);
    expect(Array.from(s.m)).toEqual([1, 1, 1]);
    expect(s.x[0]).toBe(0.97000436);
    expect(s.v[7]).toBe(-0.86473146);
    expect(s.G).toBe(1);
    expect(s.eps2).toBe(0);
    expect(s.t).toBe(0);
  });

  it('carries z, which is what makes a system 3D', () => {
    const preset: Preset = {
      ...FIGURE_EIGHT,
      bodies: FIGURE_EIGHT.bodies.map((b, i) => ({ ...b, x: [b.x[0], b.x[1], i], v: [b.v[0], b.v[1], 0.1 * i] })),
    };
    const s = presetState(preset);
    expect([s.x[2], s.x[5], s.x[8]]).toEqual([0, 1, 2]);
    expect([s.v[2], s.v[5], s.v[8]]).toEqual([0, 0.1, 0.2]);
  });

  it('rejects anything but three bodies', () => {
    expect(() => presetState({ ...FIGURE_EIGHT, bodies: FIGURE_EIGHT.bodies.slice(0, 2) })).toThrow(RangeError);
  });
});

describe('figure-eight preset', () => {
  it('is already in the COM frame, with zero momentum', () => {
    const s = presetState(FIGURE_EIGHT);
    for (let c = 0; c < 3; c++) expect(Math.abs(s.x[c] + s.x[3 + c] + s.x[6 + c])).toBeLessThan(1e-15);
    expect(Math.hypot(...momentum(s))).toBeLessThan(1e-15);
  });

  // Plan §10 test 7: with IAS15 at 1e-12, the phase-space distance to the initial conditions
  // after one period is below 1e-6, and the period is the tabulated one. This is what sets `verified`.
  it('returns to its initial conditions after the tabulated period', () => {
    const T = FIGURE_EIGHT.period!;
    const sim = new Simulation(presetState(FIGURE_EIGHT), { integrator: 'ias15', params: { dt: T / 100, epsTol: 1e-12 } });
    const start = snapshot(sim.state);
    sim.advanceTo(T, Infinity);
    const atT = snapshot(sim.state);
    sim.stateAt(T, atT);
    expect(stateError(atT, start)).toBeLessThan(1e-6);

    // And the period is sharp: a little earlier or later is much farther from the start.
    for (const t of [T - 0.01, T + 0.01]) {
      const probe = new Simulation(presetState(FIGURE_EIGHT), { integrator: 'ias15', params: { dt: T / 100, epsTol: 1e-12 } });
      probe.advanceTo(t, Infinity);
      probe.stateAt(t, atT);
      expect(stateError(atT, start)).toBeGreaterThan(100 * 1e-6);
    }
    expect(FIGURE_EIGHT.verified).toBe(true);
  });

  it('recommends settings that run: a period every 8 s, 4000 steps per period', () => {
    const { recommended, period } = FIGURE_EIGHT;
    expect(recommended.integrator).toBe('leapfrog');
    expect(period! / recommended.dt!).toBeCloseTo(4000, 9);
    expect(recommended.speed * 8).toBeCloseTo(period!, 12);
  });
});
