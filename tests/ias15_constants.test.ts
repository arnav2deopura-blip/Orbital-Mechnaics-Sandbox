import { describe, expect, it } from 'vitest';
import { IAS15_C, IAS15_D, IAS15_H, IAS15_NP } from '../src/sim/integrators/ias15_constants';
import { makeRng } from './helpers';

const M = 7;
const tri = (n: number, k: number): number => (n * (n - 1)) / 2 + (k - 1);
/** h_0 = 0 followed by h_1 .. h_7. */
const nodes = [0, ...IAS15_H];

/** Coefficients of N_k(h) = h (h - h_1) ... (h - h_(k-1)), ascending powers, from the generated table. */
const newtonPoly = (k: number): number[] => [0, ...Array.from({ length: k }, (_, i) => IAS15_C[tri(k, i + 1)])];
const evalPoly = (c: number[], x: number): number => c.reduceRight((acc, a) => acc * x + a, 0);

describe('IAS15 constants', () => {
  it('has the tabulated Radau spacings, as the very same doubles', () => {
    // Transcribed from the published table (see tools/gen_ias15_constants.py).
    const published = [
      '0.0562625605369221464656521910318',
      '0.180240691736892364987579942780',
      '0.352624717113169637373907769648',
      '0.547153626330555383001448554766',
      '0.734210177215410531523210605558',
      '0.885320946839095768090359771030',
      '0.977520613561287501891174488626',
    ];
    expect(Array.from(IAS15_H)).toEqual(published.map(Number));
  });

  it('is a Radau rule: the nodes 0, h_1 .. h_7 integrate h^p exactly for p <= 14', () => {
    // Weights from the first 8 moments (Gaussian elimination with pivoting), then the
    // remaining 7 degrees are the test. The residual is ~5e-15 in double precision, and the
    // generator checks the same thing at 1e-60.
    const n = 8;
    const A = Array.from({ length: n }, (_, p) => [...nodes.map((h) => h ** p), 1 / (p + 1)]);
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      [A[col], A[piv]] = [A[piv], A[col]];
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
      }
    }
    const w = A.map((row, i) => row[n] / row[i]);
    expect(w.every((x) => x > 0)).toBe(true);
    for (let p = n; p <= 2 * n - 2; p++) {
      const quad = nodes.reduce((sum, h, j) => sum + w[j] * h ** p, 0);
      expect(Math.abs(quad - 1 / (p + 1))).toBeLessThan(5e-14);
    }
    // ...and degree 15 is out of reach, so this is Radau and not something exact for more.
    const p15 = nodes.reduce((sum, h, j) => sum + w[j] * h ** 15, 0);
    expect(Math.abs(p15 - 1 / 16)).toBeGreaterThan(1e-10);
  });

  it('has Newton basis polynomials that vanish at the earlier nodes and are monic', () => {
    for (let k = 1; k <= M; k++) {
      expect(IAS15_C[tri(k, k)]).toBe(1);
      for (let j = 0; j < k; j++) expect(Math.abs(evalPoly(newtonPoly(k), nodes[j]))).toBeLessThan(3e-16);
    }
  });

  it('has N_k(h_n) values that agree with the coefficient table', () => {
    for (let n = 1; n <= M; n++) {
      for (let k = 1; k <= n; k++) {
        expect(Math.abs(IAS15_NP[tri(n, k)] - evalPoly(newtonPoly(k), nodes[n]))).toBeLessThan(2e-15);
      }
    }
  });

  it('has D inverting the g -> b map', () => {
    // b_j = sum over i >= j of U[j][i] g_i, with U[j][i] the coefficient of h^(j+1) in N_(i+1).
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < M; j++) {
        let sum = 0;
        for (let k = 0; k < M; k++) {
          const u = k <= j ? IAS15_C[tri(j + 1, k + 1)] : 0; // U[k][j]
          sum += IAS15_D[M * i + k] * u;
        }
        expect(Math.abs(sum - (i === j ? 1 : 0))).toBeLessThan(5e-15);
      }
    }
  });

  it('recovers the monomial coefficients of a degree-7 acceleration from its values at the nodes', () => {
    // The same recursion the integrator runs, node by node.
    const rng = makeRng(15);
    for (let trial = 0; trial < 50; trial++) {
      const a0 = 2 * rng() - 1;
      const b = Array.from({ length: M }, () => 2 * rng() - 1);
      const a = (h: number): number => a0 + b.reduce((s, bk, k) => s + bk * h ** (k + 1), 0);
      const g = new Array<number>(M + 1).fill(0);
      for (let n = 1; n <= M; n++) {
        let rhs = a(nodes[n]) - a0;
        for (let k = 1; k < n; k++) rhs -= g[k] * IAS15_NP[tri(n, k)];
        g[n] = rhs / IAS15_NP[tri(n, n)];
      }
      for (let j = 0; j < M; j++) {
        let bj = 0;
        for (let k = j + 1; k <= M; k++) bj += g[k] * IAS15_C[tri(k, j + 1)];
        expect(Math.abs(bj - b[j])).toBeLessThan(2e-11);
      }
      // ...and D takes b back to g.
      for (let i = 0; i < M; i++) {
        let gi = 0;
        for (let j = i; j < M; j++) gi += IAS15_D[M * i + j] * b[j];
        expect(Math.abs(gi - g[i + 1])).toBeLessThan(2e-11);
      }
    }
  });
});
