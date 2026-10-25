import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { SERIES } from '../sim/sampler';
import type { Sampler, SeriesKey, SeriesSpec } from '../sim/sampler';
import { learnHref } from '../app/router';
import { clampDrawer, DRAWER_DEFAULT, DRAWER_LARGE, DRAWER_MAX, DRAWER_MIN } from './arrangement';
import { decadeSplits } from './axes';
import { chartGrid } from './chartLayout';
import { ACCENT, INK, INK_2, INK_3, RULE, RULE_STRONG } from './palette';

// The diagnostic charts (plan §6): one uPlot per series in a drawer under the view, drawn from a
// Sampler, with a toggle per chart in the drawer's header. Redrawn only when the sampler's version
// has moved. The drawer's height is the user's (a handle on its top edge, a slider in its header),
// and the plots fill it: a short drawer is one row, a tall one wraps into rows of larger plots.
// Hovering any plot puts a vertical line at the same time in every plot, with the values read out.

/** Moving the pointer over one plot moves the line in all of them. */
const CURSOR_SYNC = 'diagnostics';
/** Arrow keys on the drawer's handle move it by this share of the stage. */
const HANDLE_STEP = 0.02;
/** A log axis cannot show zero: an error that is exactly zero is drawn here. */
const FLOOR = 1e-18;

/** Which charts are open at the start. The analytic error appears by itself when there is one. */
const SHOWN_AT_START: SeriesKey[] = ['energyError', 'angularMomentumError', 'minSeparation', 'dt', 'analyticError', 'divergence'];

/** Series that only exist when the data does: the comparison's divergence, and the exact-solution error. */
const NEEDS_DATA: SeriesKey[] = ['analyticError', 'divergence'];

export interface ChartSettings {
  visible: boolean;
  /** The drawer's share of the stage's height. */
  size: number;
  show: Record<SeriesKey, boolean>;
}

export function defaultChartSettings(): ChartSettings {
  return {
    visible: true,
    size: DRAWER_DEFAULT,
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
  label: HTMLSpanElement;
  readout: HTMLSpanElement;
  holder: HTMLDivElement;
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
  private readonly note = document.createElement('div');
  private readonly noteText = document.createElement('span');
  private readonly slider = document.createElement('input');
  private readonly expand = document.createElement('button');
  private readonly handle = document.createElement('div');
  private readonly cells: Cell[];
  private readonly resizeObserver: ResizeObserver;
  private drawnVersion = -1;
  private drawnTwinVersion = -1;
  private drawnLayout = '';
  private captionText = '';
  /** The height the drawer had before "expand", so the same button can give it back. */
  private sizeBeforeExpand: number | null = null;

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
    this.makeHandle();
    host.append(this.handle, this.makeHeader());
    const dock = this.dock;
    dock.className = 'chart-grid';
    host.appendChild(dock);
    host.appendChild(this.makeNote());
    this.cells = SERIES.map((spec) => this.makeCell(spec));
    this.applySize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(dock);
  }

  /** Words for a system of two bodies or three: with two there is one distance, and the exact orbit is always there. */
  setBodyCount(n: number): void {
    const pair = n === 2;
    const names: Partial<Record<SeriesKey, [string, string]>> = {
      minSeparation: pair ? ['Separation', 'Distance between the two bodies'] : [CHIP_LABELS.minSeparation, SERIES_BY_KEY.minSeparation.label],
    };
    for (const [key, [chip, label]] of Object.entries(names) as [SeriesKey, [string, string]][]) {
      const button = this.chips.get(key);
      if (button) button.textContent = chip;
      for (const cell of this.cells) if (cell.spec.key === key) cell.label.textContent = label;
    }
    const hint = pair ? 'The pair has a closed-form orbit, so this is measured against it exactly.' : SERIES_BY_KEY.analyticError.hint + ' (Only has data in some runs.)';
    this.chips.get('analyticError')?.setAttribute('title', hint);
    for (const cell of this.cells) if (cell.spec.key === 'analyticError') cell.label.title = hint;
  }

  /** Sets how much of the stage the drawer takes, and keeps the plots filling it. */
  setSize(size: number): void {
    const clamped = clampDrawer(size);
    if (clamped === this.settings.size) return;
    this.settings.size = clamped;
    this.applySize();
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
      this.cells.forEach((cell) => (cell.root.style.display = this.isShown(cell) ? '' : 'none'));
      this.resize();
    }

    // The note under the plots speaks of the energy chart: only while that one is open.
    const energyShown = this.settings.show.energyError;
    const text = energyShown ? `Energy error: ${this.caption()}` : '';
    if (text !== this.captionText) {
      this.captionText = text;
      this.noteText.textContent = text;
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

  /** The drawer's top edge, a handle to drag: the same kind of rule as the side panel's. */
  private makeHandle(): void {
    const handle = this.handle;
    handle.className = 'drawer-resizer';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', 'Resize the charts');
    handle.setAttribute('aria-valuemin', String(Math.round(DRAWER_MIN * 100)));
    handle.setAttribute('aria-valuemax', String(Math.round(DRAWER_MAX * 100)));
    handle.title = 'Drag to resize the charts (double-click to reset)';
    handle.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      handle.setPointerCapture(down.pointerId);
      handle.classList.add('dragging');
      const stage = this.drawer.parentElement;
      const move = (event: PointerEvent): void => {
        const rect = stage?.getBoundingClientRect();
        if (rect && rect.height > 0) this.setSize((rect.bottom - event.clientY) / rect.height);
      };
      const up = (): void => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => this.setSize(DRAWER_DEFAULT));
    handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      this.setSize(this.settings.size + (event.key === 'ArrowUp' ? HANDLE_STEP : -HANDLE_STEP));
    });
  }

  /** The drawer's header: its title, a toggle per chart, the height, and a close button. */
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
      chip.textContent = CHIP_LABELS[spec.key];
      chip.title = NEEDS_DATA.includes(spec.key) ? `${spec.hint} (Only has data in some runs.)` : spec.hint;
      chip.addEventListener('click', () => {
        this.settings.show[spec.key] = !this.settings.show[spec.key];
        this.update();
      });
      this.chips.set(spec.key, chip);
      chips.appendChild(chip);
    }

    const size = document.createElement('label');
    size.className = 'drawer-size';
    const caption = document.createElement('span');
    caption.className = 'bar-caption';
    caption.textContent = 'Height';
    const slider = this.slider;
    slider.type = 'range';
    slider.className = 'bar-range';
    slider.min = String(DRAWER_MIN);
    slider.max = String(DRAWER_MAX);
    slider.step = '0.01';
    slider.setAttribute('aria-label', 'Height of the charts, as a share of the view');
    slider.addEventListener('input', () => this.setSize(Number(slider.value)));
    size.append(caption, slider);

    const expand = this.expand;
    expand.type = 'button';
    expand.className = 'icon-button';
    expand.addEventListener('click', () => {
      if (this.settings.size >= DRAWER_LARGE) {
        this.setSize(this.sizeBeforeExpand ?? DRAWER_DEFAULT);
        this.sizeBeforeExpand = null;
      } else {
        this.sizeBeforeExpand = this.settings.size;
        this.setSize(0.78);
      }
    });

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
    header.append(title, chips, size, expand, close);
    return header;
  }

  /** Under the plots: what to expect of the energy error, and the way to the explanation. */
  private makeNote(): HTMLElement {
    const note = this.note;
    note.className = 'chart-note';
    this.noteText.className = 'chart-note-text';
    const learn = document.createElement('a');
    learn.className = 'learn-link';
    learn.href = learnHref('conservation-laws');
    learn.textContent = 'How to read these →';
    note.append(this.noteText, learn);
    return note;
  }

  /** The drawer's height, in the page and in the controls that show it. */
  private applySize(): void {
    const { size } = this.settings;
    this.drawer.style.setProperty('--drawer-size', String(size));
    this.slider.value = String(size);
    this.handle.setAttribute('aria-valuenow', String(Math.round(size * 100)));
    const expanded = size >= DRAWER_LARGE;
    this.expand.setAttribute('aria-label', expanded ? 'Make the charts shorter' : 'Make the charts taller');
    this.expand.title = expanded ? 'Back to the height before (the drawer was made tall)' : 'Make the charts tall: a larger plot for each';
    this.expand.innerHTML = expanded
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5h10M5.5 13l2.5-2.5L10.5 13M3 5.5h10M5.5 3L8 5.5 10.5 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M5.5 5.5L8 3l2.5 2.5M5.5 10.5L8 13l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  private isShown(cell: Cell): boolean {
    const key = cell.spec.key;
    return this.settings.show[key] && (!NEEDS_DATA.includes(key) || this.sampler.has(key));
  }

  private makeCell(spec: SeriesSpec): Cell {
    const root = document.createElement('div');
    root.className = 'chart-cell';
    const head = document.createElement('div');
    head.className = 'chart-head';
    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = spec.label;
    label.title = spec.hint;
    // Where the pointer is: the time, and this chart's value then.
    const readout = document.createElement('span');
    readout.className = 'chart-readout';
    head.append(label, readout);
    root.appendChild(head);
    const holder = document.createElement('div');
    holder.className = 'chart-plot';
    root.appendChild(holder);
    this.dock.appendChild(root);

    const axis = {
      stroke: INK_3,
      grid: { stroke: RULE, width: 1 },
      ticks: { stroke: RULE_STRONG, width: 1 },
      font: '11px "Archivo Variable", system-ui, sans-serif',
    };
    const plot = new uPlot(
      {
        width: 260,
        height: 120,
        legend: { show: false },
        // A vertical line only, moving in every plot at once; no selection, no points.
        cursor: { x: true, y: false, drag: { x: false, y: false, setScale: false }, points: { show: false }, sync: { key: CURSOR_SYNC, scales: ['x', null] } },
        padding: [6, 8, 0, 0],
        scales: { x: { time: false }, y: spec.log ? { distr: 3, log: 10 } : { distr: 1 } },
        axes: [
          { ...axis, size: 24 },
          {
            ...axis,
            size: 56,
            ...(spec.log && { splits: decadeSplits(4) }),
            // uPlot passes null for ticks it has thinned out.
            values: (_u, ticks) => ticks.map((v) => (v == null ? '' : spec.log ? v.toExponential(0) : formatLinear(v))),
          },
        ],
        series: [
          {},
          { stroke: INK, width: 1.4, points: { show: false } },
          { stroke: INK_2, width: 1.2, dash: [5, 4], show: false, points: { show: false } },
        ],
        hooks: { draw: [(u) => this.drawMarkers(u)], setCursor: [(u) => this.showReadout(u, spec, readout)] },
      },
      [[], [], []],
      holder,
    );
    return { spec, root, label, readout, holder, plot, y: new Float64Array(0), y2: new Float64Array(0) };
  }

  /** "t 3.21 · 1.2e-6" while the pointer is over a plot, nothing otherwise. */
  private showReadout(u: uPlot, spec: SeriesSpec, readout: HTMLElement): void {
    const i = u.cursor.idx;
    const x = i == null ? undefined : u.data[0][i];
    const y = i == null ? undefined : u.data[1][i];
    if (x == null || y == null) {
      readout.textContent = '';
      return;
    }
    readout.textContent = `t ${+x.toPrecision(4)} · ${spec.log ? (y <= FLOOR ? '0' : y.toExponential(2)) : +y.toPrecision(4)}`;
  }

  /** Lays the plots out in the drawer: columns and rows from its size, each plot as tall as its row allows. */
  private resize(): void {
    const { dock } = this;
    const width = dock.clientWidth;
    const height = dock.clientHeight;
    if (width === 0 || height === 0) return;
    const shown = this.cells.filter((cell) => this.isShown(cell));
    if (shown.length === 0) return;
    const grid = chartGrid(shown.length, width, height);
    dock.style.gridTemplateColumns = `repeat(${grid.cols}, minmax(0, 1fr))`;
    dock.style.gridAutoRows = `${Math.floor(grid.cellHeight)}px`;
    for (const [at, cell] of shown.entries()) {
      cell.root.classList.toggle('row-start', at % grid.cols === 0);
      cell.root.classList.toggle('row-later', at >= grid.cols);
    }
    for (const cell of shown) {
      const w = Math.max(120, cell.holder.clientWidth);
      const h = Math.max(60, cell.holder.clientHeight);
      cell.plot.setSize({ width: w, height: h });
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
    ctx.strokeStyle = 'rgba(255,90,54,0.55)';
    ctx.fillStyle = ACCENT;
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

const SERIES_BY_KEY = Object.fromEntries(SERIES.map((spec) => [spec.key, spec])) as Record<SeriesKey, SeriesSpec>;

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
