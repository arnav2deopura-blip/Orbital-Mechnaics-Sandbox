import { describe, expect, it } from 'vitest';
import { Bodies } from '../src/render/bodies';
import { defaultSettings, FloatingOrigin, focusPoint } from '../src/render/scene';

const x = Float64Array.of(1, 2, 3, 11, 12, 13, 21, 22, 23);

describe('focusPoint', () => {
  it('is the mass-weighted center for com', () => {
    const out = new Float64Array(3);
    expect(focusPoint('com', x, Float64Array.of(1, 1, 2), out)).toBe(true);
    // (1*1 + 1*11 + 2*21) / 4 = 13.5
    expect(Array.from(out)).toEqual([13.5, 14.5, 15.5]);
  });

  it('falls back to the plain mean when every mass is zero', () => {
    const out = new Float64Array(3);
    focusPoint('com', x, new Float64Array(3), out);
    expect(Array.from(out)).toEqual([11, 12, 13]);
  });

  it.each([
    ['body0', [1, 2, 3]],
    ['body1', [11, 12, 13]],
    ['body2', [21, 22, 23]],
  ] as const)('is the position of the body for %s', (mode, expected) => {
    const out = new Float64Array(3);
    expect(focusPoint(mode, x, Float64Array.of(1, 1, 1), out)).toBe(true);
    expect(Array.from(out)).toEqual(expected);
  });

  it('has none in free mode, and leaves out untouched', () => {
    const out = Float64Array.of(7, 8, 9);
    expect(focusPoint('free', x, Float64Array.of(1, 1, 1), out)).toBe(false);
    expect(Array.from(out)).toEqual([7, 8, 9]);
  });
});

describe('FloatingOrigin', () => {
  const m = Float64Array.of(1, 1, 1);

  it('moves onto the focus when following, and in free mode stays where panning left it', () => {
    const origin = new FloatingOrigin();
    origin.follow('body1', x, m);
    expect(Array.from(origin.world)).toEqual([11, 12, 13]);
    origin.absorb(1, 1, 1); // the user pans
    origin.follow('free', x, m); // every frame, in free mode
    expect(Array.from(origin.world)).toEqual([12, 13, 14]);
  });

  it('folds a pan offset into the origin', () => {
    const origin = new FloatingOrigin();
    origin.follow('body0', x, m);
    origin.absorb(0.5, -0.25, 0.125);
    expect(Array.from(origin.world)).toEqual([1.5, 1.75, 3.125]);
  });

  it('keeps positions 1e9 from the world origin exact relative to the focus, which Float32 cannot', () => {
    // Offsets of a fraction of a unit around 1e9: exact in Float64, but Float32 there is spaced
    // 64 apart, so a plain Float32 pipeline cannot tell the three bodies' x apart at all.
    const base = 1e9;
    const world = Float64Array.of(base + 0.125, base, base, base + 0.5, base + 0.25, base, base - 0.375, base, base + 0.0625);
    const origin = new FloatingOrigin();
    origin.follow('com', world, Float64Array.of(1, 1, 1));
    for (let i = 0; i < 9; i++) {
      const relative = world[i] - origin.world[i % 3];
      // The subtraction is exact in Float64, so what reaches the GPU is the true offset, small
      // enough for Float32 to hold to ~1e-8.
      expect(Math.abs(relative)).toBeLessThan(1);
      expect(Math.abs(Math.fround(relative) - relative)).toBeLessThan(1e-7);
    }
    const bodyX = [world[0], world[3], world[6]];
    expect(new Set(bodyX).size).toBe(3);
    expect(new Set(bodyX.map(Math.fround)).size).toBe(1);
    const relativeX = bodyX.map((w) => Math.fround(w - origin.world[0]));
    expect(new Set(relativeX).size).toBe(3);
  });
});

describe('Bodies', () => {
  const origin = Float64Array.of(1e9, 0, 0);
  const pos = Float64Array.of(1e9 + 1, 2, 3, 1e9 - 1, 4, 5, 1e9, 6, 7);

  function radii(m: number[], reference: number, minimum: number): number[] {
    const bodies = new Bodies();
    bodies.update(pos, Float64Array.from(m), origin, reference, minimum);
    const out = (bodies.group.children as { scale: { x: number } }[]).map((mesh) => mesh.scale.x);
    bodies.dispose();
    return out;
  }

  it('places each sphere at its position minus the origin, exactly', () => {
    const bodies = new Bodies();
    bodies.update(pos, Float64Array.of(1, 1, 1), origin, 1, 0.01);
    expect(bodies.group.children.map((mesh) => mesh.position.toArray())).toEqual([
      [1, 2, 3],
      [-1, 4, 5],
      [0, 6, 7],
    ]);
    bodies.dispose();
  });

  it('sizes the radius as m^(1/3), relative to the heaviest body', () => {
    const r = radii([8, 1, 27], 3, 0);
    expect(r[2]).toBeCloseTo(3, 12);
    expect(r[0]).toBeCloseTo(3 * 2 / 3, 12); // (8/27)^(1/3) = 2/3
    expect(r[1]).toBeCloseTo(3 * 1 / 3, 12);
  });

  it('never shows a body smaller than the minimum, so a test particle stays visible', () => {
    const r = radii([1, 0, 1e-12], 1, 0.05);
    expect(r[0]).toBe(1);
    expect(r[1]).toBe(0.05);
    expect(r[2]).toBe(0.05);
  });

  it('copes with every mass zero', () => {
    expect(radii([0, 0, 0], 1, 0.05)).toEqual([0.05, 0.05, 0.05]);
  });
});

describe('defaultSettings', () => {
  it('returns a fresh object each time, so views do not share state', () => {
    const a = defaultSettings();
    a.showGrid = !a.showGrid;
    expect(defaultSettings().showGrid).not.toBe(a.showGrid);
  });
});
