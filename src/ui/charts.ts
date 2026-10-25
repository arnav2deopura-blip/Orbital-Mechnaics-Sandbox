import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { SERIES } from '../sim/sampler';
import type { Sampler, SeriesKey, SeriesSpec } from '../sim/sampler';

// The diagnostic charts (plan §6): one small uPlot per series in a drawer under the view, drawn
// from a Sampler, with a toggle per chart in the drawer's header. Redrawn only when the sampler's
// version has moved.

const CHART_HEIGHT = 120;
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
  divergence: '#ffa94d',
};

/** Which charts are open at the start. The analytic error appears by itself when there is one. */
const SHOWN_AT_START: SeriesKey[] = ['energyError', 'angularMomentumError', 'minSeparation', 'dt', 'analyticError', 'divergence'];

/** Series that only exist when the data does: the comparison's divergence, and the exact-solution error. */
const NEEDS_DATA: SeriesKey[] = ['analyticError', 'divergence'];

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
  /** The twin's values at the first run's sample times. */
  y2: Float64Array;
}

export class Charts {
  readonly settings = defaultChartSettings();
  private readonly sampler: Sampler;
  private readonly caption: () => string;
  private readonly twin: () => Sampler | null;
  private readonly drawer: HTMLElement;
  private readonly dock = document.createElement('div');
  private readonly chips = new Map<SeriesKey, HTMLButtonElement>();
  private readonly cells: Cell[];
  private readonly resizeObserver: ResizeObserver;
  private drawnVersion = -1;
  private drawnTwinVersion = -1;
  private drawnLayout = '';
  private captionText = '';

  /**
   * `caption` returns the sentence for the energy chart. `twin` returns the comparison twin's
   * history, drawn dashed on the same axes, or null. The charts need not be shown (settings.visible)
   * for the sampler to keep its history.
   */
  constructor(host: HTMLElement, sampler: Sampler, caption: () => string, twin: () => Sampler | null = () => null) {
    this.sampler = sampler;
    this.caption = caption;
    this.twin = twin;
    this.drawer = host;
    host.appendChild(this.makeHeader());
    const dock = this.dock;
    dock.className = 'chart-grid';
    host.appendChild(dock);
    this.cells = SERIES.map((spec) => this.makeCell(spec));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(dock);
  }

  /** Redraws what changed. Call about ten times a second. */
  update(): void {
    const { settings, sampler } = this;
    this.drawer.hidden = !settings.visible;
    if (!settings.visible) return;
    for (const [key, chip] of this.chips) {
      const available = !NEEDS_DATA.includes(key) || sampler.has(key);
      chip.setAttribute('aria-pressed', String(settings.show[key]));
      chip.classList.toggle('unavailable', !available);
    }

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

    const twinVersion = this.twin()?.version ?? -1;
    if (!relayout && sampler.version === this.drawnVersion && twinVersion === this.drawnTwinVersion) return;
    this.drawnVersion = sampler.version;
    this.drawnTwinVersion = twinVersion;
    for (const cell of this.cells) if (this.isShown(cell)) this.draw(cell);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    for (const cell of this.cells) cell.plot.destroy();
    this.dock.remove();
  }

  /** The drawer's header: its title, a toggle per chart, a link to how to read them, and a close button. */
  private makeHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'drawer-head';
    const title = document.createElement('strong');
    title.textContent = 'Charts';
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Charts to show');
    for (const spec of SERIES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.style.setProperty('--chip-color', COLORS[spec.key]);
      chip.textContent = CHIP_LABELS[spec.key];
      chip.title = NEEDS_DATA.includes(spec.key) ? `${spec.hint} (Only has data in some runs.)` : spec.hint;
      chip.addEventListener('click', () => {
        this.settings.show[spec.key] = !this.settings.show[spec.key];
        this.update();
      });
      this.chips.set(spec.key, chip);
      chips.appendChild(chip);
    }
    const learn = document.createElement('a');
    learn.className = 'learn-link';
    learn.href = 'learn.html#conservation-laws';
    learn.target = '_blank';
    learn.rel = 'noopener';
    learn.textContent = 'How to read these →';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'icon-button';
    close.setAttribute('aria-label', 'Hide the charts');
    close.title = 'Hide the charts (C)';
    close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6l3.5 3.5L11.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    close.addEventListener('click', () => {
      this.settings.visible = false;
      this.update();
    });
    header.append(title, chips, learn, close);
    return header;
  }

  private isShown(cell: Cell): boolean {
    const key = cell.spec.key;
    return this.settings.show[key] && (!NEEDS_DATA.includes(key) || this.sampler.has(key));
  }

  private makeCell(spec: SeriesSpec): Cell {
    const root = document.createElement('div');
    root.className = 'chart-cell';
    const label = document.createElement('div');
    label.className = 'chart-label';
    label.textContent = spec.label;
    label.title = spec.hint;
    root.appendChild(label);
    const holder = document.createElement('div');
    root.appendChild(holder);
    let caption: HTMLDivElement | null = null;
    if (spec.key === 'energyError') {
      caption = document.createElement('div');
      caption.className = 'chart-caption';
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
        series: [
          {},
          { stroke: COLORS[spec.key], width: 1.5, points: { show: false } },
          { stroke: COLORS[spec.key], width: 1.2, dash: [5, 4], show: false, points: { show: false } },
        ],
        hooks: { draw: [(u) => this.drawMarkers(u)] },
      },
      [[], [], []],
      holder,
    );
    return { spec, root, caption, plot, y: new Float64Array(0), y2: new Float64Array(0) };
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
    if (cell.y.length < n) {
      cell.y = new Float64Array(sampler.x.length);
      cell.y2 = new Float64Array(sampler.x.length);
    }
    const log = cell.spec.log;
    const clamp = (v: number): number => (log ? Math.max(v, FLOOR) || FLOOR : v); // a log axis cannot take zero or NaN
    const source = sampler.values[cell.spec.key];
    for (let i = 0; i < n; i++) cell.y[i] = clamp(source[i]);

    // The twin, dashed, resampled onto the first run's times (the two do not sample at the same instants).
    const twin = cell.spec.key === 'divergence' ? null : this.twin();
    const showTwin = twin !== null && twin.length > 0;
    if (showTwin) {
      const values = twin.values[cell.spec.key];
      let j = 0;
      for (let i = 0; i < n; i++) {
        const x = sampler.x[i];
        while (j + 1 < twin.length && twin.x[j + 1] <= x) j++;
        let v: number;
        if (x <= twin.x[0] || j + 1 >= twin.length) v = values[x <= twin.x[0] ? 0 : twin.length - 1];
        else {
          const f = (x - twin.x[j]) / (twin.x[j + 1] - twin.x[j]);
          v = values[j] + f * (values[j + 1] - values[j]);
        }
        cell.y2[i] = clamp(v);
      }
    }
    cell.plot.batch(() => {
      cell.plot.setSeries(2, { show: showTwin });
      cell.plot.setData([sampler.x.subarray(0, n), cell.y.subarray(0, n), cell.y2.subarray(0, n)]);
    });
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

const CHIP_LABELS: Record<SeriesKey, string> = {
  energyError: 'Energy',
  angularMomentumError: 'Ang. momentum',
  momentumError: 'Momentum',
  comDrift: 'COM drift',
  minSeparation: 'Closest pair',
  dt: 'Step size',
  forceEvals: 'Cost',
  analyticError: 'vs exact Kepler',
  divergence: 'Divergence',
};

function formatLinear(v: number): string {
  return Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-2) ? v.toExponential(0) : String(v);
}
