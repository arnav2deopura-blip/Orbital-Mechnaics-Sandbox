// Plot data helpers that need no chart library.

export interface PlotSeries {
  label: string;
  color: string;
  x: ArrayLike<number>;
  /** null is a gap, as is any value that is not finite. */
  y: ArrayLike<number | null>;
}

/**
 * Puts series with different x values onto one shared x axis, which is what uPlot takes: the
 * sorted union of every x, and for each series its y where it has one and null elsewhere.
 * Points with a non-finite x or y are left out.
 */
export function alignedData(series: PlotSeries[]): (number[] | (number | null)[])[] {
  const maps = series.map((s) => {
    const m = new Map<number, number>();
    for (let i = 0; i < s.x.length; i++) {
      const y = s.y[i];
      if (Number.isFinite(s.x[i]) && y !== null && Number.isFinite(y)) m.set(s.x[i], y);
    }
    return m;
  });
  const xs = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  return [xs, ...maps.map((m) => xs.map((x) => m.get(x) ?? null))];
}

/**
 * Values for a log axis, which has no zero and no NaN. NaN means there is no data (a run that
 * failed, a comparison that was stopped) and is left as a gap (null), not drawn as a perfect run;
 * a zero before the first positive value (the first sample, measured against itself) is a gap too, or
 * the axis would stretch ten decades for one point; any other zero is drawn at `floor`, and so is
 * a series that is zero all the way through.
 */
export function forLogAxis(values: ArrayLike<number>, floor = 1e-18): (number | null)[] {
  let lead = 0;
  while (lead < values.length && !(values[lead] > 0)) lead++;
  const out: (number | null)[] = new Array<number | null>(values.length);
  const anyPositive = lead < values.length;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) out[i] = null;
    else if (anyPositive && i < lead && v <= 0) out[i] = null;
    else out[i] = Math.max(v, floor);
  }
  return out;
}
