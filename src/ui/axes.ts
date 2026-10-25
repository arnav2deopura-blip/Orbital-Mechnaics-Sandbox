/**
 * Where a log axis puts its lines: one per power of ten, thinned so there are never more than
 * `most` of them. uPlot's own log splits draw all nine minor lines of every decade, which on a
 * small chart is a solid hatch rather than a grid.
 */
export function decadeSplits(most = 5): (u: unknown, axisIdx: number, scaleMin: number, scaleMax: number) => number[] {
  return (_u, _axisIdx, scaleMin, scaleMax) => {
    if (!(scaleMin > 0) || !(scaleMax > scaleMin)) return [];
    const lo = Math.ceil(Math.log10(scaleMin) - 1e-9);
    const hi = Math.floor(Math.log10(scaleMax) + 1e-9);
    const step = Math.max(1, Math.ceil((hi - lo + 1) / most));
    const out: number[] = [];
    for (let e = lo; e <= hi; e += step) out.push(10 ** e);
    return out;
  };
}
