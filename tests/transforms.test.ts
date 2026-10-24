import { describe, expect, it } from 'vitest';
import { characteristicSpeed, systemSize } from '../src/sim/diagnostics';
import { nudge, rotateState } from '../src/sim/transforms';
import type { NudgeDirection } from '../src/sim/transforms';
import { createState, snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { angularMomentum, energy, kepler, makeRng, momentum, pythagorean } from './helpers';

function randomState(seed: number): SystemState {
  const rng = makeRng(seed);
  const s = createState(1.3);
  for (let i = 0; i < 3; i++) s.m[i] = 0.2 + 3 * rng();
  for (let i = 0; i < 9; i++) {
    s.x[i] = 4 * rng() - 2;
    s.v[i] = 2 * rng() - 1;
  }
  return s;
}

describe('rotateState', () => {
  it.each(['x', 'y', 'z'] as const)('about %s: a right-handed quarter turn', (axis) => {
    const s = createState();
    s.m.set([1, 1, 1]);
    s.x.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    s.v.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    rotateState(s, axis, 90);
    const expected: Record<string, number[]> = {
      x: [1, 0, 0, 0, 0, 1, 0, -1, 0], // y -> z, z -> -y
      y: [0, 0, -1, 0, 1, 0, 1, 0, 0], // z -> x, x -> -z
      z: [0, 1, 0, -1, 0, 0, 0, 0, 1], // x -> y, y -> -x
    };
    expected[axis].forEach((c, i) => {
      expect(s.x[i]).toBeCloseTo(c, 14);
      expect(s.v[i]).toBeCloseTo(c, 14);
    });
  });

  it('keeps energy, and the magnitudes of momentum and angular momentum', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const s = randomState(4);
      const before = snapshot(s);
      rotateState(s, axis, 37.5);
      expect(energy(s)).toBeCloseTo(energy(before), 12);
      expect(Math.hypot(...angularMomentum(s))).toBeCloseTo(Math.hypot(...angularMomentum(before)), 12);
      expect(Math.hypot(...momentum(s))).toBeCloseTo(Math.hypot(...momentum(before)), 12);
    }
  });

  it('undoes itself with the opposite angle, and leaves masses, G and softening alone', () => {
    const s = randomState(5);
    s.eps2 = 0.01;
    const before = snapshot(s);
    rotateState(s, 'y', 123);
    rotateState(s, 'y', -123);
    for (let i = 0; i < 9; i++) {
      expect(s.x[i]).toBeCloseTo(before.x[i], 13);
      expect(s.v[i]).toBeCloseTo(before.v[i], 13);
    }
    expect(s.m).toEqual(before.m);
    expect(s.G).toBe(before.G);
    expect(s.eps2).toBe(before.eps2);
  });

  it('takes a planar orbit out of the xy plane: the angular momentum turns with it', () => {
    const s = kepler().s;
    rotateState(s, 'x', 90);
    const L = angularMomentum(s);
    expect(Math.abs(L[2])).toBeLessThan(1e-12);
    expect(Math.abs(L[1])).toBeGreaterThan(0.1);
  });
});

describe('nudge', () => {
  const kick = (spec: Parameters<typeof nudge>[1], s = kepler().s, rng?: () => number): { before: SystemState; after: SystemState; dir: number[] } => {
    const before = snapshot(s);
    const dir = nudge(s, spec, rng);
    return { before, after: s, dir };
  };

  it.each([
    ['x', [1, 0, 0]],
    ['y', [0, 1, 0]],
    ['z', [0, 0, 1]],
  ] as const)('moves one body along %s by size x the system size, and touches nothing else', (direction, unit) => {
    const s = kepler().s;
    const size = systemSize(s);
    const { before, after } = kick({ body: 1, target: 'position', direction, size: 1e-4 }, s);
    for (let i = 0; i < 9; i++) {
      const body = Math.floor(i / 3);
      const c = i % 3;
      const expected = before.x[i] + (body === 1 ? 1e-4 * size * unit[c] : 0);
      expect(after.x[i]).toBeCloseTo(expected, 14);
      expect(after.v[i]).toBe(before.v[i]);
    }
  });

  it('kicks the velocity by size x the characteristic speed', () => {
    const s = kepler().s;
    const speed = characteristicSpeed(s);
    const { before, after } = kick({ body: 0, target: 'velocity', direction: 'z', size: 1e-3 }, s);
    expect(after.v[2] - before.v[2]).toBeCloseTo(1e-3 * speed, 14);
    expect(after.x).toEqual(before.x);
  });

  it("'normal' is out of the orbital plane: along the angular momentum", () => {
    const s = kepler().s; // orbits in xy: L along +z
    const { dir } = kick({ body: 2, target: 'position', direction: 'normal', size: 1e-6 }, s);
    expect(dir[2]).toBeCloseTo(1, 12);
    rotateState(s, 'x', 90); // the plane is now xz; L along -y
    const turned = nudge(s, { body: 2, target: 'position', direction: 'normal', size: 1e-6 });
    expect(turned[1]).toBeCloseTo(-1, 12);
  });

  it("'normal' falls back to z for a system with no angular momentum", () => {
    const s = pythagorean(); // at rest
    const { dir } = kick({ body: 0, target: 'velocity', direction: 'normal', size: 1e-6 }, s);
    expect(dir).toEqual([0, 0, 1]);
  });

  it("'normal' is about the COM, so a bulk drift does not change it", () => {
    const s = kepler().s;
    for (let i = 0; i < 3; i++) {
      s.x[3 * i + 1] += 5;
      s.v[3 * i + 2] += 2; // bulk motion along z would swamp L about the origin
    }
    const { dir } = kick({ body: 2, target: 'position', direction: 'normal', size: 1e-6 }, s);
    expect(dir[2]).toBeCloseTo(1, 9);
  });

  it('random directions are unit vectors, uniform enough, and reproducible from the rng', () => {
    const rng = makeRng(11);
    const sum = [0, 0, 0];
    const n = 4000;
    for (let k = 0; k < n; k++) {
      const { dir } = kick({ body: 0, target: 'position', direction: 'random', size: 1e-9 }, kepler().s, rng);
      expect(Math.hypot(...dir)).toBeCloseTo(1, 12);
      for (let c = 0; c < 3; c++) sum[c] += dir[c];
    }
    for (let c = 0; c < 3; c++) expect(Math.abs(sum[c] / n)).toBeLessThan(0.05);

    const a = kick({ body: 0, target: 'velocity', direction: 'random', size: 1e-3 }, kepler().s, makeRng(3));
    const b = kick({ body: 0, target: 'velocity', direction: 'random', size: 1e-3 }, kepler().s, makeRng(3));
    expect(a.dir).toEqual(b.dir);
  });

  it('can send a planar system out of the plane (z, or normal), which no in-plane nudge does', () => {
    for (const direction of ['x', 'y'] as NudgeDirection[]) {
      const { after } = kick({ body: 0, target: 'velocity', direction, size: 1e-3 });
      expect(after.v[2]).toBe(0);
    }
    for (const direction of ['z', 'normal'] as NudgeDirection[]) {
      const { after } = kick({ body: 0, target: 'velocity', direction, size: 1e-3 });
      expect(Math.abs(after.v[2])).toBeGreaterThan(0);
    }
  });
});
