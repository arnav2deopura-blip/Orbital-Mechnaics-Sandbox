import { describe, expect, it } from 'vitest';
import { inertialToJacobi, jacobiToInertial, shiftToComFrame } from '../src/sim/coords';
import { computeAccel } from '../src/sim/forces';
import { createState } from '../src/sim/state';
import { makeRng } from './helpers';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number): void => {
  expect(a).toHaveLength(b.length);
  for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(tol);
};

describe('Jacobi coordinates', () => {
  // m = (1, 2, 3); bodies at (0,0,0), (3,0,0), (0,6,0).
  // COM = (6 + 0) / 6 in x, (18) / 6 in y: (1, 3, 0). Inner pair COM = (2, 0, 0).
  const m = Float64Array.of(1, 2, 3);
  const q = Float64Array.of(0, 0, 0, 3, 0, 0, 0, 6, 0);
  const expected = [1, 3, 0, 3, 0, 0, -2, 6, 0];

  it('matches a hand calculation', () => {
    const j = new Float64Array(9);
    inertialToJacobi(m, q, j);
    close(j, expected, 1e-15);
  });

  it('inverts the hand calculation', () => {
    const back = new Float64Array(9);
    jacobiToInertial(m, Float64Array.from(expected), back);
    close(back, q, 1e-15);
  });

  it('round-trips random systems to ~1e-15 relative, including a massless outer body and an offset COM', () => {
    const rng = makeRng(5);
    let worst = 0;
    for (let n = 0; n < 1000; n++) {
      const mm = Float64Array.from([0.5 + rng(), 10 ** (6 * rng() - 3), n % 3 === 0 ? 0 : 10 ** (6 * rng() - 3)]);
      const qq = Float64Array.from({ length: 9 }, () => 20 * rng() - 10);
      const j = new Float64Array(9);
      const back = new Float64Array(9);
      inertialToJacobi(mm, qq, j);
      jacobiToInertial(mm, j, back);
      for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(back[i] - qq[i]) / 10);
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it('splits kinetic energy as M V^2/2 + m1* v1^2/2 + m2* v2^2/2 with the Jacobi reduced masses', () => {
    // This is what makes the coordinates Jacobi rather than just any invertible map.
    const rng = makeRng(8);
    for (let n = 0; n < 200; n++) {
      const mm = Float64Array.from([0.5 + rng(), 10 ** (3 * rng() - 2), 10 ** (3 * rng() - 2)]);
      const v = Float64Array.from({ length: 9 }, () => 2 * rng() - 1);
      const jv = new Float64Array(9);
      inertialToJacobi(mm, v, jv);
      const eta1 = mm[0] + mm[1];
      const M = eta1 + mm[2];
      let direct = 0;
      for (let i = 0; i < 3; i++) direct += 0.5 * mm[i] * (v[3 * i] ** 2 + v[3 * i + 1] ** 2 + v[3 * i + 2] ** 2);
      const sq = (o: number): number => jv[o] ** 2 + jv[o + 1] ** 2 + jv[o + 2] ** 2;
      const jacobi = 0.5 * M * sq(0) + 0.5 * ((mm[0] * mm[1]) / eta1) * sq(3) + 0.5 * ((eta1 * mm[2]) / M) * sq(6);
      expect(Math.abs(jacobi - direct)).toBeLessThan(2e-15 * direct);
    }
  });

  it('may convert in place, with output and input the same array', () => {
    const inPlace = Float64Array.from(q);
    inertialToJacobi(m, inPlace, inPlace);
    close(inPlace, expected, 1e-15);
    jacobiToInertial(m, inPlace, inPlace);
    close(inPlace, q, 1e-15);
  });

  it('gives a COM acceleration of zero for a pairwise force, so the COM is force-free', () => {
    const s = createState();
    s.m.set([1, 0.3, 0.01]);
    s.x.set([0.1, -0.2, 0.3, 1.4, 0.2, -0.1, -2.5, 0.9, 0.6]);
    const a = new Float64Array(9);
    computeAccel(s, s.x, a);
    const ja = new Float64Array(9);
    inertialToJacobi(s.m, a, ja);
    expect(Math.hypot(ja[0], ja[1], ja[2])).toBeLessThan(1e-16);
  });
});

describe('shiftToComFrame', () => {
  it('puts the COM at the origin and the total momentum at zero, keeping relative motion', () => {
    const s = createState();
    s.m.set([1, 2, 3]);
    s.x.set([10, 20, 30, 13, 20, 30, 10, 26, 30]);
    s.v.set([5, 1, 0, 5, 3, 0, 5, 1, 4]);
    const rel = s.x[3] - s.x[0];
    shiftToComFrame(s);
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(s.m[0] * s.x[c] + s.m[1] * s.x[3 + c] + s.m[2] * s.x[6 + c])).toBeLessThan(1e-13);
      expect(Math.abs(s.m[0] * s.v[c] + s.m[1] * s.v[3 + c] + s.m[2] * s.v[6 + c])).toBeLessThan(1e-13);
    }
    expect(s.x[3] - s.x[0]).toBeCloseTo(rel, 13);
  });

  it('leaves a system of test particles alone, since it has no COM', () => {
    const s = createState();
    s.x.set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    s.v.set([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const before = createState();
    before.x.set(s.x);
    before.v.set(s.v);
    shiftToComFrame(s);
    expect(s.x).toEqual(before.x);
    expect(s.v).toEqual(before.v);
  });

  it('removes a 1e6 offset to roundoff of that offset', () => {
    const s = createState();
    s.m.set([1, 1, 1]);
    s.x.set([1e6 + 1, 1e6, 1e6, 1e6 - 1, 1e6, 1e6, 1e6, 1e6 + 1, 1e6]);
    shiftToComFrame(s);
    expect(Math.abs(s.x[0] + s.x[3] + s.x[6])).toBeLessThan(1e-9);
    expect(Math.abs(s.x[2])).toBeLessThan(1e-9);
  });
});
