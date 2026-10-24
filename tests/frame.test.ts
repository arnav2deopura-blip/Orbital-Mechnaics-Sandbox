import { describe, expect, it } from 'vitest';
import { PlaneFrame, snapDirection, updatePlaneFrame } from '../src/render/frame';
import { wrap } from '../src/render/gridPlane';
import { createState } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { kepler } from './helpers';

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): number[] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The Kepler pair rotated about the x axis by `tilt`, so its orbital plane has normal (0, -sin, cos). */
function tiltedPair(tilt: number): SystemState {
  const s = kepler().s;
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  for (const a of [s.x, s.v]) {
    for (let i = 0; i < 3; i++) {
      const y = a[3 * i + 1];
      const z = a[3 * i + 2];
      a[3 * i + 1] = c * y - sn * z;
      a[3 * i + 2] = sn * y + c * z;
    }
  }
  return s;
}

function expectRightHanded(f: PlaneFrame): void {
  for (const e of [f.e1, f.e2, f.n]) expect(Math.hypot(e[0], e[1], e[2])).toBeCloseTo(1, 14);
  expect(Math.abs(dot(f.e1, f.e2))).toBeLessThan(1e-14);
  expect(Math.abs(dot(f.e1, f.n))).toBeLessThan(1e-14);
  expect(Math.abs(dot(f.e2, f.n))).toBeLessThan(1e-14);
  cross(f.e1, f.e2).forEach((c, i) => expect(c).toBeCloseTo(f.n[i], 14));
}

describe('updatePlaneFrame', () => {
  it("is z = 0 through the origin in 'xy' mode, whatever the state", () => {
    const s = tiltedPair(0.7);
    const f = new PlaneFrame();
    updatePlaneFrame('xy', s.x, s.v, s.m, f);
    expect(Array.from(f.e1)).toEqual([1, 0, 0]);
    expect(Array.from(f.e2)).toEqual([0, 1, 0]);
    expect(Array.from(f.n)).toEqual([0, 0, 1]);
    expect(Array.from(f.point)).toEqual([0, 0, 0]);
    expect(f.angular).toBe(false);
  });

  it("follows the angular momentum in 'angular' mode: planar orbits lie in the plane", () => {
    for (const tilt of [0, 0.3, 1.2, 2.5, -0.9]) {
      const s = tiltedPair(tilt);
      const f = new PlaneFrame();
      updatePlaneFrame('angular', s.x, s.v, s.m, f);
      expect(f.angular).toBe(true);
      expectRightHanded(f);
      // The pair's orbit normal was (0, 0, 1) turned about x by `tilt`.
      expect(f.n[1]).toBeCloseTo(-Math.sin(tilt), 12);
      expect(f.n[2]).toBeCloseTo(Math.cos(tilt), 12);
      // Every body's offset from the COM is in the plane: its normal component is zero.
      for (let i = 0; i < 2; i++) {
        const r = [s.x[3 * i] - f.point[0], s.x[3 * i + 1] - f.point[1], s.x[3 * i + 2] - f.point[2]];
        expect(Math.abs(dot(r, f.n))).toBeLessThan(1e-12);
      }
    }
  });

  it('reduces to the xy frame for an orbit already in the xy plane', () => {
    const s = kepler().s;
    const f = new PlaneFrame();
    updatePlaneFrame('angular', s.x, s.v, s.m, f);
    expect(Array.from(f.n)).toEqual([0, 0, 1]);
    // Compared by value: the components that should be zero may be -0.
    [1, 0, 0].forEach((c, i) => expect(f.e1[i]).toBeCloseTo(c, 14));
    [0, 1, 0].forEach((c, i) => expect(f.e2[i]).toBeCloseTo(c, 14));
  });

  it('uses the center of mass and its velocity, so a bulk drift changes nothing', () => {
    const s = tiltedPair(0.6);
    const ref = new PlaneFrame();
    updatePlaneFrame('angular', s.x, s.v, s.m, ref);
    for (let i = 0; i < 3; i++) {
      s.x[3 * i] += 1e3;
      s.x[3 * i + 2] -= 40;
      s.v[3 * i + 1] += 5;
    }
    const f = new PlaneFrame();
    updatePlaneFrame('angular', s.x, s.v, s.m, f);
    f.n.forEach((c, i) => expect(c).toBeCloseTo(ref.n[i], 9));
    expect(f.point[0]).toBeCloseTo(1e3 + ref.point[0], 9);
    expect(f.point[2]).toBeCloseTo(-40 + ref.point[2], 9);
  });

  it('falls back to z = 0 when the angular momentum has no direction (bodies at rest, or L = 0)', () => {
    const rest = createState();
    rest.m.set([3, 4, 5]);
    rest.x.set([1, 3, 0, -2, -1, 0, 1, -1, 0]);
    const f = new PlaneFrame();
    updatePlaneFrame('angular', rest.x, rest.v, rest.m, f);
    expect(f.angular).toBe(false);
    expect(Array.from(f.n)).toEqual([0, 0, 1]);
    expect(Array.from(f.point)).toEqual([0, 0, 0]);

    // Head-on: velocities along the line joining the bodies, so L = 0 although they move.
    const line = createState();
    line.m.set([1, 1, 1]);
    line.x.set([-1, 0, 0, 0, 0, 0, 1, 0, 0]);
    line.v.set([1, 0, 0, 0, 0, 0, -1, 0, 0]);
    updatePlaneFrame('angular', line.x, line.v, line.m, f);
    expect(f.angular).toBe(false);
  });

  it('falls back when every mass is zero', () => {
    const s = tiltedPair(0.4);
    s.m.fill(0);
    const f = new PlaneFrame();
    updatePlaneFrame('angular', s.x, s.v, s.m, f);
    expect(f.angular).toBe(false);
  });

  it('builds a valid frame when L is along x, where the reference axis must change', () => {
    const s = createState();
    s.m.set([1, 1, 1]);
    // An orbit in the yz plane, circulating about +x: L along +x.
    s.x.set([0, 1, 0, 0, -1, 0, 0, 0, 0]);
    s.v.set([0, 0, 1, 0, 0, -1, 0, 0, 0]);
    const f = new PlaneFrame();
    updatePlaneFrame('angular', s.x, s.v, s.m, f);
    expect(f.angular).toBe(true);
    expect(f.n[0]).toBeCloseTo(1, 14);
    expectRightHanded(f);
  });

  it('writes in place and can switch back to xy', () => {
    const s = tiltedPair(1);
    const f = new PlaneFrame();
    const { e1, n } = f;
    updatePlaneFrame('angular', s.x, s.v, s.m, f);
    updatePlaneFrame('xy', s.x, s.v, s.m, f);
    expect(f.e1).toBe(e1);
    expect(f.n).toBe(n);
    expect(Array.from(f.n)).toEqual([0, 0, 1]);
    expect(f.angular).toBe(false);
  });
});

describe('PlaneFrame.offsetFrom', () => {
  it("is the plane's distance from the origin along n, exactly, even far from the world origin", () => {
    const f = new PlaneFrame(); // z = 0
    expect(f.offsetFrom(Float64Array.of(5, 6, 7))).toBe(-7);
    expect(f.offsetFrom(Float64Array.of(1e9, 1e9, 1e9 + 0.25))).toBe(-(1e9 + 0.25));
    f.point.set([0, 0, 2]);
    expect(f.offsetFrom(Float64Array.of(0, 0, 0))).toBe(2);
  });
});

describe('snapDirection', () => {
  const out = new Float64Array(3);

  it("looks down the normal for 'top', from -e2 for 'front' and along e1 for 'side'", () => {
    const f = new PlaneFrame();
    snapDirection('top', f, out);
    expect(dot(out, f.n)).toBeGreaterThan(0.9999);
    snapDirection('front', f, out);
    expect(Array.from(out)).toEqual([0, -1, 0]);
    snapDirection('side', f, out);
    expect(Array.from(out)).toEqual([1, 0, 0]);
  });

  it('gives unit directions, and an isometric view above the plane and in front of it', () => {
    const f = new PlaneFrame();
    for (const view of ['top', 'front', 'side', 'iso'] as const) {
      snapDirection(view, f, out);
      expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 14);
    }
    snapDirection('iso', f, out);
    expect(dot(out, f.n)).toBeGreaterThan(0.3);
    expect(dot(out, f.e2)).toBeLessThan(-0.3);
  });

  it('is relative to the frame, so a tilted plane gets tilted views', () => {
    const s = tiltedPair(0.8);
    const f = new PlaneFrame();
    updatePlaneFrame('angular', s.x, s.v, s.m, f);
    snapDirection('top', f, out);
    expect(dot(out, f.n)).toBeGreaterThan(0.9999);
    snapDirection('front', f, out);
    expect(dot(out, f.e2)).toBeCloseTo(-1, 14);
    // The front view looks along e2, with the normal up on screen: n is perpendicular to the view.
    expect(Math.abs(dot(out, f.n))).toBeLessThan(1e-14);
  });
});

describe('wrap', () => {
  it('is the Euclidean remainder', () => {
    expect(wrap(7, 3)).toBe(1);
    expect(wrap(-1, 3)).toBe(2);
    expect(wrap(-6, 3)).toBe(0);
    expect(wrap(0.25, 1)).toBe(0.25);
  });

  it('keeps world grid lines in place at a 1e9 offset, where a Float32 modulo could not', () => {
    // A line at world u = 1e9 + 0.5 with cells of 0.25: the shader sees (u + center) / cell, and
    // center is reduced to [0, 2.5) in Float64, small enough for Float32 to hold to ~1e-7.
    const center = wrap(1e9 + 0.5, 2.5);
    expect(center).toBeLessThan(2.5);
    expect(Math.abs(Math.fround(center) - center)).toBeLessThan(2e-7);
    expect(wrap(center, 0.25)).toBeCloseTo(wrap(1e9 + 0.5, 0.25), 6);
  });
});
