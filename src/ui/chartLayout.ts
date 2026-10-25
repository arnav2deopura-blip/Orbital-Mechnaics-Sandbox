// How the diagnostic charts fill the drawer: as many columns as fit at a readable width, and the
// rows that make each plot closest to a comfortable shape. A tall drawer gets big plots in rows
// rather than the same short strip with empty space under it.

export const MIN_CELL_WIDTH = 200;
export const MIN_CELL_HEIGHT = 124;
/** Width over height that a plot reads best at. */
const TARGET_ASPECT = 2.4;

export interface ChartGrid {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

/**
 * The grid for `count` charts in a space `width` by `height` pixels. Of the arrangements whose
 * cells are at least MIN_CELL_HEIGHT tall, the one closest to the target shape; when none is, the
 * widest row there is, and the drawer scrolls.
 */
export function chartGrid(count: number, width: number, height: number): ChartGrid {
  const n = Math.max(1, count);
  const maxCols = Math.max(1, Math.min(n, Math.floor(width / MIN_CELL_WIDTH)));
  let best: ChartGrid | null = null;
  let bestScore = Infinity;
  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(n / cols);
    const cellWidth = width / cols;
    const cellHeight = height / rows;
    if (cellHeight < MIN_CELL_HEIGHT) continue;
    // A grid with empty cells in its last row is a little worse than one that is full.
    const score = Math.abs(Math.log(cellWidth / cellHeight / TARGET_ASPECT)) + 0.12 * (cols * rows - n);
    if (score < bestScore) {
      bestScore = score;
      best = { cols, rows, cellWidth, cellHeight };
    }
  }
  if (best) return best;
  return { cols: maxCols, rows: Math.ceil(n / maxCols), cellWidth: width / maxCols, cellHeight: MIN_CELL_HEIGHT };
}
