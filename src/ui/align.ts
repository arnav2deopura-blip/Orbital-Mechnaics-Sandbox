// Plot data helpers that need no chart library.

export interface PlotSeries {
  label: string;
  color: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
}

/**
 * Puts series with different x values onto one shared x axis, which is what uPlot takes: the
 * sorted union of every x, and for each series its y where it has one and null elsewhere.
 * Points with a non-finite x or y are left out.
 */
export function alignedData(series: PlotSeries[]): (number[] | (number | null)[])[] {
  const maps = series.map((s) => {
    const m = new Map<number, number>();
    for (let i = 0; i < s.x.length; i++) if (Number.isFinite(s.x[i]) && Number.isFinite(s.y[i])) m.set(s.x[i], s.y[i]);
    return m;
  });
  const xs = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  return [xs, ...maps.map((m) => xs.map((x) => m.get(x) ?? null))];
}
