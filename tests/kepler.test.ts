import { describe, expect, it } from 'vitest';
import { keplerDrift, stumpffC, stumpffS } from '../src/sim/kepler';
import {
  ellipseAt,
  ellipseState,
  hyperbolaAt,
  hyperbolaState,
  makeRng,
  parabolaAt,
  type Orbit,
} from './helpers';

const len = (a: number[]): number => Math.hypot(...a);
const sub = (a: number[], b: number[]): number[] => a.map((c, i) => c - b[i]);
const cross = (a: number[], b: number[]): number[] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Runs keplerDrift on a copy of the orbit and returns the result. */
function drift(mu: number, dt: number, start: Orbit): Orbit {
  const pos = Float64Array.from(start.r);
  const vel = Float64Array.from(start.v);
  expect(keplerDrift(mu, dt, pos, vel, 0)).toBe(true);
  return { r: Array.from(pos), v: Array.from(vel) };
}

/** Worse of the position and velocity errors, each relative to the larger of the start and exact magnitudes. */
function orbitError(got: Orbit, exact: Orbit, start: Orbit): number {
  const rs = Math.max(len(exact.r), len(start.r));
  const vs = Math.max(len(exact.v), len(start.v));
  return Math.max(len(sub(got.r, exact.r)) / rs, len(sub(got.v, exact.v)) / vs);
}

describe('Stumpff functions', () => {
  // Reference: the defining series with many terms, accurate for modest |z|.
  const series = (z: number, first: number): number => {
    let term = 1 / (first === 2 ? 2 : 6);
    let sum = term;
    for (let k = 0; k < 60; k++) {
      term *= -z / ((2 * k + first + 1) * (2 * k + first + 2));
      sum += term;
    }
    return sum;
  };

  it('has C(0) = 1/2 and S(0) = 1/6', () => {
    expect(stumpffC(0)).toBe(0.5);
    expect(stumpffS(0)).toBe(1 / 6);
  });

  it('matches the series to roundoff on both sides of the series/closed-form switch', () => {
    const zs = [-9, -4, -2.5, -1.5, -1.0000001, -0.999999, -0.5, -1e-3, -1e-8, 1e-12, 1e-8, 1e-3, 0.5, 0.999999, 1.0000001, 1.5, 2.5, 4, 9];
    for (const z of zs) {
      expect(Math.abs(stumpffC(z) / series(z, 2) - 1)).toBeLessThan(1e-15);
      expect(Math.abs(stumpffS(z) / series(z, 3) - 1)).toBeLessThan(1e-15);
    }
  });

});

describe('keplerDrift against exact solutions', () => {
  const mu = 1.3;
  const a = 1.7;
  const period = 2 * Math.PI * Math.sqrt(a ** 3 / mu);

  const ellipses: [number, number, number][] = [];
  for (const e of [0, 0.3, 0.9, 0.99]) for (const f0 of [0, 1, 3]) for (const frac of [0.01, 0.13, 0.5, 1, 3.7, -0.13, -2.4, 250.3, -41.7]) ellipses.push([e, f0, frac]);

  it.each(ellipses)('ellipse e = %s, f0 = %s, dt = %s periods', (e, f0, frac) => {
    const start = ellipseState(mu, a, e, f0);
    const exact = ellipseAt(mu, a, e, f0, frac * period);
    // The tolerance is the problem's conditioning, not solver slack. A double-precision
    // (r, v) fixes the energy only to about eps * 2 / (r0 alpha), so the period is off by
    // dT/T ~ 3 eps / (1 - e); after k periods that shifts the end point by v dT, and the
    // error relative to the pericenter distance is ~ 2 pi k * 3 eps sqrt(1 + e) / (1 - e)^2.5.
    // Measured error / (eps k sqrt(1+e) / (1-e)^2.5) is at most 25 over e = 0 ... 0.99.
    const tol = 50 * Number.EPSILON * Math.max(1, Math.abs(frac)) * Math.sqrt(1 + e) / (1 - e) ** 2.5;
    expect(orbitError(drift(mu, frac * period, start), exact, start)).toBeLessThan(tol);
  });

  const hyperbolas: [number, number, number][] = [];
  for (const e of [1.2, 3, 10]) for (const f0 of [-1, 0, 0.8]) for (const t of [0.05, 1, 10, -3, 40]) hyperbolas.push([e, f0, t]);

  it.each(hyperbolas)('hyperbola e = %s, f0 = %s, dt = %s', (e, f0, t) => {
    const start = hyperbolaState(mu, a, e, f0);
    const exact = hyperbolaAt(mu, a, e, f0, t);
    expect(orbitError(drift(mu, t, start), exact, start)).toBeLessThan(5e-14);
  });

  it.each([0.01, -0.01, 0.5, -3, 50])('parabola from pericenter, dt = %s', (t) => {
    const q = 0.7;
    const start: Orbit = { r: [q, 0, 0], v: [0, Math.sqrt((2 * mu) / q), 0] };
    expect(orbitError(drift(mu, t, start), parabolaAt(mu, q, t), start)).toBeLessThan(1e-13);
  });

  it.each([1 - 1e-10, 1 + 1e-10])('orbits just either side of parabolic (speed x %s) stay on the parabola', (scale) => {
    const q = 0.7;
    const start: Orbit = { r: [q, 0, 0], v: [0, scale * Math.sqrt((2 * mu) / q), 0] };
    for (const t of [0.5, -3, 50]) {
      // The offset is real physics, not solver error: the energy differs from zero by ~2e-10,
      // which Barker's parabola does not include, and the gap grows with t (1.7e-9 at t = 50).
      expect(orbitError(drift(mu, t, start), parabolaAt(mu, q, t), start)).toBeLessThan(1e-8);
    }
  });

  it('turns a circular orbit by exactly a quarter at a quarter period, and returns after a whole one', () => {
    const r = 1.5;
    const start: Orbit = { r: [r, 0, 0], v: [0, Math.sqrt(mu / r), 0] };
    const T = 2 * Math.PI * Math.sqrt(r ** 3 / mu);
    const quarter = drift(mu, T / 4, start);
    expect(len(sub(quarter.r, [0, r, 0]))).toBeLessThan(2e-15);
    expect(len(sub(quarter.v, [-Math.sqrt(mu / r), 0, 0]))).toBeLessThan(2e-15);
    const whole = drift(mu, T, start);
    expect(len(sub(whole.r, start.r))).toBeLessThan(2e-15);
    expect(len(sub(whole.v, start.v))).toBeLessThan(2e-15);
  });
});

describe('keplerDrift on random 3D orbits', () => {
  // Bound, near-parabolic and unbound; random orientation; steps up to several periods.
  const rng = makeRng(99);
  const cases: { mu: number; dt: number; start: Orbit }[] = [];
  for (let n = 0; n < 300; n++) {
    const mu = 0.2 + 5 * rng();
    const r0 = 0.2 + 5 * rng();
    const dir = (): number[] => {
      for (;;) {
        const d = [2 * rng() - 1, 2 * rng() - 1, 2 * rng() - 1];
        const l = len(d);
        if (l > 0.1 && l < 1) return d.map((c) => c / l);
      }
    };
    const ratio = n % 10 === 0 ? Math.SQRT2 * (1 + (rng() - 0.5) * 1e-9) : 0.05 + 2.4 * rng(); // sqrt 2 is parabolic
    const speed = ratio * Math.sqrt(mu / r0);
    cases.push({
      mu,
      dt: (rng() - 0.5) * 40,
      start: { r: dir().map((c) => c * r0), v: dir().map((c) => c * speed) },
    });
  }

  it('conserves angular momentum (the identity f gdot - fdot g = 1), energy and the Runge-Lenz vector', () => {
    const worst = { L: 0, E: 0, A: 0 };
    for (const { mu, dt, start } of cases) {
      const end = drift(mu, dt, start);
      const invariants = (o: Orbit) => {
        const L = cross(o.r, o.v);
        const r = len(o.r);
        const A = sub(cross(o.v, L), o.r.map((c) => (mu * c) / r));
        return { L, A, E: 0.5 * dot(o.v, o.v) - mu / r };
      };
      const before = invariants(start);
      const after = invariants(end);
      const r0 = len(start.r);
      const v0 = len(start.v);
      worst.L = Math.max(worst.L, len(sub(after.L, before.L)) / (r0 * v0));
      worst.E = Math.max(worst.E, Math.abs(after.E - before.E) / (mu / r0 + 0.5 * v0 * v0));
      worst.A = Math.max(worst.A, len(sub(after.A, before.A)) / (mu + r0 * v0 * v0));
    }
    expect(worst.L).toBeLessThan(3e-13);
    expect(worst.E).toBeLessThan(3e-14);
    expect(worst.A).toBeLessThan(2e-13);
  });

  it('returns to the start when run forward and then backward', () => {
    let worst = 0;
    for (const { mu, dt, start } of cases) {
      const back = drift(mu, -dt, drift(mu, dt, start));
      worst = Math.max(worst, orbitError(back, start, start));
    }
    expect(worst).toBeLessThan(3e-11);
  });
});

describe('keplerDrift edge cases', () => {
  const start: Orbit = ellipseState(1, 1, 0.5, 1);

  it('leaves the state untouched for dt = 0', () => {
    const pos = Float64Array.from(start.r);
    const vel = Float64Array.from(start.v);
    expect(keplerDrift(1, 0, pos, vel, 0)).toBe(true);
    expect(Array.from(pos)).toEqual(start.r);
    expect(Array.from(vel)).toEqual(start.v);
  });

  it('reduces to r + v dt for a tiny step', () => {
    const dt = 1e-9;
    const end = drift(1, dt, start);
    for (let c = 0; c < 3; c++) expect(end.r[c]).toBeCloseTo(start.r[c] + start.v[c] * dt, 15);
  });

  it('works on the 3 entries at an offset and touches nothing else', () => {
    const pos = Float64Array.from([7, 8, 9, ...start.r, 4, 5, 6]);
    const vel = Float64Array.from([1, 2, 3, ...start.v, -1, -2, -3]);
    expect(keplerDrift(1, 0.37, pos, vel, 3)).toBe(true);
    const alone = drift(1, 0.37, start);
    expect(Array.from(pos.slice(3, 6))).toEqual(alone.r);
    expect(Array.from(vel.slice(3, 6))).toEqual(alone.v);
    expect(Array.from(pos.slice(0, 3))).toEqual([7, 8, 9]);
    expect(Array.from(pos.slice(6))).toEqual([4, 5, 6]);
    expect(Array.from(vel.slice(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(vel.slice(6))).toEqual([-1, -2, -3]);
  });

  it('reports failure instead of looping forever on non-finite input', () => {
    const pos = Float64Array.of(NaN, 0, 0);
    const vel = Float64Array.of(0, 1, 0);
    expect(keplerDrift(1, 1, pos, vel, 0)).toBe(false);
  });
});
