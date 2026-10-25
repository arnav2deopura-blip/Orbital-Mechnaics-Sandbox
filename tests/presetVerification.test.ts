import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/presets';
import { instantiate } from '../src/presets/schema';
import type { Preset } from '../src/presets/schema';
import { returnCheck } from '../src/presets/verify';
import { characteristicTime, energyError } from '../src/sim/diagnostics';
import { Simulation } from '../src/sim/simulation';
import { snapshot } from '../src/sim/state';
import { stateError } from './helpers';

// Plan §10, tests 7 and 8: a preset is `verified` only if its claim has been checked by running it.
// A claim of a period is checked here by finding where the orbit comes back to its start. The
// claims about behaviour (a Trojan librating, a moon surviving, the Kozai cycle) are checked in
// generators.test.ts, which this file points to rather than repeating.

const byId = (id: string): Preset => {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`no preset ${id}`);
  return preset;
};

/** The phase-space distance from the start after n periods, with IAS15 at 1e-10. */
function distanceAfter(preset: Preset, periods: number): number {
  const { state, period } = instantiate(preset);
  const T = period as number;
  const sim = new Simulation(state, { integrator: 'ias15', params: { dt: T / 200, epsTol: 1e-10, dtMin: T * 1e-7 } });
  const start = sim.baselineSnapshot();
  const drawn = snapshot(start);
  sim.advanceTo(periods * T, Infinity);
  sim.stateAt(periods * T, drawn);
  return stateError(drawn, start);
}

function expectReturns(preset: Preset, tolerance: number, bodies: 2 | 3 = 3): void {
  const { state, period } = instantiate(preset);
  const T = period as number;
  const check = returnCheck(state, T, { bodies, window: 0.01, samples: 200 });
  expect(check.distanceAtPeriod, `${preset.id} at its period`).toBeLessThan(tolerance);
  expect(Math.abs(check.returnTime - T) / T, `${preset.id}: the period is where it returns`).toBeLessThan(2e-3);
}

const SUVAKOV = PRESETS.filter((p) => p.id.startsWith('suvakov-'));

/** Presets whose claim is checked in this file, and the presets whose claim is checked in generators.test.ts. */
const CHECKED_HERE = ['figure-eight', 'kepler', 'lagrange', 'euler', 'pythagorean', 'kepler-orbit', 'circular-binary', 'near-radial', ...SUVAKOV.map((p) => p.id)];
const CHECKED_IN_GENERATORS = ['trojan', 'star-planet-moon', 'zlk', 'hyperbolic-flyby'];

describe('which presets claim to be verified', () => {
  it('is exactly the set whose claim is checked by a test', () => {
    const claimed = PRESETS.filter((p) => p.verified).map((p) => p.id).sort();
    expect(claimed).toEqual([...CHECKED_HERE, ...CHECKED_IN_GENERATORS].sort());
  });

  it('says what was checked, for every verified preset', () => {
    for (const preset of PRESETS.filter((p) => p.verified)) expect(preset.verifiedBy, preset.id).toBeTruthy();
  });

  it('leaves the sandbox unverified: it claims nothing', () => {
    expect(byId('sandbox').verified).toBe(false);
    expect(byId('sandbox-2').verified).toBe(false);
  });
});

describe('returnCheck', () => {
  it('finds the period of the figure-eight, and its sharpness', () => {
    const preset = byId('figure-eight');
    const { state, period } = instantiate(preset);
    const check = returnCheck(state, period as number, { window: 0.01, samples: 200 });
    expect(check.distanceAtPeriod).toBeLessThan(1e-6);
    expect(Math.abs(check.returnTime - (period as number))).toBeLessThan(1e-4);
    // Far from the period it does not return.
    const off = returnCheck(state, 1.1 * (period as number), { window: 0.01, samples: 20 });
    expect(off.distance).toBeGreaterThan(0.1);
  });

  it('reports the best time in the window, not just the claimed one', () => {
    const { state, period } = instantiate(byId('figure-eight'));
    const T = period as number;
    const check = returnCheck(state, 1.005 * T, { window: 0.01, samples: 400 }); // claimed period 0.5% too long
    expect(Math.abs(check.returnTime - T)).toBeLessThan(0.001 * T);
    expect(check.distanceAtPeriod).toBeGreaterThan(10 * check.distance);
  });
});

describe('periodic presets return to their start', () => {
  it('figure-eight', () => expectReturns(byId('figure-eight'), 1e-6));

  it('Kepler: the massive pair returns after one period (the test particle has its own)', () => {
    expectReturns(byId('kepler'), 1e-9, 2);
  });

  it('the 2-body presets: the pair returns after one period, with slot 2 absent', () => {
    expectReturns(byId('kepler-orbit'), 1e-9, 2);
    expectReturns(byId('circular-binary'), 1e-9, 2);
    expect(instantiate(byId('kepler-orbit')).state.n).toBe(2);
  });

  it('the near-radial plunge returns through a pericenter pass 100 times closer than where it starts', () => {
    const preset = byId('near-radial');
    const { state, period } = instantiate(preset);
    const d = (s: typeof state): number => Math.hypot(s.x[3] - s.x[0], s.x[4] - s.x[1], s.x[5] - s.x[2]);
    expect(d(state)).toBeCloseTo(1.99, 6); // a (1 + e): far point
    const check = returnCheck(state, period as number, { bodies: 2, window: 0.01, samples: 200 });
    expect(check.distanceAtPeriod).toBeLessThan(1e-6);
    expect(Math.abs(check.returnTime - (period as number)) / (period as number)).toBeLessThan(2e-3);
  });

  it('Lagrange and Euler: exact rigid rotations, which close after one period', () => {
    expectReturns(byId('lagrange'), 1e-9);
    expectReturns(byId('euler'), 1e-9);
  });

  it.each(SUVAKOV.map((p) => [p.id, p] as const))('%s: closes to 1e-8 after one period, at the claimed period', (_id, preset) => {
    expectReturns(preset, 1e-8);
  });
});

describe('Šuvakov orbits: stable ones stay, unstable ones leave', () => {
  const stable = SUVAKOV.filter((p) => p.tags.includes('stable'));
  const unstable = SUVAKOV.filter((p) => p.tags.includes('unstable'));

  it('has both kinds', () => {
    expect(stable.length).toBeGreaterThanOrEqual(4);
    expect(unstable.length).toBeGreaterThanOrEqual(2);
  });

  it.each(stable.map((p) => [p.id, p] as const))('%s stays within 1e-8 of the orbit for 10 periods', (_id, preset) => {
    expect(distanceAfter(preset, 10)).toBeLessThan(1e-8);
  });

  it('Butterfly I, which looks periodic, has drifted visibly after 40 periods', () => {
    const preset = byId('suvakov-butterfly-1');
    expect(distanceAfter(preset, 1)).toBeLessThan(1e-8);
    expect(distanceAfter(preset, 40)).toBeGreaterThan(1e-6);
  });

  it('5 digits are not enough (plan §8.4): rounded to the published precision, Butterfly I has left the orbit within 20 periods', () => {
    const preset = byId('suvakov-butterfly-1');
    const rounded: Preset = {
      ...preset,
      bodies: preset.bodies!.map((b) => ({ ...b, v: b.v.map((c) => Math.round(c * 1e5) / 1e5) as [number, number, number] })),
    };
    expect(distanceAfter(preset, 20)).toBeLessThan(1e-8); // the refined values are still on it
    expect(distanceAfter(rounded, 20)).toBeGreaterThan(1e-3); // an error of 5e-6 in the velocity has grown by orders of magnitude
  });
});

describe('the Pythagorean problem', () => {
  // Szebehely & Peters 1967: a long chaotic interplay, then ejection of one body leaving a binary.
  it('is resolved by IAS15, and by t = 80 the lightest body is ejected and the other two are bound', () => {
    const preset = byId('pythagorean');
    const { state } = instantiate(preset);
    const sim = new Simulation(state, {
      integrator: 'ias15',
      params: { dt: characteristicTime(state) / 100, epsTol: 1e-9, dtMin: 1e-9 },
    });
    let worst = 0;
    for (let t = 1; t <= 80; t++) {
      sim.advanceTo(t, Infinity);
      worst = Math.max(worst, energyError(sim.refreshDiagnostics(), sim.reference));
    }
    expect(sim.failure).toBeNull();
    expect(worst).toBeLessThan(1e-8);
    const s = sim.state;
    expect(Math.hypot(s.x[0], s.x[1], s.x[2])).toBeGreaterThan(30); // mass 3, far away
    const dx = [s.x[6] - s.x[3], s.x[7] - s.x[4], s.x[8] - s.x[5]];
    const dv = [s.v[6] - s.v[3], s.v[7] - s.v[4], s.v[8] - s.v[5]];
    const binary = 0.5 * (dv[0] ** 2 + dv[1] ** 2 + dv[2] ** 2) - 9 / Math.hypot(...dx);
    expect(binary).toBeLessThan(0);
  });
});
