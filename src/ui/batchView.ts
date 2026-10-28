import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { FastForwardResult, LyapunovResult, SweepResult } from '../sim/batch';
import { alignedData, forLogAxis } from './align';
import { decadeSplits } from './axes';
import { lyapunovNote, sweepFailureNote } from './batchNotes';
import { INK, INK_3, RULE, RULE_STRONG } from './palette';
import type { PlotSeries } from './align';

// The results of the batch jobs (plan §9): an overlay with log-log plots for the sweeps, the
// history of a fast-forward, and the Lyapunov estimate.


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
    root.className = 'batch';
    root.style.display = 'none';
    const header = document.createElement('div');
    header.className = 'batch-head';
    this.title.className = 'batch-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bar-button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.hide());
    header.append(this.title, close);
    this.body.className = 'batch-body';
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
      series: stepped.map((e) => ({ label: e.label, color: e.color, x: e.result.values, y: forLogAxis(e.result.errors) })),
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
      series: entries.map((e) => ({ label: e.label, color: e.color, x: e.result.forceEvals, y: forLogAxis(e.result.errors) })),
    });
    const failed = sweepFailureNote(
      entries.reduce((sum, e) => sum + e.result.failures, 0),
      entries.reduce((sum, e) => sum + e.result.values.length, 0),
    );
    if (failed) this.note(failed);
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
      this.plot({ title, xLabel: 'elapsed time', yLabel: '', logX: false, logY: true, series: [{ label: title, color, x, y: forLogAxis(y) }] });
    one('Energy error', result.energyError, INK);
    one('Angular momentum error', result.angularMomentumError, INK);
    one('Separation of the closest pair', result.minSeparation, INK);
    this.note(`${summary}${result.failure ? ` Stopped early: ${result.failure}.` : ''}`);
    const button = document.createElement('button');
    button.textContent = 'Continue from the final state';
    button.className = 'bar-button primary';
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
      series: [{ label: 'estimate', color: INK, x: result.times, y: result.exponent }],
    });
    this.note(lyapunovNote(result));
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
    p.className = 'batch-note';
    this.body.appendChild(p);
  }

  private legend(items: { color: string; text: string }[]): void {
    const box = document.createElement('div');
    box.className = 'batch-legend';
    for (const item of items) {
      const line = document.createElement('div');
      const swatch = document.createElement('span');
      swatch.className = 'batch-swatch';
      swatch.style.background = item.color;
      line.append(swatch, item.text);
      box.appendChild(line);
    }
    this.body.appendChild(box);
  }

  private plot(options: PlotOptions): void {
    const label = document.createElement('div');
    label.textContent = options.title;
    label.className = 'batch-plot-title';
    const holder = document.createElement('div');
    this.body.append(label, holder);
    const font = '10.5px "Archivo Variable", system-ui, sans-serif';
    const axis = { stroke: INK_3, grid: { stroke: RULE, width: 1 }, ticks: { stroke: RULE_STRONG, width: 1 }, font };
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
          { ...axis, size: 34, label: options.xLabel, labelFont: font, ...(options.logX && { splits: decadeSplits(6) }), values: (_u, t) => t.map((v) => (v == null ? '' : options.logX ? v.toExponential(0) : String(+v.toPrecision(3)))) },
          { ...axis, size: 60, label: options.yLabel, labelFont: font, ...(options.logY && { splits: decadeSplits(6) }), values: (_u, t) => t.map((v) => (v == null ? '' : options.logY ? v.toExponential(0) : String(+v.toPrecision(3)))) },
        ],
        series: [{}, ...options.series.map((s) => ({ stroke: s.color, width: 1.5, spanGaps: true, points: { show: true, size: 4 } }))],
      },
      alignedData(options.series) as uPlot.AlignedData,
      holder,
    );
    this.plots.push(plot);
  }
}
