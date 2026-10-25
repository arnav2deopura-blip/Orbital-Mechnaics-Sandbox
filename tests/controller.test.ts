import { describe, expect, it } from 'vitest';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { PRESETS } from '../src/presets';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import type { CameraMode } from '../src/render/scene';
import type { Preset } from '../src/presets/schema';
import { snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';

class StubView implements ViewPort {
  scales: number[] = [];
  modes: CameraMode[] = [];
  samples = 0;
  clears = 0;
  frame: ((dt: number) => SystemState) | null = null;
  setSystemScale(size: number): void {
    this.scales.push(size);
  }
  setCameraMode(mode: CameraMode): void {
    this.modes.push(mode);
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
    expect(loop.settings.speed).toBeCloseTo(FIGURE_EIGHT.period! / 8, 12); // a period every 8 s
    expect(view.modes.at(-1)).toBe('com');
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

describe('Controller: the body editor', () => {
  it('fills the draft from the state on load, reset and edit', () => {
    const { controller } = setup();
    const { draft, sim } = controller;
    expect(draft[0].m).toBe(1);
    expect(draft[0].pos.x).toBe(sim.state.x[0]);
    expect(draft[2].vel.y).toBe(sim.state.v[7]);

    draft[1].pos.z = 99; // an unapplied edit
    controller.reset();
    expect(draft[1].pos.z).toBe(0);
  });

  it('applies edits to mass, position, velocity and z, pausing and re-baselining', () => {
    const { controller, view } = setup();
    const clears = view.clears;
    const { draft, sim } = controller;
    draft[2].pos.z = 0.5;
    draft[2].vel.z = -0.2;
    draft[0].m = 2;
    controller.applyDraft(false); // keep the COM where it is, to read the numbers back
    expect(controller.loop.settings.running).toBe(false);
    expect(sim.state.x[8]).toBe(0.5);
    expect(sim.state.v[8]).toBe(-0.2);
    expect(sim.state.m[0]).toBe(2);
    expect(view.clears).toBe(clears + 1);
    expect(controller.readout.energyError).toBe(0);
    expect(sim.counters.stepCount).toBe(0);
  });

  it('re-centers by default, so a z edit does not shift the system as a whole', () => {
    const { controller } = setup();
    controller.draft[2].pos.z = 3;
    controller.applyDraft();
    const { x, m } = controller.sim.state;
    expect(Math.abs(m[0] * x[2] + m[1] * x[5] + m[2] * x[8])).toBeLessThan(1e-14);
  });

  it('does not take negative masses', () => {
    const { controller } = setup();
    controller.draft[1].m = -5;
    controller.applyDraft();
    expect(controller.sim.state.m[1]).toBe(0);
  });

  it('then simulates the edited system in 3D with the diagnostics intact', () => {
    const { controller, view } = setup();
    controller.draft[2].pos.z = 0.4;
    controller.draft[0].vel.z = 0.1;
    controller.applyDraft();
    controller.play();
    run(view, 2);
    expect(Math.abs(controller.sim.state.x[5])).toBeGreaterThan(1e-3);
    expect(controller.readout.energyError).toBeLessThan(1e-4);
    expect(controller.readout.angularMomentumError).toBeLessThan(1e-9);
  });
});

describe('Controller: turning, nudging and settings', () => {
  it('rotates the whole system without pausing, and the energy is unchanged by it', () => {
    const { controller, view } = setup();
    run(view, 0.2);
    const e = controller.sim.refreshDiagnostics().energy;
    controller.rotate('x', 90);
    expect(controller.loop.settings.running).toBe(true);
    expect(controller.sim.refreshDiagnostics().energy).toBeCloseTo(e, 12);
    // The figure-eight's plane (xy) is now xz: the angular momentum, if any, is along -y.
    expect(Math.abs(controller.sim.state.x[2]) + Math.abs(controller.sim.state.x[5])).toBeGreaterThan(0.1);
    expect(Math.abs(controller.sim.state.x[1] * 0 + controller.sim.state.x[1])).toBeLessThan(1e-12 + Math.abs(controller.sim.state.x[1]));
  });

  it('nudges a body out of the plane and keeps running, returning the direction', () => {
    const { controller } = setup();
    const direction = controller.nudge({ body: 2, target: 'velocity', direction: 'z', size: 1e-3 });
    expect(direction).toEqual([0, 0, 1]);
    expect(controller.loop.settings.running).toBe(true);
    expect(controller.sim.state.v[8]).not.toBe(0);
    expect(controller.sim.counters.stepCount).toBe(0);
  });

  it('switches integrator, keeping the state and direction', () => {
    const { controller, view } = setup();
    run(view, 0.3);
    const t = controller.sim.state.t;
    controller.setIntegrator('rk4');
    expect(controller.sim.integrator.id).toBe('rk4');
    expect(controller.sim.state.t).toBe(t);
    controller.setIntegrator('euler', true);
    expect(controller.sim.integrator.symplectic).toBe(true);
  });

  it('removes softening when Wisdom-Holman is chosen, and ignores softening while it runs', () => {
    const { controller } = setup();
    controller.setSoftening(0.05);
    expect(controller.sim.state.eps2).toBeCloseTo(0.0025, 15);
    controller.setIntegrator('wh');
    expect(controller.sim.integrator.id).toBe('wh');
    expect(controller.sim.state.eps2).toBe(0);
    controller.setSoftening(0.05);
    expect(controller.sim.state.eps2).toBe(0);
  });

  it('re-baselines when G or the softening changes, and keeps running', () => {
    const { controller, view } = setup();
    run(view, 0.2);
    controller.setG(2);
    expect(controller.sim.state.G).toBe(2);
    expect(controller.loop.settings.running).toBe(true);
    expect(controller.readout.energyError).toBe(0);
    controller.setSoftening(0.1);
    expect(controller.readout.energyError).toBe(0);
  });

  it('changes dt for the next step', () => {
    const { controller } = setup();
    controller.setDt(0.01);
    controller.step();
    expect(controller.sim.state.t).toBeCloseTo(0.01, 14);
  });

  it('restarts Wisdom-Holman with a new central body', () => {
    const { controller } = setup();
    controller.setIntegrator('wh');
    const first = controller.sim.integrator;
    controller.setCentralBody(1);
    expect(controller.sim.params.centralBody).toBe(1);
    expect(controller.sim.integrator).not.toBe(first);
    controller.setCentralBody(undefined);
    expect(controller.sim.params.centralBody).toBeUndefined();
  });
});

describe('Controller: events', () => {
  it('reports an encounter in the status, and pauses there if asked', () => {
    const { controller, view } = setup();
    controller.setEncounter(0.9, true); // the figure-eight's closest approach is about 0.87
    run(view, 6);
    expect(controller.readout.status).toMatch(/close encounter/);
    expect(controller.loop.settings.running).toBe(false);
  });

  it('forgets the radius when another preset is loaded', () => {
    const { controller } = setup();
    controller.setEncounter(0.5, true);
    controller.loadPreset(FIGURE_EIGHT);
    expect(controller.sim.encounterRadius).toBe(0);
  });

  it('says when a body has escaped', () => {
    const { controller, view } = setup();
    const next = snapshot(controller.sim.state);
    next.x[6] += 100; // body 3 far away
    next.v[6] += 5; // and fast
    controller.edit(next, false);
    // An edit takes the system's size afresh, so measure from the size of the figure-eight itself.
    controller.sim.reference.size = 2;
    run(view, 0.2); // paused, but the readout still refreshes
    expect(controller.readout.status).toMatch(/body 3 has escaped/);
    expect(controller.readout.status).not.toMatch(/body 1/);
  });
});

describe('Controller: parametric presets', () => {
  const find = (id: string): Preset => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`no preset ${id}`);
    return preset;
  };

  it('loads a preset with its parameters, the camera it asks for, and its own step size', () => {
    const { controller, view } = setup();
    controller.loadPreset(find('star-planet-moon'));
    expect(controller.sim.integrator.id).toBe('wh');
    expect(controller.sim.params.centralBody).toBe(1);
    expect(view.modes.at(-1)).toBe('body1');
    expect(controller.params).toEqual({ fraction: 0.3, inclination: 20 });
    // The step comes from the generator: 1/40 of the moon's period, much smaller than T/1000 of a year.
    expect(controller.sim.params.dt).toBeLessThan(0.01);
    expect(view.scales.at(-1)).toBeLessThan(0.1); // framed on the moon's orbit, not the AU-scale system
  });

  it('reloads with new parameters, keeping the same params object for the sliders', () => {
    const { controller } = setup();
    controller.loadPreset(find('kepler'));
    const params = controller.params;
    params.inclination = 70;
    params.e = 0.8;
    controller.applyParams();
    expect(controller.params).toBe(params);
    expect(params.inclination).toBe(70);
    // The test particle's orbit plane is tilted by 70 degrees: z velocity / y velocity = tan(70).
    const { v } = controller.sim.state;
    expect(v[8] / v[7]).toBeCloseTo(Math.tan((70 * Math.PI) / 180), 8);
  });

  it('replaces the parameters in place when the preset changes', () => {
    const { controller } = setup();
    controller.loadPreset(find('lagrange'));
    const params = controller.params;
    expect(Object.keys(params).sort()).toEqual(['mass', 'tilt']);
    controller.loadPreset(find('sandbox'));
    expect(controller.params).toBe(params);
    expect(Object.keys(params)).toEqual(['lift']);
  });

  it('shows the Routh ratio of the loaded masses', () => {
    const { controller } = setup();
    controller.loadPreset(find('lagrange'));
    expect(controller.readout.routh).toBeLessThan(1); // mass 100: stable
    controller.params.mass = 1;
    controller.applyParams();
    expect(controller.readout.routh).toBe(9); // equal masses: unstable
  });

  it('runs every preset for a second of frames without failing', () => {
    const { controller, view } = setup();
    for (const preset of PRESETS) {
      controller.loadPreset(preset);
      run(view, 1);
      expect(controller.sim.failure, preset.id).toBeNull();
      expect(controller.readout.energyError, preset.id).toBeLessThan(1e-3);
    }
  });
});

describe('Controller: the diagnostic history', () => {
  it('starts with the initial state and fills as the simulation runs', () => {
    const { controller, view } = setup();
    expect(controller.sampler.length).toBe(1);
    run(view, 1);
    expect(controller.sampler.length).toBeGreaterThan(10);
    expect(controller.sampler.interval).toBeCloseTo(FIGURE_EIGHT.period! / 200, 12);
  });

  it('restarts on reset, edit and loading a preset, which re-baseline the errors', () => {
    const { controller, view } = setup();
    run(view, 1);
    controller.reset();
    expect(controller.sampler.length).toBe(1);
    run(view, 0.5);
    controller.draft[2].pos.z = 0.3;
    controller.applyDraft();
    expect(controller.sampler.length).toBe(1);
    run(view, 0.2); // paused: nothing is added
    expect(controller.sampler.length).toBe(1);
    controller.play();
    run(view, 0.5);
    controller.loadPreset(FIGURE_EIGHT);
    expect(controller.sampler.length).toBe(1);
    expect(controller.sampler.markers).toHaveLength(0);
  });

  it('marks an integrator switch, a reversal and a close encounter on the time axis', () => {
    const { controller, view } = setup();
    run(view, 0.3);
    controller.setIntegrator('rk4');
    controller.setDirection(-1);
    controller.setDirection(1);
    controller.setEncounter(0.9, false);
    run(view, 6);
    expect(controller.sampler.markers.map((m) => m.label)).toEqual(['rk4', 'time reversed', 'time forward', 'close encounter']);
  });

  it('does not mark a direction that did not change', () => {
    const { controller } = setup();
    controller.setDirection(1);
    expect(controller.sampler.markers).toHaveLength(0);
  });

  it('changes the sampling rate without losing the history', () => {
    const { controller, view } = setup();
    run(view, 1);
    const n = controller.sampler.length;
    controller.setSamplesPerPeriod(50);
    expect(controller.sampler.length).toBe(n);
    expect(controller.sampler.interval).toBeCloseTo(FIGURE_EIGHT.period! / 50, 12);
    controller.reset();
    expect(controller.sampler.interval).toBeCloseTo(FIGURE_EIGHT.period! / 50, 12); // kept across a restart
  });

  it('shows integrator warnings in the status', () => {
    const { controller, view } = setup();
    controller.loadPreset(PRESETS.find((p) => p.id === 'kepler')!, { params: { e: 0.9 } });
    controller.sim.params.dtMin = controller.sim.reference.period / 4;
    run(view, 2);
    expect(controller.readout.status).toMatch(/minimum step/);
  });
});
