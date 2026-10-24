import { describe, expect, it } from 'vitest';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import type { Preset } from '../src/presets/schema';
import { snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';

class StubView implements ViewPort {
  scales: number[] = [];
  samples = 0;
  clears = 0;
  frame: ((dt: number) => SystemState) | null = null;
  setSystemScale(size: number): void {
    this.scales.push(size);
  }
  recordSample(): void {
    this.samples++;
  }
  clearTrails(): void {
    this.clears++;
  }
  start(frame: (dt: number) => SystemState): void {
    this.frame = frame;
  }
}

function setup(preset: Preset = FIGURE_EIGHT, offset = 0): { controller: Controller; view: StubView } {
  const view = new StubView();
  const controller = new Controller(view, preset, { offset });
  controller.start();
  return { controller, view };
}

const run = (view: StubView, seconds: number, frameSeconds = 1 / 60): SystemState => {
  let drawn!: SystemState;
  for (let t = 0; t < seconds; t += frameSeconds) drawn = view.frame!(frameSeconds);
  return drawn;
};

describe('Controller: loading a preset', () => {
  it('applies the recommended settings and frames the view', () => {
    const { controller, view } = setup();
    const { sim, loop } = controller;
    expect(sim.integrator.id).toBe('leapfrog');
    expect(sim.params.dt).toBeCloseTo(FIGURE_EIGHT.period! / 4000, 15);
    expect(loop.settings.speed).toBe(FIGURE_EIGHT.recommended.speed);
    expect(loop.settings.running).toBe(true);
    expect(sim.reference.period).toBe(FIGURE_EIGHT.period);
    expect(view.clears).toBeGreaterThan(0);
    expect(view.scales.at(-1)).toBeGreaterThan(1.5);
    expect(view.scales.at(-1)).toBeLessThan(3);
    expect(controller.readout.status).toBe('running');
  });

  it('switches to the integrator a preset recommends, with a default dt from the period', () => {
    const { controller } = setup();
    const ias: Preset = { ...FIGURE_EIGHT, id: 'ias', recommended: { integrator: 'ias15', speed: 1 } };
    controller.loadPreset(ias);
    expect(controller.sim.integrator.id).toBe('ias15');
    expect(controller.sim.params.dt).toBeCloseTo(FIGURE_EIGHT.period! / 100, 12);
    controller.loadPreset(FIGURE_EIGHT);
    expect(controller.sim.integrator.id).toBe('leapfrog');
    expect(controller.sim.params.dt).toBeCloseTo(FIGURE_EIGHT.period! / 4000, 15);
  });

  it('starts forward and from t = 0 even if the last system was reversed and run', () => {
    const { controller, view } = setup();
    controller.setDirection(-1);
    run(view, 0.5);
    controller.loadPreset(FIGURE_EIGHT);
    expect(controller.sim.direction).toBe(1);
    expect(controller.sim.state.t).toBe(0);
    expect(controller.sim.counters.stepCount).toBe(0);
  });

  it('keeps the system off the origin with an offset, which skips the COM shift', () => {
    const { controller } = setup(FIGURE_EIGHT, 1e6);
    expect(controller.sim.state.x[0]).toBeGreaterThan(9.99e5);
  });
});

describe('Controller: running', () => {
  it('advances the simulation, feeds the trails, and keeps the figure-eight closed', () => {
    const { controller, view } = setup();
    const drawn = run(view, 1);
    expect(controller.sim.state.t).toBeGreaterThan(0.7); // speed = T / 8
    expect(view.samples).toBe(controller.sim.counters.stepCount);
    expect(drawn.t).toBeCloseTo(controller.loop.settings.speed * 1, 1);
    expect(Number.isFinite(drawn.x[0])).toBe(true);
  });

  it('refreshes the readout from true states, about ten times a second', () => {
    const { controller, view } = setup();
    run(view, 1);
    const { readout } = controller;
    expect(readout.t).toBeGreaterThan(0.5);
    expect(readout.steps).toBeGreaterThan(0);
    expect(readout.energyError).toBeGreaterThan(0);
    expect(readout.energyError).toBeLessThan(1e-6);
    expect(readout.angularMomentumError).toBeLessThan(1e-9);
    expect(readout.minSeparation).toBeGreaterThan(0.5);
    expect(readout.dt).toBe(controller.sim.params.dt);
  });

  it('pauses and plays, and steps once', () => {
    const { controller, view } = setup();
    controller.pause();
    run(view, 0.2);
    expect(controller.sim.state.t).toBe(0);
    expect(controller.readout.status).toBe('paused');
    controller.step();
    expect(controller.sim.counters.stepCount).toBe(1);
    controller.play();
    run(view, 0.2);
    expect(controller.sim.state.t).toBeGreaterThan(0.1);
  });

  it('changes speed and direction', () => {
    const { controller, view } = setup();
    controller.setSpeed(2);
    controller.setDirection(-1);
    const drawn = run(view, 0.5);
    expect(drawn.t).toBeLessThan(-0.9);
    expect(drawn.t).toBeGreaterThan(-1.1);
  });

  it('resets to the loaded state, clearing the trails, and keeps going', () => {
    const { controller, view } = setup();
    run(view, 0.5);
    const clears = view.clears;
    controller.reset();
    expect(controller.sim.state.t).toBe(0);
    expect(view.clears).toBe(clears + 1);
    expect(controller.readout.t).toBe(0);
    expect(controller.loop.settings.running).toBe(true);
  });

  it('reports a failed integration and pauses', () => {
    const { controller, view } = setup();
    controller.sim.state.x[0] = NaN;
    controller.sim.integrator.reset();
    run(view, 0.5);
    expect(controller.sim.failure).toMatch(/integration failed/);
    expect(controller.loop.settings.running).toBe(false);
    expect(controller.readout.status).toMatch(/integration failed/);
  });
});

describe('Controller: editing', () => {
  it('pauses, re-baselines, clears the trails and restarts from the edited state', () => {
    const { controller, view } = setup();
    run(view, 0.5);
    const clears = view.clears;
    const edited = snapshot(controller.sim.state);
    edited.x[8] = 0.5; // lift body 3 out of the plane
    controller.edit(edited);

    expect(controller.loop.settings.running).toBe(false);
    expect(view.clears).toBe(clears + 1);
    expect(controller.sim.counters.stepCount).toBe(0);
    expect(controller.readout.energyError).toBe(0);
    expect(controller.readout.status).toBe('paused');
    // z was re-centered like x and y: the COM is back on the origin.
    const z = controller.sim.state.x;
    expect(Math.abs(z[2] + z[5] + z[8])).toBeLessThan(1e-15);
  });

  it('then moves in z: a body lifted out of the plane pulls the others out of it', () => {
    const { controller, view } = setup();
    const edited = snapshot(controller.sim.state);
    edited.x[8] = 0.5;
    controller.edit(edited);
    controller.play();
    run(view, 2);
    const { x } = controller.sim.state;
    expect(Math.abs(x[2]) + Math.abs(x[5])).toBeGreaterThan(1e-3); // bodies 1 and 2 left z = 0
    expect(controller.readout.energyError).toBeLessThan(1e-4);
    expect(controller.readout.angularMomentumError).toBeLessThan(1e-9);
  });

  it('keeps the offset when asked not to re-center', () => {
    const { controller } = setup();
    const edited = snapshot(controller.sim.state);
    for (let i = 0; i < 3; i++) edited.x[3 * i + 2] += 5;
    controller.edit(edited, false);
    expect(controller.sim.state.x[2]).toBe(5);
  });
});
