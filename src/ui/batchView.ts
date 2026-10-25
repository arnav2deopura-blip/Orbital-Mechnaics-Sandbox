import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { FastForwardResult, LyapunovResult, SweepResult } from '../sim/batch';
import { alignedData } from './align';
import type { PlotSeries } from './align';

// The results of the batch jobs (plan §9): an overlay with log-log plots for the sweeps, the
// history of a fast-forward, and the Lyapunov estimate.

/** A log axis cannot show zero: an error that is exactly zero (or NaN) is drawn here. */
const FLOOR = 1e-18;

export interface SweepEntry {
  label: string;
  color: string;
  /** The order the method should show, or null (IAS15's cost is in its tolerance, not a step). */
  expected: number | null;
  result: SweepResult;
}

interface PlotOptions {
  title: string;
  xLabel: string;
  yLabel: string;
  series: PlotSeries[];
  logX: boolean;
  logY: boolean;
}

export class BatchView {
  private readonly root = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly body = document.createElement('div');
  private readonly plots: uPlot[] = [];

  constructor(host: HTMLElement) {
    const root = this.root;
    root.style.cssText =
      'position:absolute;top:16px;bottom:16px;left:16px;right:16px;display:none;flex-direction:column;box-sizing:border-box;' +
      'background:rgba(6,8,13,0.97);border:1px solid #1d2433;border-radius:6px;font:12px/1.4 ui-monospace,monospace;color:#cfd6e6;z-index:5';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #1d2433';
    this.title.style.cssText = 'font-weight:600;color:#ffd166';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = 'background:#1d2433;color:#cfd6e6;border:0;border-radius:4px;padding:4px 10px;cursor:pointer;font:inherit';
    close.addEventListener('click', () => this.hide());
    header.append(this.title, close);
    this.body.style.cssText = 'overflow:auto;padding:12px;flex:1';
    root.append(header, this.body);
    host.appendChild(root);
  }

  hide(): void {
    this.root.style.display = 'none';
    this.clear();
  }

  /** The convergence plot (error against step, with the measured order) and the work-precision plot (error against cost). */
  showSweep(entries: SweepEntry[], heading: string): void {
    this.open(heading);
    const stepped = entries.filter((e) => e.expected !== null);
    this.plot({
      title: 'Convergence: error after the run, against step size',
      xLabel: 'step size',
      yLabel: 'position error',
      logX: true,
      logY: true,
      series: stepped.map((e) => ({ label: e.label, color: e.color, x: e.result.values, y: clampAll(e.result.errors) })),
    });
    this.legend(
      stepped.map((e) => {
        const measured = e.result.slope;
        const text = Number.isFinite(measured)
          ? `measured order ${measured.toFixed(2)}`
          : 'order not measurable here (the error is at roundoff, or too large to follow a power law)';
        return { color: e.color, text: `${e.label}: ${text}, expected ${e.expected}` };
      }),
    );
    this.plot({
      title: 'Work-precision: error against force evaluations (the cost)',
      xLabel: 'force evaluations',
      yLabel: 'position error',
      logX: true,
      logY: true,
      series: entries.map((e) => ({ label: e.label, color: e.color, x: e.result.forceEvals, y: clampAll(e.result.errors) })),
    });
    const references = new Set(entries.map((e) => e.result.reference));
    this.note(
      `Error is measured against ${references.has('exact') && !references.has('ias15') ? 'the exact Kepler solution' : references.has('exact') ? 'the exact Kepler solution or IAS15 at a tight tolerance' : 'IAS15 at a tight tolerance (1e-10)'}. ` +
        'Lower and further left is better. Where a line flattens, roundoff has been reached.',
    );
  }

  /** The history of a fast-forward, and a button to carry on from where it ended. */
  showFastForward(result: FastForwardResult, summary: string, onContinue: () => void): void {
    this.open('Fast-forward');
    const x = result.elapsed;
    const one = (title: string, y: Float64Array, color: string): void =>
      this.plot({ title, xLabel: 'elapsed time', yLabel: '', logX: false, logY: true, series: [{ label: title, color, x, y: clampAll(y) }] });
    one('Energy error', result.energyError, '#ffd166');
    one('Angular momentum error', result.angularMomentumError, '#06d6a0');
    one('Closest pair distance', result.minSeparation, '#ff8787');
    this.note(`${summary}${result.failure ? ` Stopped early: ${result.failure}.` : ''}`);
    const button = document.createElement('button');
    button.textContent = 'Continue from the final state';
    button.style.cssText = 'background:#ffd166;color:#05060a;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;font:inherit;margin-top:6px';
    button.addEventListener('click', () => {
      onContinue();
      this.hide();
    });
    this.body.appendChild(button);
  }

  /** The running estimate of the largest Lyapunov exponent. */
  showLyapunov(result: LyapunovResult): void {
    this.open('Lyapunov exponent');
    this.plot({
      title: 'Largest Lyapunov exponent, running estimate',
      xLabel: 'time',
      yLabel: 'exponent',
      logX: false,
      logY: false,
      series: [{ label: 'estimate', color: '#ffa94d', x: result.times, y: result.exponent }],
    });
    this.note(
      result.final > 0
        ? `The estimate ends at ${result.final.toPrecision(3)} per unit time: a Lyapunov time of about ${result.lyapunovTime.toPrecision(3)}. ` +
            'A regular orbit gives an estimate that keeps falling toward zero (like ln t / t); chaos gives one that levels off above it.'
        : 'The estimate is not positive: no sign of chaos over this run.',
    );
  }

  private open(title: string): void {
    this.clear();
    this.title.textContent = title;
    this.root.style.display = 'flex';
  }

  private clear(): void {
    for (const plot of this.plots) plot.destroy();
    this.plots.length = 0;
    this.body.replaceChildren();
  }

  private note(text: string): void {
    const p = document.createElement('p');
    p.textContent = text;
    p.style.cssText = 'color:#8b95a8;margin:8px 0';
    this.body.appendChild(p);
  }

  private legend(items: { color: string; text: string }[]): void {
    const box = document.createElement('div');
    box.style.cssText = 'margin:2px 0 14px';
    for (const item of items) {
      const line = document.createElement('div');
      const swatch = document.createElement('span');
      swatch.style.cssText = `display:inline-block;width:10px;height:10px;margin-right:6px;background:${item.color}`;
      line.append(swatch, item.text);
      box.appendChild(line);
    }
    this.body.appendChild(box);
  }

  private plot(options: PlotOptions): void {
    const label = document.createElement('div');
    label.textContent = options.title;
    label.style.cssText = 'margin-top:8px';
    const holder = document.createElement('div');
    this.body.append(label, holder);
    const axis = { stroke: '#6c7a93', grid: { stroke: '#1d2433', width: 1 }, ticks: { stroke: '#2b3a55', width: 1 }, font: '10px ui-monospace, monospace' };
    const scale = (log: boolean) => (log ? { distr: 3 as const, log: 10 as const } : { distr: 1 as const });
    const width = Math.max(300, (this.body.clientWidth || 600) - 24);
    const plot = new uPlot(
      {
        width,
        height: 220,
        legend: { show: false },
        cursor: { show: false },
        scales: { x: { time: false, ...scale(options.logX) }, y: scale(options.logY) },
        axes: [
          { ...axis, size: 34, label: options.xLabel, labelFont: '10px ui-monospace, monospace', values: (_u, t) => t.map((v) => (v == null ? '' : options.logX ? v.toExponential(0) : String(+v.toPrecision(3)))) },
          { ...axis, size: 60, label: options.yLabel, labelFont: '10px ui-monospace, monospace', values: (_u, t) => t.map((v) => (v == null ? '' : options.logY ? v.toExponential(0) : String(+v.toPrecision(3)))) },
        ],
        series: [{}, ...options.series.map((s) => ({ stroke: s.color, width: 1.5, spanGaps: true, points: { show: true, size: 4 } }))],
      },
      alignedData(options.series) as uPlot.AlignedData,
      holder,
    );
    this.plots.push(plot);
  }
}

/** Errors for a log axis: zero and NaN become the floor. */
function clampAll(values: ArrayLike<number>): number[] {
  return Array.from(values, (v) => Math.max(v, FLOOR) || FLOOR);
}
