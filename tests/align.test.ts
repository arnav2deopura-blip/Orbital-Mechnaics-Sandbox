import { describe, expect, it } from 'vitest';
import { alignedData, forLogAxis } from '../src/ui/align';

describe('alignedData', () => {
  it('puts series with different x on one sorted axis, with null where a series has no point', () => {
    const data = alignedData([
      { label: 'a', color: '#fff', x: [1, 3, 5], y: [10, 30, 50] },
      { label: 'b', color: '#fff', x: [2, 3, 6], y: [20, 31, 60] },
    ]);
    expect(data[0]).toEqual([1, 2, 3, 5, 6]);
    expect(data[1]).toEqual([10, null, 30, 50, null]);
    expect(data[2]).toEqual([null, 20, 31, null, 60]);
  });

  it('leaves out points that are not finite, and sorts an x that was not in order', () => {
    const data = alignedData([{ label: 'a', color: '#fff', x: [3, 1, NaN, 2], y: [30, 10, 99, Infinity] }]);
    expect(data[0]).toEqual([1, 3]);
    expect(data[1]).toEqual([10, 30]);
  });

  it('takes typed arrays, and gives just the axis for no series', () => {
    expect(alignedData([{ label: 'a', color: '#fff', x: Float64Array.of(1, 2), y: Float64Array.of(5, 6) }])[1]).toEqual([5, 6]);
    expect(alignedData([])).toEqual([[]]);
  });
});

describe('forLogAxis', () => {
  it('leaves NaN as a gap, so a run that failed or a comparison that stopped is not drawn as a perfect one', () => {
    expect(forLogAxis([1e-3, NaN, 1e-5])).toEqual([1e-3, null, 1e-5]);
  });

  it('leaves out a zero before the first positive value (the first sample is measured against itself), but not one after', () => {
    expect(forLogAxis([0, 0, 1e-12, 0, 1e-9], 1e-18)).toEqual([null, null, 1e-12, 1e-18, 1e-9]);
  });

  it('draws a series that is all zero at the floor, as there is nothing else to show', () => {
    expect(forLogAxis([0, 0, 0], 1e-18)).toEqual([1e-18, 1e-18, 1e-18]);
  });

  it('pulls a value below the floor up to it and keeps the rest', () => {
    expect(forLogAxis([1e-30, 1e-6], 1e-18)).toEqual([1e-18, 1e-6]);
  });

  it('is accepted by alignedData, which drops the gaps', () => {
    const data = alignedData([{ label: 'a', color: '#000', x: [1, 2, 3], y: forLogAxis([NaN, 1e-3, 1e-4]) as number[] }]);
    expect(data[0]).toEqual([2, 3]);
  });
});
