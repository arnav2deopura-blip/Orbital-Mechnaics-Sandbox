import { describe, expect, it } from 'vitest';
import { copyState, createCounters, createState, snapshot, STATE_LEN } from '../src/sim/state';

describe('createState', () => {
  it('allocates a zeroed 3-body state with G = 1 and no softening by default', () => {
    const s = createState();
    expect(s.t).toBe(0);
    expect(s.m).toHaveLength(3);
    expect(s.x).toHaveLength(STATE_LEN);
    expect(s.v).toHaveLength(STATE_LEN);
    expect([...s.m, ...s.x, ...s.v].every((c) => c === 0)).toBe(true);
    expect(s.G).toBe(1);
    expect(s.eps2).toBe(0);
  });

  it('is Float64 throughout', () => {
    const s = createState();
    expect(s.m).toBeInstanceOf(Float64Array);
    expect(s.x).toBeInstanceOf(Float64Array);
    expect(s.v).toBeInstanceOf(Float64Array);
  });
});

describe('copyState', () => {
  it('copies every field into dst in place, keeping dst buffers', () => {
    const src = createState(4 * Math.PI ** 2, 0.01);
    src.t = -2.5;
    src.m.set([1, 2, 3]);
    src.x.set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    src.v.set([9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const dst = createState();
    const { m, x, v } = dst;
    copyState(src, dst);

    expect(dst).toEqual(src);
    expect(dst.m).toBe(m);
    expect(dst.x).toBe(x);
    expect(dst.v).toBe(v);
  });

  it('does not alias src', () => {
    const src = createState();
    const dst = createState();
    copyState(src, dst);
    dst.x[0] = 99;
    expect(src.x[0]).toBe(0);
  });
});

describe('snapshot', () => {
  it('is an equal but fully independent copy', () => {
    const s = createState(2, 0.5);
    s.t = 7;
    s.m.set([1, 1, 1]);
    s.x.set([1, 0, 0, -1, 0, 0, 0, 0, 0]);
    const snap = snapshot(s);

    expect(snap).toEqual(s);
    expect(snap.x).not.toBe(s.x);

    s.x[0] = 5;
    s.t = 8;
    expect(snap.x[0]).toBe(1);
    expect(snap.t).toBe(7);
  });
});

describe('createCounters', () => {
  it('starts every cost metric at zero', () => {
    expect(createCounters()).toEqual({ stepCount: 0, forceEvals: 0, rejectedSteps: 0 });
  });
});
