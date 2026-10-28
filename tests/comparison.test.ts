import { describe, expect, it } from 'vitest';
import { Comparison, equalizedDt } from '../src/app/comparison';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { SimLoop } from '../src/app/loop';
import { PRESETS } from '../src/presets';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import { instantiate } from '../src/presets/schema';
import type { CameraMode } from '../src/render/scene';
import { characteristicTime } from '../src/sim/diagnostics';
import { createIntegrator } from '../src/sim/integrators';
import type { Integrator } from '../src/sim/integrators/types';
import { Simulation } from '../src/sim/simulation';
import { createState, snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { kepler, stateError } from './helpers';

const FOREVER = Infinity;

function preset(id: string): { sim: Simulation; period: number } {
  const p = PRESETS.find((q) => q.id === id)!;
  const { state, period: declared } = instantiate(p);
  const period = declared ?? characteristicTime(state);
  const dt = p.recommended.dt ?? period / (p.recommended.integrator === 'ias15' ? 100 : 1000);
  return { sim: new Simulation(state, { integrator: p.recommended.integrator, params: { dt } }), period };
}

describe('Comparison: divergence at different times', () => {
  it('keeps the last value when the two runs are drawn at different times, instead of reading a time gap as divergence', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const cmp = new Comparison(sim, { kind: 'twin', nudge: { body: 0, target: 'position', direction: 'x', size: 1e-9 } });
    const a = createState();
    const b = createState();
    sim.advanceTo(0.5, FOREVER);
    cmp.sim.advanceTo(0.5, FOREVER);
    sim.stateAt(0.5, a);
    cmp.sim.stateAt(0.5, b);
    const agreed = cmp.measure(sim, a, b);
    expect(agreed).toBeGreaterThan(0);
    expect(agreed).toBeLessThan(1e-6);

    // The frame budget ran out for the twin: the first run is drawn later than the twin, by a good fraction of an orbit.
    sim.advanceTo(0.8, FOREVER);
    sim.stateAt(0.8, a);
    cmp.sim.stateAt(0.5, b);
    expect(cmp.measure(sim, a, b)).toBe(agreed);
  });
});

describe('Comparison', () => {
  it('starts from the source state, time and direction, with its own copy', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    sim.advanceTo(0.3, FOREVER);
    sim.setDirection(-1);
    const comparison = new Comparison(sim, { kind: 'twin' });
    expect(comparison.sim).not.toBe(sim);
    expect(comparison.sim.state.t).toBe(sim.state.t);
    expect(comparison.sim.direction).toBe(-1);
    expect(stateError(comparison.sim.state, sim.state)).toBe(0);
    expect(comparison.sim.integrator.id).toBe('leapfrog');
    expect(comparison.sim.params.dt).toBe(sim.params.dt);
    expect(comparison.sim.params).not.toBe(sim.params);
  });

  it('nudges only the twin, by the requested fraction of the system', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const before = snapshot(sim.state);
    const comparison = new Comparison(sim, { kind: 'twin', nudge: { body: 1, target: 'position', direction: 'x', size: 1e-6 } });
    expect(sim.state.x).toEqual(before.x);
    const offset = comparison.sim.state.x[3] - sim.state.x[3];
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(1e-4);
    expect(comparison.sim.state.x[4]).toBe(sim.state.x[4]);
  });

  it('with no nudge, a twin stays identical to the first run, bit for bit, and the divergence is zero', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const comparison = new Comparison(sim, { kind: 'twin' });
    const loop = new SimLoop(sim, { speed: 2, budgetMs: 1e9 });
    loop.twin = comparison.sim;
    for (let i = 0; i < 20; i++) loop.frame(0.1);
    expect(stateError(comparison.sim.state, sim.state)).toBe(0);
    expect(comparison.measure(sim, loop.rendered, loop.renderedTwin)).toBe(0);
    expect(comparison.divergence).toBe(0);
  });

  it('compares different methods on the identical start, with its own step size', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const comparison = new Comparison(sim, { kind: 'method', integrator: 'rk4', dt: T / 200 });
    expect(comparison.sim.integrator.id).toBe('rk4');
    expect(comparison.sim.params.dt).toBe(T / 200);
    expect(sim.params.dt).toBe(T / 1000);
    expect(stateError(comparison.sim.state, sim.state)).toBe(0);
  });

  it('measures divergence at the time being drawn: interpolated when the runs step differently', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const comparison = new Comparison(sim, { kind: 'method', integrator: 'rk4', dt: T / 37 });
    const loop = new SimLoop(sim, { speed: 1, budgetMs: 1e9 });
    loop.twin = comparison.sim;
    loop.frame(1);
    expect(sim.state.t).not.toBe(comparison.sim.state.t);
    // Both are accurate to far better than 1e-4 here, so the divergence at one instant is tiny.
    const d = comparison.measure(sim, loop.rendered, loop.renderedTwin);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1e-3);
  });

  it('is exponentially sensitive in the Pythagorean problem and not in the stable figure-eight', () => {
    const divergences = (id: string, nudgeSize: number, times: number[]): number[] => {
      const { sim, period } = preset(id);
      const comparison = new Comparison(sim, { kind: 'twin', nudge: { body: 0, target: 'position', direction: 'x', size: nudgeSize } });
      const loop = new SimLoop(sim, { speed: 1, budgetMs: 1e9 });
      loop.twin = comparison.sim;
      const out: number[] = [];
      let t = 0;
      for (const target of times) {
        while (t < target) {
          loop.frame(1);
          t += 1;
        }
        out.push(comparison.measure(sim, loop.rendered, loop.renderedTwin));
      }
      expect(period).toBeGreaterThan(0);
      return out;
    };
    const [early, late] = divergences('pythagorean', 1e-9, [2, 40]);
    expect(late / early).toBeGreaterThan(100); // grew by orders of magnitude, from 1e-9 to 1e-6
    const [calmEarly, calmLate] = divergences('figure-eight', 1e-9, [4, 40]);
    expect(calmLate / calmEarly).toBeLessThan(20); // at most linear growth
  });
});

describe('equalizedDt', () => {
  const make = (id: Parameters<typeof createIntegrator>[0]): Integrator => createIntegrator(id);

  it('gives RK4 four times the step of leapfrog, so both make the same force evaluations per unit time', () => {
    expect(equalizedDt(0.01, make('leapfrog'), make('rk4'))).toBeCloseTo(0.04, 15);
    expect(equalizedDt(0.04, make('rk4'), make('leapfrog'))).toBeCloseTo(0.01, 15);
    expect(equalizedDt(0.01, make('leapfrog'), make('euler'))).toBe(0.01);
  });

  it('has no answer when a method has no fixed cost per step (IAS15)', () => {
    expect(equalizedDt(0.01, make('leapfrog'), make('ias15'))).toBeNull();
    expect(equalizedDt(0.01, make('ias15'), make('rk4'))).toBeNull();
  });

  it('really does equalize the cost: force evaluations per unit time match', () => {
    const { s, T } = kepler();
    const dt = T / 400;
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt } });
    const other = new Comparison(sim, { kind: 'method', integrator: 'rk4', dt: equalizedDt(dt, sim.integrator, createIntegrator('rk4')) as number });
    sim.advanceTo(2 * T, FOREVER);
    other.sim.advanceTo(2 * T, FOREVER);
    // Within a force evaluation or so per unit time: leapfrog's first step pays one extra.
    expect(other.sim.counters.forceEvals / other.sim.state.t).toBeCloseTo(sim.counters.forceEvals / sim.state.t, 0);
  });
});

describe('SimLoop with a twin', () => {
  it('advances both to the same time target, and draws both there', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const comparison = new Comparison(sim, { kind: 'method', integrator: 'rk4', dt: T / 100 });
    const loop = new SimLoop(sim, { speed: 1, budgetMs: 1e9 });
    loop.twin = comparison.sim;
    loop.frame(1);
    expect(sim.state.t).toBeGreaterThanOrEqual(1);
    expect(comparison.sim.state.t).toBeGreaterThanOrEqual(1);
    expect(loop.rendered.t).toBeCloseTo(1, 10);
    expect(loop.renderedTwin.t).toBeCloseTo(1, 10);
  });

  it('drops the backlog to whichever run is further behind when the budget runs out', () => {
    let now = 0;
    const clock = (): number => (now += 1);
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 }, clock });
    const comparison = new Comparison(sim, { kind: 'method', integrator: 'rk4', dt: T / 1000, clock });
    const loop = new SimLoop(sim, { speed: 1000, budgetMs: 0.5 }, clock);
    loop.twin = comparison.sim;
    loop.frame(0.1);
    const behind = Math.min(sim.state.t, comparison.sim.state.t);
    expect(behind).toBeLessThan(10);
    expect(loop.rendered.t).toBeCloseTo(behind, 10);
    expect(loop.stats.achieved).toBeLessThan(1);
  });

  it('pauses when the twin fails, even though the first run is fine', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const comparison = new Comparison(sim, { kind: 'method', integrator: 'rk4', dt: T / 100 });
    comparison.sim.state.x[0] = NaN;
    comparison.sim.integrator.reset();
    const loop = new SimLoop(sim, { speed: 1, budgetMs: 1e9 });
    loop.twin = comparison.sim;
    loop.frame(1);
    expect(comparison.sim.failure).not.toBeNull();
    expect(sim.failure).toBeNull();
    expect(loop.settings.running).toBe(false);
  });

  it('steps the twin to the same time on a single step', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const comparison = new Comparison(sim, { kind: 'twin' });
    const loop = new SimLoop(sim, { speed: 1 });
    loop.twin = comparison.sim;
    loop.stepOnce();
    expect(comparison.sim.state.t).toBe(sim.state.t);
  });

  it('stops at stopAt, pauses, and says so', () => {
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 } });
    const loop = new SimLoop(sim, { speed: 100, budgetMs: 1e9 });
    let stops = 0;
    loop.onStop = () => stops++;
    loop.stopAt = 0.5;
    loop.frame(1); // asks for 100 time units, but may only go to 0.5
    expect(stops).toBe(1);
    expect(loop.settings.running).toBe(false);
    expect(loop.stopAt).toBeNull();
    expect(sim.state.t).toBeGreaterThanOrEqual(0.5);
    expect(sim.state.t).toBeLessThan(0.5 + T / 1000);
  });
});

describe('SimLoop: stepping with a twin', () => {
  it('gives the twin a budget, so one click cannot hold the page while a much finer twin catches up', () => {
    const { s, T } = kepler();
    let now = 0;
    const clock = (): number => (now += 10); // every reading of the clock costs 10 ms
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 100 }, clock });
    const twin = new Comparison(sim, { kind: 'method', integrator: 'leapfrog', dt: T / 50000, clock });
    const loop = new SimLoop(sim, {}, clock);
    loop.twin = twin.sim;
    loop.stepOnce();
    expect(sim.state.t).toBeCloseTo(T / 100, 12);
    expect(twin.sim.state.t).toBeGreaterThan(0);
    expect(twin.sim.state.t).toBeLessThan(sim.state.t); // stopped by the budget; the next frame catches up
  });
});

class StubView implements ViewPort {
  clears = 0;
  ghostSamples = 0;
  ghost: SystemState | null = null;
  frame: ((dt: number) => SystemState) | null = null;
  setSystemScale(): void {}
  setCameraMode(_mode: CameraMode): void {}
  recordSample(): void {}
  recordGhostSample(): void {
    this.ghostSamples++;
  }
  setGhost(state: SystemState | null): void {
    this.ghost = state;
  }
  clearTrails(): void {
    this.clears++;
  }
  start(frame: (dt: number) => SystemState): void {
    this.frame = frame;
  }
}

function setup(): { controller: Controller; view: StubView } {
  const view = new StubView();
  const controller = new Controller(view, FIGURE_EIGHT);
  controller.start();
  return { controller, view };
}

const run = (view: StubView, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) view.frame!(1 / 60);
};

describe('Controller: comparison', () => {
  it('draws the twin as a ghost, records its trail, and restarts the histories together', () => {
    const { controller, view } = setup();
    run(view, 0.5);
    const clears = view.clears;
    expect(controller.startComparison({ kind: 'twin', nudge: { body: 0, target: 'position', direction: 'x', size: 1e-6 } })).toBeNull();
    expect(view.ghost).toBe(controller.loop.renderedTwin);
    expect(view.clears).toBe(clears + 1);
    expect(controller.sampler.length).toBe(1);
    expect(controller.comparison?.sampler.length).toBe(1);
    run(view, 1);
    expect(view.ghostSamples).toBeGreaterThan(10);
    expect(controller.comparison!.sampler.length).toBeGreaterThan(10);
    expect(controller.readout.divergence).toBeGreaterThan(0);
    expect(controller.sampler.has('divergence')).toBe(true);
  });

  it('follows the first run through a reversal', () => {
    const { controller, view } = setup();
    controller.startComparison({ kind: 'twin' });
    controller.setDirection(-1);
    expect(controller.comparison!.sim.direction).toBe(-1);
    run(view, 0.3);
    expect(controller.comparison!.sim.state.t).toBeLessThan(0);
  });

  it('ends on reset, edit and loading a preset, and on request', () => {
    for (const end of [
      (c: Controller): void => c.reset(),
      (c: Controller): void => c.applyDraft(),
      (c: Controller): void => c.loadPreset(FIGURE_EIGHT),
      (c: Controller): void => c.stopComparison(),
    ]) {
      const { controller, view } = setup();
      controller.startComparison({ kind: 'twin' });
      run(view, 0.2);
      end(controller);
      expect(controller.comparison).toBeNull();
      expect(controller.loop.twin).toBeNull();
      expect(view.ghost).toBeNull();
      expect(Number.isNaN(controller.readout.divergence)).toBe(true);
    }
  });

  it('reports why a twin cannot be made instead of throwing', () => {
    const { controller } = setup();
    controller.setSoftening(0.05);
    const error = controller.startComparison({ kind: 'method', integrator: 'wh', dt: 0.01 });
    expect(error).toMatch(/softening/);
    expect(controller.comparison).toBeNull();
  });

  it('reports a failing twin in the status', () => {
    const { controller, view } = setup();
    controller.startComparison({ kind: 'method', integrator: 'rk4', dt: 0.01 });
    controller.comparison!.sim.state.x[0] = NaN;
    controller.comparison!.sim.integrator.reset();
    run(view, 0.5);
    expect(controller.sim.failure).toBeNull();
    expect(controller.comparison!.sim.failure).not.toBeNull();
    expect(controller.loop.settings.running).toBe(false);
    expect(controller.readout.status).toMatch(/^the comparison twin failed: integration failed/);
  });
});

describe('Controller: a failed twin', () => {
  const failedTwin = (): { controller: Controller; view: StubView } => {
    const { controller, view } = setup();
    controller.startComparison({ kind: 'method', integrator: 'rk4', dt: 0.01 });
    controller.comparison!.sim.state.x[0] = NaN;
    controller.comparison!.sim.integrator.reset();
    run(view, 0.5);
    return { controller, view };
  };

  it('raises a warning, counts as a failed run for the status pill, and cannot be played past', () => {
    const { controller } = failedTwin();
    expect(controller.issues.map((i) => i.id)).toContain('twin-failed');
    expect(controller.failed).toBe(true);
    controller.play();
    expect(controller.loop.settings.running).toBe(false);
  });

  it('is cleared, and the run goes on, by stopping the comparison from the warning', () => {
    const { controller, view } = failedTwin();
    controller.applyFix('stop-twin');
    expect(controller.comparison).toBeNull();
    expect(controller.failed).toBe(false);
    expect(controller.loop.settings.running).toBe(true);
    const t = controller.sim.state.t;
    run(view, 0.3);
    expect(controller.sim.state.t).toBeGreaterThan(t);
    expect(controller.issues.map((i) => i.id)).not.toContain('twin-failed');
  });
});

describe('Controller: a same-method twin', () => {
  it.each([
    ['the method', (c: Controller): unknown => c.setIntegrator('rk4')],
    ['the step', (c: Controller): unknown => c.setDt(c.sim.params.dt / 2)],
    ['the tolerance', (c: Controller): unknown => c.setEpsTol(1e-6)],
    ['a step limit', (c: Controller): unknown => c.setStepLimit('dtMax', 0.1)],
  ])('ends when %s of the first run changes, rather than comparing two different runs', (_name, change) => {
    const { controller } = setup();
    controller.startComparison({ kind: 'twin', nudge: { body: 0, target: 'position', direction: 'x', size: 1e-6 } });
    change(controller);
    expect(controller.comparison).toBeNull();
    expect(controller.loop.twin).toBeNull();
  });

  it('is kept when a method comparison is running, which is meant to differ', () => {
    const { controller } = setup();
    controller.startComparison({ kind: 'method', integrator: 'rk4', dt: 0.01 });
    controller.setDt(controller.sim.params.dt / 2);
    expect(controller.comparison).not.toBeNull();
  });
});

describe('Controller: return to start', () => {
  const kepler = (): { controller: Controller; view: StubView } => {
    const { controller, view } = setup();
    controller.loadPreset(PRESETS.find((p) => p.id === 'kepler')!, { params: { e: 0.5 } });
    controller.setIntegrator('leapfrog');
    controller.setDt(controller.sim.reference.period / 500);
    controller.setSpeed(controller.sim.reference.period); // a period a second
    return { controller, view };
  };

  it('retraces a leapfrog run to roundoff and pauses there', () => {
    const { controller, view } = kepler();
    run(view, 1.5);
    expect(controller.sim.distanceFromBaseline()).toBeGreaterThan(0.01);
    controller.returnToStart();
    run(view, 0.3);
    expect(controller.readout.status).toBe('returning to the start');
    run(view, 3);
    expect(controller.loop.settings.running).toBe(false);
    expect(controller.sim.direction).toBe(-1);
    expect(controller.readout.returnDistance).toBeLessThan(1e-9);
    expect(Math.abs(controller.sim.state.t)).toBeLessThan(1e-12);
    expect(controller.readout.status).toMatch(/returned to the start: phase-space distance \d\.\d\de-\d+/);
  });

  it('does not retrace under explicit Euler', () => {
    const { controller, view } = kepler();
    controller.setIntegrator('euler');
    controller.setDt(controller.sim.reference.period / 5000);
    run(view, 1);
    controller.returnToStart();
    run(view, 3);
    expect(controller.readout.returnDistance).toBeGreaterThan(1e-5);
  });

  it('works from negative time too, running forward to the start', () => {
    const { controller, view } = kepler();
    controller.setDirection(-1);
    run(view, 1);
    expect(controller.sim.state.t).toBeLessThan(0);
    controller.returnToStart();
    expect(controller.sim.direction).toBe(1);
    run(view, 3);
    expect(controller.readout.returnDistance).toBeLessThan(1e-9);
  });

  it('is cancelled, not falsely completed, when the direction is flipped mid-return', () => {
    const { controller, view } = kepler();
    run(view, 1.5);
    controller.returnToStart();
    run(view, 0.2);
    expect(controller.loop.stopAt).not.toBeNull();
    controller.setDirection(1);
    expect(controller.loop.stopAt).toBeNull();
    const t = controller.sim.state.t;
    run(view, 0.3);
    expect(controller.sim.state.t).toBeGreaterThan(t); // it runs forward, as asked
    expect(Number.isNaN(controller.readout.returnDistance)).toBe(true);
    expect(controller.readout.status).not.toMatch(/returned|returning/);
    expect(controller.loop.settings.running).toBe(true);
  });

  it('forgets the distance of a finished return when a new run begins', () => {
    const { controller, view } = kepler();
    run(view, 1);
    controller.returnToStart();
    run(view, 3);
    expect(Number.isNaN(controller.readout.returnDistance)).toBe(false);
    controller.loadPreset(FIGURE_EIGHT);
    expect(Number.isNaN(controller.readout.returnDistance)).toBe(true);
    run(view, 1);
    controller.returnToStart();
    run(view, 3);
    controller.reset();
    expect(Number.isNaN(controller.readout.returnDistance)).toBe(true);
  });

  it('reports at once when already at the start, and can be cancelled by pausing', () => {
    const { controller, view } = kepler();
    controller.returnToStart();
    expect(controller.readout.returnDistance).toBe(0);
    controller.play();
    run(view, 1);
    controller.returnToStart();
    controller.pause();
    run(view, 1);
    expect(controller.loop.stopAt).toBeNull();
    expect(controller.loop.settings.running).toBe(false);
  });
});
