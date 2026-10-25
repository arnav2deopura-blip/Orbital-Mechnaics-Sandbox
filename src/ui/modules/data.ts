import type { Controller } from '../../app/controller';
import { BatchClient } from '../../app/batch';
import type { RunningJob } from '../../app/batch';
import type { SceneView } from '../../render/scene';
import { Cancelled, geometricSeries } from '../../sim/batch';
import type { SweepResult } from '../../sim/batch';
import { snapshot } from '../../sim/state';
import type { BatchView, SweepEntry } from '../batchView';
import { downloadText } from '../charts';
import { METHOD_COLORS } from '../palette';
import type { ModuleSpec } from '../shell';
import { fixed, learnLink, paneIn, prose, REFRESH_MS, scientific, setTitle } from './common';

// The modules that report: live numbers (plan §6), chart sampling and export (plan §7.8), the
// batch jobs (plan §9), and performance (plan §5.2).

export function numbersModule(controller: Controller): ModuleSpec {
  return {
    id: 'numbers',
    title: 'Live Numbers',
    summary: 'Energy and momentum errors, closest approach, step size and cost, as they happen',
    shownByDefault: true,
    perBody: true,
    build(body) {
      const pane = paneIn(body);
      const { readout } = controller;
      const pair = controller.sim.state.n === 2;
      const watch = (key: keyof typeof readout, label: string, format?: (value: number) => string, hint?: string): void => {
        setTitle(pane.addBinding(readout, key, { label, readonly: true, ...(format && { format }) }), hint);
      };
      watch('energyError', 'energy error', scientific, '|E - E0| / |E0|. Real gravity keeps it at zero: anything else is the method’s error.');
      watch('angularMomentumError', 'L error', scientific, '|L - L0| / L_scale.');
      watch('momentumError', '|P| error', scientific, 'Total momentum. Every method here keeps it at zero to roundoff.');
      watch('minSeparation', pair ? 'separation' : 'closest pair', (value) => value.toPrecision(3));
      // The Routh criterion is about three bodies on an equilateral triangle: a pair has none.
      if (!pair) watch('routh', 'Routh', fixed(3), "27 (m1 m2 + m2 m3 + m3 m1) / M^2. Lagrange's equilateral solution is stable below 1.");
      watch('dt', 'step taken', scientific);
      watch('steps', 'steps', fixed(0));
      watch('forceEvals', 'force evals', fixed(0), 'How many times the forces were computed: the fair measure of cost.');
      learnLink(body, 'How to read these numbers →', 'conservation-laws');
      return () => pane.refresh();
    },
  };
}

export function exportModule(controller: Controller): ModuleSpec {
  return {
    id: 'export',
    title: 'Chart Data & Export',
    summary: 'How often the charts sample, and CSV downloads',
    shownByDefault: false,
    build(body) {
      prose(body, 'Pick which charts show from the charts drawer under the view. These settings apply to all of them.', 'module-meta');
      const pane = paneIn(body);
      const rate = {
        get perPeriod(): number {
          return Math.round(controller.sim.reference.period / controller.sampler.interval);
        },
        set perPeriod(count: number) {
          if (count !== this.perPeriod) controller.setSamplesPerPeriod(count);
        },
      };
      setTitle(
        pane.addBinding(rate, 'perPeriod', { label: 'samples / T', min: 20, max: 2000, step: 10 }),
        'How many points each chart takes per T_char of simulated time. Applies from now on.',
      );
      pane.addButton({ title: 'Clear history' }).on('click', () => controller.restartHistory());
      pane.addButton({ title: 'Download diagnostics CSV' }).on('click', () => downloadText('three-body-diagnostics.csv', controller.sampler.toCsv()));
      const trajectory = pane.addButton({ title: 'Download trajectory CSV' });
      trajectory.on('click', () => downloadText('three-body-trajectory.csv', controller.sampler.toTrajectoryCsv()));
      setTitle(trajectory, 'The positions of the bodies at each chart sample, as CSV.');
      return () => pane.refresh();
    },
  };
}

/** The methods a sweep compares, with the step range each is tried over (as fractions of T_char) and the order it should show. */
const SWEEP_METHODS = [
  { id: 'euler', symplectic: false, label: 'Euler', expected: 1, from: 1 / 6400, to: 1 / 204800, color: METHOD_COLORS.euler },
  { id: 'euler', symplectic: true, label: 'Symplectic Euler', expected: 1, from: 1 / 6400, to: 1 / 204800, color: METHOD_COLORS.symplecticEuler },
  { id: 'leapfrog', symplectic: false, label: 'Leapfrog', expected: 2, from: 1 / 100, to: 1 / 1600, color: METHOD_COLORS.leapfrog },
  { id: 'rk4', symplectic: false, label: 'RK4', expected: 4, from: 1 / 100, to: 1 / 600, color: METHOD_COLORS.rk4 },
  { id: 'wh', symplectic: false, label: 'Wisdom-Holman', expected: 2, from: 1 / 100, to: 1 / 1600, color: METHOD_COLORS.wh },
] as const;

export function batchModule(controller: Controller, view: BatchView): ModuleSpec {
  return {
    id: 'batch',
    title: 'Batch Jobs',
    summary: 'Convergence sweeps, fast-forward and a Lyapunov estimate, run in the background',
    shownByDefault: false,
    build(body) {
      const { sim } = controller;
      prose(body, 'These run in the background without drawing, then show their results over the view.', 'module-meta');
      const pane = paneIn(body);
      // 1.3 periods, not 1: the end of the run then falls away from a symmetric point of the orbit, where symplectic Euler
      // would show order 2 instead of its true 1 (it is second order from pericenter after a whole number of periods).
      const setup = { sweepPeriods: 1.3, fastForwardPeriods: 100, lyapunovPeriods: 20, status: 'idle' };
      let client: BatchClient | null = null;
      let running: RunningJob<unknown> | null = null;

      /** Runs one job at a time, reporting on the status line; cancelled or failed jobs say so. */
      const launch = async (name: string, work: (batch: BatchClient, progress: (label: string) => (f: number) => void) => Promise<void>): Promise<void> => {
        if (running) {
          setup.status = 'a job is already running';
          return;
        }
        client ??= new BatchClient();
        const progress = (label: string) => (f: number) => (setup.status = `${label}: ${Math.round(100 * f)}%`);
        running = { result: Promise.resolve(), cancel: () => {} };
        try {
          await work(client, progress);
          setup.status = `${name}: done`;
        } catch (error) {
          setup.status = error instanceof Cancelled ? `${name}: cancelled` : `${name} failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
          running = null;
        }
      };
      /** Starts a job and makes the Cancel button cancel it. */
      const track = <R>(job: RunningJob<R>): Promise<R> => {
        running = job as RunningJob<unknown>;
        return job.result;
      };

      const sweepFolder = pane.addFolder({ title: 'Convergence sweep' });
      const sweep = sweepFolder.addButton({ title: 'Run sweep' });
      sweep.on('click', () =>
        void launch('sweep', async (batch, progress) => {
          const state = sim.baselineSnapshot();
          const period = sim.reference.period;
          const duration = setup.sweepPeriods * period;
          const entries: SweepEntry[] = [];
          const methods = SWEEP_METHODS.filter((m) => m.id !== 'wh' || state.eps2 === 0);
          for (const m of methods) {
            const result: SweepResult = await track(
              batch.sweep(
                { state, integrator: m.id, symplecticEuler: m.symplectic, centralBody: sim.params.centralBody, duration, values: geometricSeries(period * m.from, period * m.to, 8) },
                progress(m.label),
              ),
            );
            entries.push({ label: m.label, color: m.color, expected: m.expected, result });
          }
          entries.push({
            label: 'IAS15 (tolerance 1e-4 to 1e-10)',
            color: METHOD_COLORS.ias15,
            expected: null,
            result: await track(batch.sweep({ state, integrator: 'ias15', duration, values: [1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10] }, progress('IAS15'))),
          });
          view.showSweep(entries, `Sweep over ${setup.sweepPeriods} period${setup.sweepPeriods === 1 ? '' : 's'} (T_char = ${period.toPrecision(4)}), from the baseline state`);
        }),
      );
      setTitle(sweep, 'Runs each method over a range of step sizes from the starting state and plots its error against step and against cost. The slope of the first plot is the order: 1, 2, 4 and 2 (Wisdom-Holman on a hierarchical system).');
      sweepFolder.addBinding(setup, 'sweepPeriods', { label: 'periods', min: 0.25, max: 10, step: 0.05 });

      const forwardFolder = pane.addFolder({ title: 'Fast-forward' });
      const forward = forwardFolder.addButton({ title: 'Run fast-forward' });
      forward.on('click', () =>
        void launch('fast-forward', async (batch, progress) => {
          const period = sim.reference.period;
          const integrator = sim.integrator;
          const result = await track(
            batch.fastForward(
              {
                state: snapshot(sim.state),
                integrator: integrator.id,
                symplecticEuler: integrator.id === 'euler' && integrator.symplectic,
                centralBody: sim.params.centralBody,
                dt: sim.params.dt,
                epsTol: sim.params.epsTol,
                duration: setup.fastForwardPeriods * period,
                period,
              },
              progress('fast-forward'),
            ),
          );
          const summary = `${setup.fastForwardPeriods} periods with ${integrator.id}: ${result.steps} steps, ${result.forceEvals} force evaluations, reached t = ${result.final.t.toPrecision(5)}.`;
          view.showFastForward(result, summary, () => {
            const next = snapshot(sim.state);
            next.t = result.final.t;
            next.x.set(result.final.x);
            next.v.set(result.final.v);
            controller.edit(next, false);
          });
        }),
      );
      setTitle(forward, 'Runs the current system ahead, with the current method and step, without drawing it, and plots what happened. "Continue" then loads the final state.');
      forwardFolder.addBinding(setup, 'fastForwardPeriods', { label: 'periods', min: 1, max: 5000, step: 1 });

      const lyapFolder = pane.addFolder({ title: 'Lyapunov estimate' });
      const lyap = lyapFolder.addButton({ title: 'Run estimate' });
      lyap.on('click', () =>
        void launch('Lyapunov estimate', async (batch, progress) => {
          const period = sim.reference.period;
          const result = await track(batch.lyapunov({ state: snapshot(sim.state), duration: setup.lyapunovPeriods * period, period }, progress('Lyapunov')));
          view.showLyapunov(result);
        }),
      );
      setTitle(lyap, 'Follows a shadow copy offset by 1e-8, renormalizing every so often (the Benettin method), and plots the running estimate of the largest Lyapunov exponent.');
      lyapFolder.addBinding(setup, 'lyapunovPeriods', { label: 'periods', min: 1, max: 500, step: 1 });

      pane.addButton({ title: 'Cancel job' }).on('click', () => running?.cancel());
      pane.addBinding(setup, 'status', { label: 'status', readonly: true, interval: REFRESH_MS });
      learnLink(body, 'Learn about error, order and cost →', 'error-order-cost');
      return () => pane.refresh();
    },
  };
}

export function performanceModule(controller: Controller, view: SceneView): ModuleSpec {
  return {
    id: 'performance',
    title: 'Performance',
    summary: 'Frame rate, time spent simulating and drawing, and auto quality',
    shownByDefault: false,
    build(body) {
      const pane = paneIn(body);
      const watch = (target: object, key: string, label: string, digits: number): void => {
        pane.addBinding(target as Record<string, number>, key, { label, readonly: true, format: fixed(digits) });
      };
      setTitle(pane.addBinding(view.settings, 'autoQuality', { label: 'auto quality' }), 'When frames stay slow, lower the pixel ratio and then shorten the trails, and say so below.');
      pane.addBinding(view.stats, 'quality', { label: 'quality', readonly: true });
      pane.addBinding(view.stats, 'fps', { readonly: true, interval: REFRESH_MS, view: 'graph', min: 0, max: 144 });
      watch(view.stats, 'frameMs', 'frame ms', 1);
      watch(view.stats, 'renderMs', 'render ms', 2);
      watch(controller.loop.stats, 'simMs', 'sim ms', 2);
      watch(controller.loop.stats, 'stepsPerSec', 'steps / s', 0);
      watch(controller.loop.stats, 'forceEvalsPerSec', 'evals / s', 0);
      watch(controller.loop.stats, 'achieved', 'speed kept', 2);
      return () => pane.refresh();
    },
  };
}
