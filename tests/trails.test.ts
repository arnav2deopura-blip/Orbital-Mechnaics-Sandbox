import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Trail } from '../src/render/trails';

const positionAttribute = (trail: Trail): THREE.BufferAttribute =>
  trail.line.geometry.attributes.position as THREE.BufferAttribute;

/** The world positions of the vertices the line would draw, oldest first (anchor + vertex, in Float64). */
function drawn(trail: Trail): number[][] {
  const { start, count } = trail.line.geometry.drawRange;
  const array = positionAttribute(trail).array as Float32Array;
  const out: number[][] = [];
  for (let i = start; i < start + count; i++) {
    out.push([0, 1, 2].map((c) => array[3 * i + c] + trail.anchor[c]));
  }
  return out;
}

/** Sample k: exactly representable in Float32 relative to sample 0, so comparisons can be exact. */
const sample = (k: number): [number, number, number] => [k * 0.25, k * 0.5, (0 - k) * 0.125]; // (0 - k), so sample 0 has +0, not -0

/** Pushes samples a..b-1. */
function pushRange(trail: Trail, a: number, b: number): void {
  for (let k = a; k < b; k++) trail.push(...sample(k));
}

/** What the renderer does after an upload: the ranges are consumed. */
const afterUpload = (trail: Trail): void => positionAttribute(trail).clearUpdateRanges();

const ranges = (trail: Trail): { start: number; count: number }[] =>
  positionAttribute(trail).updateRanges.map((r) => ({ start: r.start, count: r.count }));

/** A trail that has been flushed once, so its initial full upload is out of the way. */
function settled(capacity: number): Trail {
  const trail = new Trail(capacity, '#fff');
  trail.flush();
  afterUpload(trail);
  return trail;
}

describe('Trail: the double-write window', () => {
  it('draws everything stored, oldest first, until the ring fills', () => {
    const trail = settled(8);
    pushRange(trail, 0, 5);
    trail.flush();
    expect(trail.line.geometry.drawRange).toEqual({ start: 0, count: 5 });
    expect(drawn(trail)).toEqual([0, 1, 2, 3, 4].map((k) => sample(k)));
  });

  it('draws the newest N as one contiguous run after the ring wraps, however far past full', () => {
    for (const total of [8, 9, 11, 16, 20, 51]) {
      const trail = settled(8);
      pushRange(trail, 0, total);
      trail.flush();
      const expected = Array.from({ length: 8 }, (_, i) => sample(total - 8 + i));
      expect(trail.line.geometry.drawRange).toEqual({ start: total % 8, count: 8 });
      expect(drawn(trail)).toEqual(expected);
    }
  });

  it('keeps the two copies of every slot identical', () => {
    const trail = settled(8);
    pushRange(trail, 0, 21);
    const p = positionAttribute(trail).array as Float32Array;
    for (let slot = 0; slot < 8; slot++) {
      for (let c = 0; c < 3; c++) expect(p[3 * slot + c]).toBe(p[3 * (slot + 8) + c]);
    }
  });

  it('draws the live tip after the newest sample, without disturbing the stored ones', () => {
    for (const total of [3, 8, 13]) {
      const trail = settled(8);
      pushRange(trail, 0, total);
      trail.setTip(100, 200, 300);
      trail.flush();
      const stored = Math.min(total, 8);
      const window = drawn(trail);
      expect(window).toHaveLength(stored + 1);
      expect(window.slice(0, stored)).toEqual(Array.from({ length: stored }, (_, i) => sample(total - stored + i)));
      expect(window[stored]).toEqual([100, 200, 300]);
    }
  });

  it('lets the next sample take the tip slot, and needs the tip set again each frame', () => {
    const trail = settled(8);
    pushRange(trail, 0, 8);
    trail.setTip(100, 200, 300);
    trail.flush();
    trail.push(...sample(8));
    trail.flush(); // no tip this time
    expect(drawn(trail)).toEqual(Array.from({ length: 8 }, (_, i) => sample(1 + i)));
    expect(drawn(trail).some((p) => p[0] === 100)).toBe(false);
  });

  it('hands the fade shader exactly the window it draws, so vertex age is right', () => {
    // The shader's age is (uStart + uCount - 1 - gl_VertexID) / (uCount - 1): newest 0, oldest 1.
    for (const total of [3, 8, 13, 30]) {
      const trail = settled(8);
      pushRange(trail, 0, total);
      trail.setTip(1, 2, 3);
      trail.flush();
      const uniforms = (trail.line.material as THREE.ShaderMaterial).uniforms;
      const { start, count } = trail.line.geometry.drawRange;
      expect(uniforms.uStart.value).toBe(start);
      expect(uniforms.uCount.value).toBe(count);
      expect(count).toBe(Math.min(total, 8) + 1);
    }
  });

  it('draws nothing for fewer than two vertices, with or without a tip', () => {
    const trail = settled(8);
    trail.flush();
    expect(trail.line.geometry.drawRange.count).toBe(0);
    trail.setTip(1, 2, 3);
    trail.flush(); // no stored sample to attach it to
    expect(trail.line.geometry.drawRange.count).toBe(0);
    trail.push(...sample(0));
    trail.flush();
    expect(trail.line.geometry.drawRange.count).toBe(0); // one vertex is no line
  });
});

describe('Trail: partial uploads', () => {
  it('uploads only the two copies of what was written, as float spans, and flags the buffer for upload', () => {
    const trail = settled(8);
    const version = positionAttribute(trail).version;
    pushRange(trail, 0, 3);
    trail.flush();
    expect(ranges(trail)).toEqual([
      { start: 0, count: 9 }, // slots 0..2, three floats each
      { start: 24, count: 9 }, // slots 8..10
    ]);
    // Without the bump the renderer never looks at the ranges and the GPU copy goes stale.
    expect(positionAttribute(trail).version).toBe(version + 1);
  });

  it('splits a write that wraps the end of the ring into four spans', () => {
    const trail = settled(8);
    pushRange(trail, 0, 6);
    trail.flush();
    afterUpload(trail);
    pushRange(trail, 6, 10); // slots 6, 7, then 0, 1
    trail.flush();
    expect(ranges(trail).sort((a, b) => a.start - b.start)).toEqual([
      { start: 0, count: 6 }, // slots 0..1
      { start: 18, count: 6 }, // slots 6..7
      { start: 24, count: 6 }, // slots 8..9
      { start: 42, count: 6 }, // slots 14..15
    ]);
  });

  it('adds one span for the live tip, in the slot past the run', () => {
    const trail = settled(8);
    pushRange(trail, 0, 3);
    trail.flush();
    afterUpload(trail);
    trail.setTip(1, 2, 3); // not full: the slot is head = 3
    trail.flush();
    expect(ranges(trail)).toEqual([{ start: 9, count: 3 }]);

    pushRange(trail, 3, 8); // fill it, then set the tip: the slot is head + N
    trail.flush();
    afterUpload(trail);
    trail.setTip(1, 2, 3);
    trail.flush();
    expect(ranges(trail)).toEqual([{ start: 3 * (0 + 8), count: 3 }]); // head is back at 0
  });

  it('falls back to one full upload when at least a whole ring was written at once', () => {
    const trail = settled(8);
    const before = positionAttribute(trail).version;
    pushRange(trail, 0, 30);
    trail.flush();
    expect(ranges(trail)).toEqual([]); // no ranges means the whole buffer
    expect(positionAttribute(trail).version).toBe(before + 1);
  });

  it('uploads nothing when nothing changed', () => {
    const trail = settled(8);
    pushRange(trail, 0, 4);
    trail.flush();
    afterUpload(trail);
    const version = positionAttribute(trail).version;
    trail.flush();
    expect(ranges(trail)).toEqual([]);
    expect(positionAttribute(trail).version).toBe(version);
  });

  it('allocates nothing per frame: the buffers and the span records are reused', () => {
    const trail = settled(8);
    const array = positionAttribute(trail).array;
    const attribute = positionAttribute(trail);
    const seen = new Set<object>();
    for (let frame = 0; frame < 50; frame++) {
      pushRange(trail, frame * 3, frame * 3 + 3);
      trail.setTip(0, 0, 0);
      trail.flush();
      for (const r of attribute.updateRanges) seen.add(r);
      afterUpload(trail);
    }
    expect(positionAttribute(trail).array).toBe(array);
    expect(positionAttribute(trail)).toBe(attribute);
    expect(seen.size).toBeLessThanOrEqual(5); // five preallocated records, however many frames
  });
});

describe('Trail: sampling and the floating origin', () => {
  it('skips samples closer than minStep to the last stored one', () => {
    const trail = settled(8);
    trail.minStep = 1;
    expect(trail.push(0, 0, 0)).toBe(true);
    expect(trail.push(0.5, 0, 0)).toBe(false);
    expect(trail.push(0.9, 0, 0)).toBe(false);
    expect(trail.push(1.2, 0, 0)).toBe(true); // measured from the last STORED sample, at 0
    expect(trail.push(1.8, 0, 0)).toBe(false);
    expect(trail.length).toBe(2);
  });

  it('stores a sample that is exactly minStep from the last one', () => {
    const trail = settled(8);
    trail.minStep = 1;
    expect(trail.push(0, 0, 0)).toBe(true);
    expect(trail.push(1, 0, 0)).toBe(true);
    expect(trail.push(1.999, 0, 0)).toBe(false);
  });

  it('anchors at the first sample, and again after clear()', () => {
    const trail = settled(8);
    trail.push(5, 6, 7);
    expect(Array.from(trail.anchor)).toEqual([5, 6, 7]);
    trail.clear();
    expect(trail.length).toBe(0);
    trail.push(-1, -2, -3);
    expect(Array.from(trail.anchor)).toEqual([-1, -2, -3]);
  });

  it('stores vertices exactly 1e9 from the origin, where a plain Float32 pipeline cannot tell 40 points apart', () => {
    const base = 1e9;
    const trail = settled(64);
    const samples = Array.from({ length: 40 }, (_, k) => base + k / 8);
    for (const x of samples) trail.push(x, base, base);
    trail.flush();
    const worldX = drawn(trail).map((p) => p[0]);
    expect(worldX).toEqual(samples); // exact: the subtraction happened in Float64
    // Float32 is spaced 64 apart at 1e9, so storing the world position itself collapses the
    // whole 5-unit-long trail onto a single value.
    expect(new Set(samples.map(Math.fround)).size).toBe(1);
    expect(new Set(worldX).size).toBe(40);
  });

  it('places the line at anchor - origin, subtracted in Float64', () => {
    const trail = settled(8);
    trail.push(1e9 + 0.25, 1e9 + 0.5, 1e9 + 0.75);
    trail.place(1e9, 1e9, 1e9);
    expect(trail.line.position.toArray()).toEqual([0.25, 0.5, 0.75]);
  });

  it('re-anchors when the focus is further from the anchor than allowed, keeping every point in place', () => {
    const trail = settled(16);
    pushRange(trail, 0, 12);
    expect(trail.rebaseIfFar(0, 0, 0, 100)).toBe(false); // sample 0 is the anchor: 0 away
    expect(trail.rebaseIfFar(10, 0, 0, 100)).toBe(false); // inside the limit
    trail.flush();
    afterUpload(trail);
    const before = (trail.setTip(0, 0, 0), trail.flush(), drawn(trail));
    afterUpload(trail);

    expect(trail.rebaseIfFar(1000, 0, 0, 100)).toBe(true);
    expect(Array.from(trail.anchor)).toEqual([1000, 0, 0]);
    trail.setTip(0, 0, 0);
    trail.flush();
    const after = drawn(trail);
    for (let i = 0; i < before.length; i++) {
      for (let c = 0; c < 3; c++) expect(Math.abs(after[i][c] - before[i][c])).toBeLessThan(1e-4); // Float32 at ~1000
    }
    expect(ranges(trail)).toEqual([]); // the whole buffer is re-uploaded
  });

  it('does not re-anchor an empty trail', () => {
    const trail = settled(8);
    expect(trail.rebaseIfFar(1e9, 0, 0, 1)).toBe(false);
  });
});

describe('Trail: resize and clear', () => {
  const run = (capacity: number, total: number): Trail => {
    const trail = settled(capacity);
    pushRange(trail, 0, total);
    return trail;
  };

  it.each([
    [8, 20, 4],
    [8, 20, 16],
    [8, 3, 5],
    [8, 3, 2],
    [8, 8, 8],
    [4, 11, 7],
  ])('keeps the newest samples that fit: capacity %i with %i pushed, resized to %i', (capacity, total, next) => {
    const trail = run(capacity, total);
    const held = Math.min(total, capacity);
    trail.resize(next);
    trail.flush();
    const kept = Math.min(held, next);
    expect(trail.length).toBe(kept);
    expect(trail.size).toBe(next);
    expect(drawn(trail)).toEqual(Array.from({ length: kept }, (_, i) => sample(total - kept + i)));
  });

  it('keeps working after a resize: new samples slot in and old ones fall off in order', () => {
    const trail = run(8, 20);
    trail.resize(5);
    pushRange(trail, 20, 27);
    trail.flush();
    expect(drawn(trail)).toEqual([22, 23, 24, 25, 26].map((k) => sample(k)));
  });

  it('releases the old geometry', () => {
    const trail = run(8, 4);
    let disposed = false;
    trail.line.geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    trail.resize(16);
    expect(disposed).toBe(true);
  });

  it('is a no-op for the same size, and never smaller than two samples', () => {
    const trail = run(8, 4);
    const geometry = trail.line.geometry;
    trail.resize(8);
    expect(trail.line.geometry).toBe(geometry);
    expect(new Trail(1, '#fff').size).toBe(2);
  });

  it('draws nothing after clear() until it has samples again', () => {
    const trail = run(8, 12);
    trail.clear();
    trail.setTip(1, 2, 3);
    trail.flush();
    expect(trail.line.geometry.drawRange.count).toBe(0);
    pushRange(trail, 100, 103);
    trail.flush();
    expect(drawn(trail)).toEqual([100, 101, 102].map((k) => sample(k)));
  });
});
