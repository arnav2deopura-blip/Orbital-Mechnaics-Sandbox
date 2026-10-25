import { describe, expect, it } from 'vitest';
import { alignedData } from '../src/ui/align';

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
