import { describe, expect, it } from 'vitest';
import { computeAccel, potentialEnergy } from '../src/sim/forces';
import { createCounters, createState } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { makeRng } from './helpers';

function makeState(
  m: number[],
  x: number[],
  v: number[] = new Array<number>(9).fill(0),
  G = 1,
  eps2 = 0,
): SystemState {
  const s = createState(G, eps2);
  s.m.set(m);
  s.x.set(x);
  s.v.set(v);
  return s;
}

/** Random bodies in [-1, 1]^3, at least 0.1 apart, with masses spread over six decades. */
function randomState(rng: () => number, eps2: number): SystemState {
  const s = createState(0.5 + 40 * rng(), eps2);
  for (;;) {
    for (let i = 0; i < 3; i++) s.m[i] = 10 ** (6 * rng() - 3);
    for (let i = 0; i < 9; i++) {
      s.x[i] = 2 * rng() - 1;
      s.v[i] = 2 * rng() - 1;
    }
    const sep = (i: number, j: number) =>
      Math.hypot(s.x[3 * j] - s.x[3 * i], s.x[3 * j + 1] - s.x[3 * i + 1], s.x[3 * j + 2] - s.x[3 * i + 2]);
    if (Math.min(sep(0, 1), sep(0, 2), sep(1, 2)) > 0.1) return s;
  }
}

/** |sum m_i a_i| relative to sum m_i |a_i|: the size of the cancellation against its own terms. */
function netForceRatio(s: SystemState, a: Float64Array): number {
  let px = 0;
  let py = 0;
  let pz = 0;
  let scale = 0;
  for (let i = 0; i < 3; i++) {
    px += s.m[i] * a[3 * i];
    py += s.m[i] * a[3 * i + 1];
    pz += s.m[i] * a[3 * i + 2];
    scale += s.m[i] * Math.hypot(a[3 * i], a[3 * i + 1], a[3 * i + 2]);
  }
  return Math.hypot(px, py, pz) / scale;
}

/** Cyclically shifts the axes of every body: component c moves to (c + shift) % 3. */
function rotateAxes(v: number[], shift: number): number[] {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) out[3 * i + ((c + shift) % 3)] = v[3 * i + c];
  return out;
}

/** Straightforward all-pairs loop with Math.pow, written independently of the unrolled kernel. */
function referenceAccel(s: SystemState): number[] {
  const a = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      const d = [0, 1, 2].map((c) => s.x[3 * j + c] - s.x[3 * i + c]);
      const r2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 + s.eps2;
      const k = (s.G * s.m[j]) / Math.pow(r2, 1.5);
      for (let c = 0; c < 3; c++) a[3 * i + c] += k * d[c];
    }
  }
  return a;
}

describe('computeAccel: against a naive reference', () => {
  // Hand calculations cannot cover every pair with softening on, and the momentum tests
  // cannot see an error that is symmetric within a pair. This does both.
  it.each([0, 0.01, 0.25])('agrees on random systems, including test particles (eps2 = %s)', (eps2) => {
    const rng = makeRng(7);
    const a = new Float64Array(9);
    for (let trial = 0; trial < 500; trial++) {
      const s = randomState(rng, eps2);
      if (trial % 4 === 0) s.m[trial % 3] = 0;
      computeAccel(s, s.x, a);
      const ref = referenceAccel(s);
      const scale = Math.max(...ref.map(Math.abs));
      for (let i = 0; i < 9; i++) expect(Math.abs(a[i] - ref[i])).toBeLessThan(1e-13 * scale);
    }
  });
});

describe('computeAccel: hand calculations', () => {
  // 3-4-5 triangle, unit masses and G: r01 = 3, r02 = 4, r12 = 5.
  const triangleX = [0, 0, 0, 3, 0, 0, 0, 4, 0];
  const triangleA = [
    1 / 9, 1 / 16, 0,
    -1 / 9 - 3 / 125, 4 / 125, 0,
    3 / 125, -1 / 16 - 4 / 125, 0,
  ];

  it.each([0, 1, 2])('matches the 3-4-5 triangle with the axes cyclically shifted by %i', (shift) => {
    const s = makeState([1, 1, 1], rotateAxes(triangleX, shift));
    const a = new Float64Array(9);
    computeAccel(s, s.x, a);
    const expected = rotateAxes(triangleA, shift);
    for (let i = 0; i < 9; i++) expect(a[i]).toBeCloseTo(expected[i], 14);
  });

  it('matches a collinear system with unequal masses', () => {
    const s = makeState([1, 2, 4], [0, 0, 0, 1, 0, 0, 3, 0, 0]);
    const a = new Float64Array(9);
    computeAccel(s, s.x, a);
    expect(a[0]).toBeCloseTo(22 / 9, 14);
    expect(a[3]).toBeCloseTo(0, 14);
    expect(a[6]).toBeCloseTo(-11 / 18, 14);
  });

  it('scales linearly with G', () => {
    const base = makeState([1, 2, 4], [0, 0, 0, 1, 0, 0, 3, 0, 0], undefined, 1);
    const scaled = makeState([1, 2, 4], [0, 0, 0, 1, 0, 0, 3, 0, 0], undefined, 4 * Math.PI ** 2);
    const a = new Float64Array(9);
    const b = new Float64Array(9);
    computeAccel(base, base.x, a);
    computeAccel(scaled, scaled.x, b);
    for (let i = 0; i < 9; i++) expect(b[i]).toBeCloseTo(4 * Math.PI ** 2 * a[i], 12);
  });

  it('applies Plummer softening: a = G m d / (r^2 + eps2)^(3/2)', () => {
    // r = 3, eps2 = 16, so (r^2 + eps2)^(3/2) = 25^(3/2) = 125. The third body is massless.
    const s = makeState([1, 1, 0], [0, 0, 0, 3, 0, 0, 50, 0, 0], undefined, 1, 16);
    const a = new Float64Array(9);
    computeAccel(s, s.x, a);
    expect(a[0]).toBeCloseTo(3 / 125, 14);
    expect(a[3]).toBeCloseTo(-3 / 125, 14);
  });

  it('lets a test particle feel the others without pulling on them', () => {
    const pair = makeState([1, 1, 0], [0, 0, 0, 3, 0, 0, 0, 100, 0]);
    const moved = makeState([1, 1, 0], [0, 0, 0, 3, 0, 0, 0, 1, 0]);
    const a = new Float64Array(9);
    const b = new Float64Array(9);
    computeAccel(pair, pair.x, a);
    computeAccel(moved, moved.x, b);
    // Moving the massless body must not change the two real bodies' accelerations.
    for (let i = 0; i < 6; i++) expect(b[i]).toBe(a[i]);
    // ...but it is pulled toward them.
    expect(b[7]).toBeLessThan(0);
  });

  it('evaluates at the positions passed in, not at s.x', () => {
    const s = makeState([1, 1, 1], [9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const a = new Float64Array(9);
    computeAccel(s, new Float64Array(triangleX), a);
    expect(a[0]).toBeCloseTo(1 / 9, 14);
    expect(a[4]).toBeCloseTo(4 / 125, 14);
  });

  it('overwrites a rather than accumulating into it', () => {
    const s = makeState([1, 1, 1], triangleX);
    const a = new Float64Array(9).fill(123);
    computeAccel(s, s.x, a);
    expect(a[0]).toBeCloseTo(1 / 9, 14);
  });

  it('increments forceEvals once per call, and only when counters is passed', () => {
    const s = makeState([1, 1, 1], triangleX);
    const a = new Float64Array(9);
    const counters = createCounters();
    computeAccel(s, s.x, a, counters);
    computeAccel(s, s.x, a, counters);
    computeAccel(s, s.x, a);
    expect(counters.forceEvals).toBe(2);
  });
});

describe('potentialEnergy', () => {
  it('matches -G sum m_i m_j / r_ij on the 3-4-5 triangle', () => {
    const s = makeState([1, 1, 1], [0, 0, 0, 3, 0, 0, 0, 4, 0]);
    expect(potentialEnergy(s)).toBeCloseTo(-(1 / 3 + 1 / 4 + 1 / 5), 14);
  });

  it('uses the softened distance when eps2 > 0', () => {
    const s = makeState([2, 3, 5], [0, 0, 0, 3, 0, 0, 0, 4, 0], undefined, 2, 16);
    const expected = -2 * (6 / Math.sqrt(25) + 10 / Math.sqrt(32) + 15 / Math.sqrt(41));
    expect(potentialEnergy(s)).toBeCloseTo(expected, 14);
  });
});

describe('linear momentum', () => {
  // The force on each body is equal and opposite to its partner's, so dP/dt = sum m_i a_i = 0.
  it.each([0, 0.01])('has sum m a = 0 to roundoff for random systems (eps2 = %s)', (eps2) => {
    const rng = makeRng(20250101);
    const a = new Float64Array(9);
    let worst = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const s = randomState(rng, eps2);
      if (trial % 4 === 0) s.m[2] = 0; // include test-particle systems
      computeAccel(s, s.x, a);
      worst = Math.max(worst, netForceRatio(s, a));
    }
    expect(worst).toBeLessThan(1e-15);
  });

  /** Kick-drift (symplectic Euler) is enough here: momentum conservation is a property of the force. */
  function momentumDrift(s: SystemState, dt: number, steps: number): number {
    const a = new Float64Array(9);
    const p0 = new Float64Array(3);
    const momentum = (out: Float64Array) => {
      out.fill(0);
      for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) out[c] += s.m[i] * s.v[3 * i + c];
    };
    momentum(p0);
    const p = new Float64Array(3);
    let scale = 0;
    let worst = 0;
    for (let n = 0; n < steps; n++) {
      computeAccel(s, s.x, a);
      for (let j = 0; j < 9; j++) s.v[j] += a[j] * dt;
      for (let j = 0; j < 9; j++) s.x[j] += s.v[j] * dt;
      momentum(p);
      let speed = 0;
      for (let i = 0; i < 3; i++) speed += s.m[i] * Math.hypot(s.v[3 * i], s.v[3 * i + 1], s.v[3 * i + 2]);
      scale = Math.max(scale, speed);
      worst = Math.max(worst, Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]));
    }
    return worst / scale;
  }

  it('stays at zero over 2e4 steps of the figure-eight orbit', () => {
    // Plan §8.3 initial conditions (G = 1, unit masses). Total momentum starts at 0.
    const x1 = [0.97000436, -0.24308753, 0];
    const v3 = [-0.93240737, -0.86473146, 0];
    const s = makeState(
      [1, 1, 1],
      [...x1, ...x1.map((c) => -c), 0, 0, 0],
      [...v3.map((c) => -c / 2), ...v3.map((c) => -c / 2), ...v3],
    );
    expect(momentumDrift(s, 1e-3, 20000)).toBeLessThan(1e-13);
  });

  it('is conserved for unequal masses with nonzero total momentum', () => {
    const s = makeState(
      [3, 1, 0.01],
      [-0.5, 0, 0, 0.8, 0.1, 0, 0.1, 1.2, 0.3],
      [0.1, 0.4, 0, -0.2, 0.3, 0.05, 0.5, -0.6, 0],
      1,
      0.05 ** 2,
    );
    expect(momentumDrift(s, 1e-3, 20000)).toBeLessThan(1e-13);
  });
});
