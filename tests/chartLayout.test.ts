import { describe, expect, it } from 'vitest';
import { clampDrawer, currentArrangement, DRAWER_MAX, DRAWER_MIN } from '../src/ui/arrangement';
import { chartGrid, MIN_CELL_HEIGHT, MIN_CELL_WIDTH } from '../src/ui/chartLayout';

describe('chartGrid', () => {
  it('keeps one row in a short drawer', () => {
    const grid = chartGrid(4, 1220, 200);
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(4);
  });

  it('wraps into rows when the drawer is tall', () => {
    const grid = chartGrid(4, 1220, 560);
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);
    expect(grid.cellHeight).toBeCloseTo(280);
  });

  it('never makes a cell narrower or shorter than the least readable', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 9]) {
      for (const [w, h] of [[700, 150], [1000, 260], [1500, 400], [1900, 700]]) {
        const grid = chartGrid(n, w, h);
        expect(grid.cols * grid.rows).toBeGreaterThanOrEqual(n);
        expect(grid.cellWidth).toBeGreaterThanOrEqual(MIN_CELL_WIDTH - 1e-9);
        expect(grid.cellHeight).toBeGreaterThanOrEqual(MIN_CELL_HEIGHT - 1e-9);
      }
    }
  });

  it('falls back to the widest row, scrolling, when nothing fits', () => {
    const grid = chartGrid(9, 1000, 100);
    expect(grid.cols).toBe(5);
    expect(grid.cellHeight).toBe(MIN_CELL_HEIGHT);
  });

  it('handles an empty set', () => {
    expect(chartGrid(0, 800, 300).cols).toBe(1);
  });
});

describe('arrangements', () => {
  it('names the four arrangements from the state', () => {
    expect(currentArrangement(true, true, 0.36)).toBe('instrument');
    expect(currentArrangement(false, true, 0.36)).toBe('orbits-charts');
    expect(currentArrangement(false, false, 0.36)).toBe('orbits');
    expect(currentArrangement(false, true, 0.78)).toBe('charts');
  });

  it('names nothing for a mix', () => {
    expect(currentArrangement(true, false, 0.36)).toBeNull();
    expect(currentArrangement(true, true, 0.78)).toBeNull();
  });

  it('clamps the drawer', () => {
    expect(clampDrawer(0)).toBe(DRAWER_MIN);
    expect(clampDrawer(5)).toBe(DRAWER_MAX);
    expect(clampDrawer(Number.NaN)).toBeGreaterThan(DRAWER_MIN);
  });
});
