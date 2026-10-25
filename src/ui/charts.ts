import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { SERIES } from '../sim/sampler';
import type { Sampler, SeriesKey, SeriesSpec } from '../sim/sampler';

// The diagnostic charts (plan §6): one small uPlot per series in a dock along the bottom of the
// screen, drawn from a Sampler. Redrawn only when the sampler's version has moved.

const CHART_HEIGHT = 130;
/** The panel is 256 px wide, plus its margin: the dock stops short of it. */
const PANEL_WIDTH = 272;
/** A log axis cannot show zero: an error that is exactly zero is drawn here. */
const FLOOR = 1e-18;

const COLORS: Record<SeriesKey, string> = {
  energyError: '#ffd166',
  angularMomentumError: '#06d6a0',
  momentumError: '#4cc9f0',
  comDrift: '#b197fc',
  minSeparation: '#ff8787',
  dt: '#74c0fc',
  forceEvals: '#adb5bd',
  analyticError: '#f783ac',
};

/** Which charts are open at the start. The analytic error appears by itself when there is one. */
const SHOWN_AT_START: SeriesKey[] = ['energyError', 'angularMomentumError', 'minSeparation', 'dt', 'analyticError'];

export interface ChartSettings {
  visible: boolean;
  show: Record<SeriesKey, boolean>;
}

export function defaultChartSettings(): ChartSettings {
  return {
    visible: true,
    show: Object.fromEntries(SERIES.map((spec) => [spec.key, SHOWN_AT_START.includes(spec.key)])) as Record<SeriesKey, boolean>,
  };
}

/** What each integrator's energy error should look like (plan §6), for the caption under the chart. */
export function expectedEnergyBehavior(id: string, symplectic: boolean): string {
  switch (id) {
    case 'leapfrog':
    case 'wh':
      return 'Expect a bounded oscillation: a symplectic method keeps the energy error from growing.';
    case 'rk4':
      return 'Expect steady drift, roughly linear in time: RK4 is accurate per step but not symplectic.';
    case 'euler':
      return symplectic
        ? 'Expect a bounded oscillation: reordering one line made Euler symplectic.'
        : 'Expect rapid growth: explicit Euler gains energy every step, and the orbit spirals outward.';
    case 'ias15':
      return 'Expect tiny, slowly growing error (like the square root of time) from roundoff, unless an encounter is unresolved.';
    default:
      return '';
  }
}

export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

interface Cell {
  spec: SeriesSpec;
  root: HTMLDivElement;
  caption: HTMLDivElement | null;
  plot: uPlot;
  /** y values for the plot: clamped copies, since a log axis cannot take zero. */
  y: Float64Array;
}

export class Charts {
  readonly settings = defaultChartSettings();
  private readonly sampler: Sampler;
  private readonly caption: () => string;
  private readonly dock = document.createElement('div');
  private readonly cells: Cell[];
  private readonly resizeObserver: ResizeObserver;
  private drawnVersion = -1;
  private drawnLayout = '';
  private captionText = '';

  /**
   * `caption` returns the sentence for the energy chart. The charts need not be shown (settings.visible)
   * for the sampler to keep its history.
   */
  constructor(host: HTMLElement, sampler: Sampler, caption: () => string) {
    this.sampler = sampler;
    this.caption = caption;
    const dock = this.dock;
    dock.style.cssText =
      `position:absolute;left:0;bottom:0;right:${PANEL_WIDTH}px;max-height:45vh;overflow-y:auto;box-sizing:border-box;` +
      'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:2px 6px;padding:4px 6px 2px;' +
      'background:rgba(6,8,13,0.86);border-top:1px solid #1d2433;font:11px/1.3 ui-monospace,monospace;color:#8b95a8';
    host.appendChild(dock);
    this.cells = SERIES.map((spec) => this.makeCell(spec));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(dock);
  }

  /** Redraws what changed. Call about ten times a second. */
  update(): void {
    const { settings, sampler, dock } = this;
    dock.style.display = settings.visible ? 'grid' : 'none';
    if (!settings.visible) return;

    // Which charts are open: a change of layout needs a resize and a redraw.
    const layout = this.cells.map((cell) => (this.isShown(cell) ? '1' : '0')).join('');
    const relayout = layout !== this.drawnLayout;
    if (relayout) {
      this.drawnLayout = layout;
      this.cells.forEach((cell) => (cell.root.style.display = this.isShown(cell) ? 'block' : 'none'));
      this.resize();
    }

    const text = this.caption();
    if (text !== this.captionText) {
      this.captionText = text;
      for (const cell of this.cells) if (cell.caption) cell.caption.textContent = text;
    }

    if (!relayout && sampler.version === this.drawnVersion) return;
    this.drawnVersion = sampler.version;
    for (const cell of this.cells) if (this.isShown(cell)) this.draw(cell);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    for (const cell of this.cells) cell.plot.destroy();
    this.dock.remove();
  }

  private isShown(cell: Cell): boolean {
    const key = cell.spec.key;
    return this.settings.show[key] && (key !== 'analyticError' || this.sampler.has(key));
  }

  private makeCell(spec: SeriesSpec): Cell {
    const root = document.createElement('div');
    root.style.cssText = 'min-width:0';
    const label = document.createElement('div');
    label.textContent = spec.label;
    label.title = spec.hint;
    label.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help';
    root.appendChild(label);
    const holder = document.createElement('div');
    root.appendChild(holder);
    let caption: HTMLDivElement | null = null;
    if (spec.key === 'energyError') {
      caption = document.createElement('div');
      caption.style.cssText = 'color:#6c7a93;font-size:10px;min-height:2.6em';
      root.appendChild(caption);
    }
    this.dock.appendChild(root);

    const axis = {
      stroke: '#6c7a93',
      grid: { stroke: '#1d2433', width: 1 },
      ticks: { stroke: '#2b3a55', width: 1 },
      font: '10px ui-monospace, monospace',
    };
    const plot = new uPlot(
      {
        width: 260,
        height: CHART_HEIGHT,
        legend: { show: false },
        cursor: { show: false },
        padding: [6, 8, 0, 0],
        scales: { x: { time: false }, y: spec.log ? { distr: 3, log: 10 } : { distr: 1 } },
        axes: [
          { ...axis, size: 22 },
          {
            ...axis,
            size: 54,
            // uPlot passes null for ticks it has thinned out.
            values: (_u, ticks) => ticks.map((v) => (v == null ? '' : spec.log ? v.toExponential(0) : formatLinear(v))),
          },
        ],
        series: [{}, { stroke: COLORS[spec.key], width: 1.5, points: { show: false } }],
        hooks: { draw: [(u) => this.drawMarkers(u)] },
      },
      [[], []],
      holder,
    );
    return { spec, root, caption, plot, y: new Float64Array(0) };
  }

  private resize(): void {
    const width = Math.max(120, Math.floor(this.dock.firstElementChild?.clientWidth ?? 260));
    for (const cell of this.cells) {
      if (cell.root.style.display !== 'none') cell.plot.setSize({ width: cell.root.clientWidth || width, height: CHART_HEIGHT });
    }
  }

  private draw(cell: Cell): void {
    const { sampler } = this;
    const n = sampler.length;
    if (cell.y.length < n) cell.y = new Float64Array(sampler.x.length);
    const source = sampler.values[cell.spec.key];
    const y = cell.y;
    if (cell.spec.log) {
      for (let i = 0; i < n; i++) y[i] = Math.max(source[i], FLOOR) || FLOOR; // NaN becomes the floor
    } else {
      for (let i = 0; i < n; i++) y[i] = source[i];
    }
    cell.plot.setData([sampler.x.subarray(0, n), y.subarray(0, n)]);
  }

  /** Dashed vertical lines where something happened: an integrator switch, a reversal, an encounter. */
  private drawMarkers(u: uPlot): void {
    const markers = this.sampler.markers;
    if (markers.length === 0) return;
    const { ctx } = u;
    const { left, top, width, height } = u.bbox;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([4, 4]);
    ctx.font = `${10 * devicePixelRatio}px ui-monospace, monospace`;
    for (const marker of markers) {
      const x = u.valToPos(marker.x, 'x', true);
      if (x < left || x > left + width) continue;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
      ctx.save();
      ctx.translate(x + 3 * devicePixelRatio, top + 4 * devicePixelRatio);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(marker.label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

function formatLinear(v: number): string {
  return Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-2) ? v.toExponential(0) : String(v);
}
