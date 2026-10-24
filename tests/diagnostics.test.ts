import { describe, expect, it } from 'vitest';
import {
  angularMomentumError,
  characteristicTime,
  createDiagnostics,
  createReference,
  energyError,
  measure,
  momentumError,
  systemSize,
} from '../src/sim/diagnostics';
import { createState } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { angularMomentum, energy, kepler, lScale, makeRng, momentum, pythagorean } from './helpers';

function randomState(rng: () => number): SystemState {
  const s = createState(0.5 + 3 * rng());
  for (let i = 0; i < 3; i++) s.m[i] = 0.1 + 5 * rng();
  for (let i = 0; i < 9; i++) {
    s.x[i] = 4 * rng() - 2;
    s.v[i] = 2 * rng() - 1;
  }
  return s;
}

function figureEight(): SystemState {
  const s = createState();
  s.m.set([1, 1, 1]);
  const x1 = [0.97000436, -0.24308753, 0];
  const v3 = [-0.93240737, -0.86473146, 0];
  s.x.set([...x1, ...x1.map((c) => -c), 0, 0, 0]);
  s.v.set([...v3.map((c) => -c / 2), ...v3.map((c) => -c / 2), ...v3]);
  return s;
}

describe('measure', () => {
  it('agrees with the independent implementations in the test helpers', () => {
    const rng = makeRng(3);
    const d = createDiagnostics();
    for (let n = 0; n < 50; n++) {
      const s = randomState(rng);
      measure(s, d);
      expect(d.energy).toBeCloseTo(energy(s), 12);
      expect(d.kinetic + d.potential).toBe(d.energy);
      angularMomentum(s).forEach((c, i) => expect(d.L[i]).toBeCloseTo(c, 12));
      momentum(s).forEach((c, i) => expect(d.P[i]).toBeCloseTo(c, 12));
    }
  });

  it('finds the center of mass, and the plain mean when every mass is zero', () => {
    const s = createState();
    s.m.set([1, 1, 2]);
    s.x.set([0, 0, 0, 4, 0, 0, 0, 4, 8]);
    const d = createDiagnostics();
    measure(s, d);
    expect(Array.from(d.com)).toEqual([1, 2, 4]);
    s.m.fill(0);
    measure(s, d);
    expect(d.com[0]).toBeCloseTo(4 / 3, 15);
    expect(d.com[2]).toBeCloseTo(8 / 3, 15);
  });

  it('reports the smallest pair distance in 3D', () => {
    const s = createState();
    s.m.set([1, 1, 1]);
    s.x.set([0, 0, 0, 3, 0, 4, 3, 0, 4.5]);
    const d = createDiagnostics();
    measure(s, d);
    expect(d.minSeparation).toBe(0.5);
  });

  it('uses the softened potential when eps2 > 0, as the integrators do', () => {
    const s = kepler().s;
    s.eps2 = 0.01;
    const d = createDiagnostics();
    measure(s, d);
    expect(d.energy).toBeCloseTo(energy(s), 14);
  });

  it('keeps out of the way of its inputs: measuring twice gives the same numbers', () => {
    const s = randomState(makeRng(5));
    const a = createDiagnostics();
    const b = createDiagnostics();
    measure(s, a);
    measure(s, b);
    measure(s, a);
    expect(a).toEqual(b);
  });
});

describe('createReference', () => {
  it('takes E0, L0 and P0 from the state, and the period from the closest pair', () => {
    const { s } = kepler(0, 0); // circular pair, r = 1, masses 1 and 0.3
    const ref = createReference(s);
    expect(ref.energy).toBeCloseTo(energy(s), 14);
    expect(ref.L[2]).toBeCloseTo(angularMomentum(s)[2], 14);
    expect(ref.period).toBeCloseTo(2 * Math.PI / Math.sqrt(1.3), 14);
  });

  it('prefers a declared period', () => {
    expect(createReference(kepler().s, 6.25).period).toBe(6.25);
  });

  it('scales angular momentum by sum m |x||v|, which stays positive when L = 0 (figure-eight)', () => {
    const s = figureEight();
    const ref = createReference(s);
    expect(Math.hypot(...angularMomentum(s))).toBeLessThan(1e-7);
    expect(ref.Lscale).toBeCloseTo(lScale(s), 14);
    expect(ref.Lscale).toBeGreaterThan(1);
  });

  it('falls back to a velocity from the energy when the bodies start at rest (Pythagorean)', () => {
    const s = pythagorean();
    expect(lScale(s)).toBe(0);
    const ref = createReference(s);
    expect(ref.Lscale).toBeGreaterThan(0);
    expect(Number.isFinite(ref.Lscale)).toBe(true);
  });

  it('measures energy error against K + |U| when E0 is tiny', () => {
    // Two unit masses a distance 2 apart at the parabolic speed: E0 = 0, K = 1/2, |U| = 1/2.
    const s = createState();
    s.m.set([1, 1, 0]);
    const v = Math.SQRT1_2;
    s.x.set([-1, 0, 0, 1, 0, 0, 100, 0, 0]);
    s.v.set([0, -v, 0, 0, v, 0, 0, 0, 0]);
    const ref = createReference(s);
    expect(Math.abs(ref.energy)).toBeLessThan(1e-15);
    expect(ref.energyScale).toBeCloseTo(1, 14);
    const d = createDiagnostics();
    d.energy = ref.energy + 1e-6;
    expect(energyError(d, ref)).toBeCloseTo(1e-6, 12);
  });

  it('measures energy error relative to |E0| otherwise', () => {
    const { s } = kepler();
    const ref = createReference(s);
    const d = createDiagnostics();
    measure(s, d);
    expect(energyError(d, ref)).toBe(0);
    d.energy = ref.energy * (1 + 1e-4);
    expect(energyError(d, ref)).toBeCloseTo(1e-4, 12);
  });

  it('measures angular momentum and momentum errors as vector norms', () => {
    const { s } = kepler();
    const ref = createReference(s);
    const d = createDiagnostics();
    measure(s, d);
    expect(angularMomentumError(d, ref)).toBe(0);
    d.L[0] += 3 * 1e-3 * ref.Lscale;
    d.L[2] += 4 * 1e-3 * ref.Lscale;
    expect(angularMomentumError(d, ref)).toBeCloseTo(5e-3, 12);
    d.P[1] += 2e-9;
    expect(momentumError(d, ref)).toBeCloseTo(2e-9, 18);
  });
});

describe('characteristicTime', () => {
  it('ignores pairs of test particles, and is 1 with nothing to go on', () => {
    const s = createState();
    s.m.set([0, 0, 0]);
    s.x.set([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(characteristicTime(s)).toBe(1);
    s.m[0] = 1;
    expect(characteristicTime(s)).toBeCloseTo(2 * Math.PI, 14); // 0-1 pair at r = 1, mu = 1
  });

  it('takes G into account', () => {
    const s = kepler(0, 0).s;
    const T = characteristicTime(s);
    s.G = 4;
    expect(characteristicTime(s)).toBeCloseTo(T / 2, 14);
  });
});

describe('systemSize', () => {
  it('is the diameter of the sphere about the COM that holds the bodies', () => {
    const s = createState();
    s.m.set([1, 1, 1]);
    s.x.set([-3, 0, 0, 3, 0, 0, 0, 0, 0]);
    expect(systemSize(s)).toBe(6);
  });

  it('sees the z extent too', () => {
    const s = createState();
    s.m.set([1, 1, 1]);
    s.x.set([0, 0, -2, 0, 0, 2, 0, 0, 0]);
    expect(systemSize(s)).toBe(4);
  });

  it('is 1 when the bodies coincide', () => {
    const s = createState();
    s.m.set([1, 1, 1]);
    expect(systemSize(s)).toBe(1);
  });
});
