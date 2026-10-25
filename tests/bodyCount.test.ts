import { describe, expect, it } from 'vitest';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { preflight, runtimeIssues } from '../src/app/health';
import type { RuntimeInput } from '../src/app/health';
import { suggestPreset } from '../src/app/suggest';
import { applyState, captureState, decodeShare, encodeShare } from '../src/app/urlState';
import type { ShareView } from '../src/app/urlState';
import { findPreset, PRESETS, presetsFor } from '../src/presets';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import { instantiate } from '../src/presets/schema';
import { defaultSettings, focusPoint } from '../src/render/scene';
import type { CameraMode } from '../src/render/scene';
import { createState } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';

// The Bodies switch: two bodies or three are different systems, and everything that depends on
// the count has to follow it: the presets, the warnings, the links, the camera, the exports.

class StubView implements ViewPort, ShareView {
  settings = defaultSettings();
  camera = { position: { x: 1, y: -2, z: 3, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } } };
  frame: ((dt: number) => SystemState) | null = null;
  setSystemScale(): void {}
  setCameraMode(mode: CameraMode): void {
    this.settings.cameraMode = mode;
  }
  recordSample(): void {}
  recordGhostSample(): void {}
  setGhost(): void {}
  clearTrails(): void {}
  setTrailLength(): void {}
  start(frame: (dt: number) => SystemState): void {
    this.frame = frame;
  }
}

const make = (id = 'figure-eight'): { controller: Controller; view: StubView } => {
  const view = new StubView();
  return { controller: new Controller(view, findPreset(id)!), view };
};

describe('the preset lists', () => {
  it('splits every preset into two bodies or three, none in both', () => {
    const two = presetsFor(2);
    const three = presetsFor(3);
    expect(two.map((p) => p.id)).toEqual(['kepler-orbit', 'circular-binary', 'near-radial', 'hyperbolic-flyby', 'sandbox-2']);
    expect(two.length + three.length).toBe(PRESETS.length);
    expect(three.every((p) => instantiate(p).state.n === 3)).toBe(true);
    expect(three.map((p) => p.id)).toContain('kepler'); // the pair with a test particle is still three bodies
  });
});

describe('Controller.setBodyCount', () => {
  it('goes to the default preset of the other count, and tells listeners once', () => {
    const { controller } = make();
    let heard = 0;
    controller.onBodyCountChange(() => heard++);
    controller.setBodyCount(2);
    expect(controller.bodyCount).toBe(2);
    expect(controller.preset.id).toBe('kepler-orbit');
    expect(heard).toBe(1);
    controller.setBodyCount(2); // already there
    expect(heard).toBe(1);
    controller.setBodyCount(3);
    expect(controller.preset.id).toBe('figure-eight');
    expect(heard).toBe(2);
  });

  it('goes back to the preset last used with that many bodies', () => {
    const { controller } = make('lagrange');
    controller.loadPreset(findPreset('near-radial')!);
    expect(controller.bodyCount).toBe(2);
    controller.setBodyCount(3);
    expect(controller.preset.id).toBe('lagrange');
    controller.setBodyCount(2);
    expect(controller.preset.id).toBe('near-radial');
  });

  it('ignores a remembered preset that is not of that count', () => {
    const { controller } = make();
    controller.lastPreset[2] = 'figure-eight';
    controller.setBodyCount(2);
    expect(controller.preset.id).toBe('kepler-orbit');
  });

  it('runs a pair: the editor buffer, the readout and the diagnostics all use two bodies', () => {
    const { controller, view } = make();
    controller.setBodyCount(2);
    controller.start();
    controller.play();
    for (let i = 0; i < 30; i++) view.frame!(1 / 30);
    const { sim, readout } = controller;
    expect(sim.failure).toBeNull();
    expect(Number.isNaN(readout.routh)).toBe(true); // a pair has no Routh ratio
    expect(readout.minSeparation).toBeGreaterThan(0);
    expect(sim.analyticError()).toBeLessThan(1e-8);
    // Applying the editor writes two bodies and leaves the absent slot alone.
    controller.draft[0].m = 2;
    controller.draft[2].m = 9; // not shown for a pair, and must not reach the system
    controller.applyDraft();
    expect(sim.state.m[2]).toBe(0);
    expect(sim.state.m[0]).toBe(2);
  });
});

describe('links with two bodies', () => {
  it('round-trips an edited pair, and keeps the absent slot at zero', () => {
    const { controller, view } = make('kepler-orbit');
    controller.draft[1].pos.z = 0.3;
    controller.applyDraft();
    const state = captureState(controller, view);
    expect(state.preset).toBe('kepler-orbit');
    expect(state.bodies).toBeDefined();
    const fresh = make('figure-eight');
    expect(applyState(fresh.controller, fresh.view, decodeShare(`#${encodeShare(state)}`)!)).toBe(true);
    expect(fresh.controller.bodyCount).toBe(2);
    expect(fresh.controller.sim.state.x[5]).toBeCloseTo(controller.sim.state.x[5], 12);
  });

  it('ignores whatever a hand-made link puts in the absent slot', () => {
    const { controller, view } = make();
    const link = encodeShare({
      preset: 'kepler-orbit',
      bodies: { t: 0, m: [1, 0.3, 5], x: [-0.2, 0, 0, 0.8, 0, 0, 9, 9, 9], v: [0, -0.5, 0, 0, 1, 0, 3, 3, 3] },
    });
    expect(applyState(controller, view, decodeShare(`#${link}`)!)).toBe(true);
    const s = controller.sim.state;
    expect(s.n).toBe(2);
    expect([s.m[2], ...s.x.subarray(6), ...s.v.subarray(6)]).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('opens older links, which have no body count, as the three-body system they were', () => {
    const { controller, view } = make('kepler-orbit');
    const old = decodeShare('#preset=kepler&integrator=euler&dt=0.005&speed=1')!;
    expect(applyState(controller, view, old)).toBe(true);
    expect(controller.preset.id).toBe('kepler');
    expect(controller.bodyCount).toBe(3);
  });

  it('takes the parameters of a 2-body preset from a hand-written link', () => {
    const { controller, view } = make();
    applyState(controller, view, decodeShare('#preset=kepler-orbit&e=0.7')!);
    expect(controller.bodyCount).toBe(2);
    expect(controller.params.e).toBe(0.7);
  });
});

describe('warnings and suggestions for a pair', () => {
  const quiet: RuntimeInput = { integrator: 'leapfrog', explicitEuler: false, failure: null, warning: null, energyError: 0, escaped: [false, false], far: [false, false], custom: false };

  it('says once that two bodies are leaving each other, not once for each', () => {
    const issues = runtimeIssues({ ...quiet, escaped: [true, true] });
    expect(issues.map((i) => i.id)).toEqual(['escaped-pair']);
    expect(issues[0].detail).toMatch(/hyperbolic/);
  });

  it('does not call the flyby unbound, and still does for a pair that was meant to be bound', () => {
    const flyby = instantiate(findPreset('hyperbolic-flyby')!).state;
    const args = { state: flyby, integrator: 'ias15' as const, dt: 0.01, period: 5 };
    expect(preflight(args).map((i) => i.id)).toContain('unbound');
    expect(preflight({ ...args, expectUnbound: true }).map((i) => i.id)).not.toContain('unbound');
    const { controller } = make('hyperbolic-flyby');
    expect(controller.issues.map((i) => i.id)).not.toContain('unbound');
  });

  it('names the pair preset closest to the user’s values', () => {
    const pair = (g: (s: SystemState) => void): SystemState => {
      const s = createState(1, 0, 2);
      s.m.set([1, 1, 0]);
      s.x.set([-0.5, 0, 0, 0.5, 0, 0]);
      g(s);
      return s;
    };
    const circular = Math.sqrt(2 / 1) / 2; // each body at half the relative circular speed
    expect(suggestPreset(pair((s) => s.v.set([0, -circular, 0, 0, circular, 0]))).presetId).toBe('circular-binary');
    expect(suggestPreset(pair((s) => s.v.set([0, -2, 0, 0, 2, 0]))).presetId).toBe('hyperbolic-flyby');
    expect(suggestPreset(pair((s) => s.v.set([0, -0.1, 0, 0, 0.1, 0]))).presetId).toBe('near-radial');
    expect(suggestPreset(pair((s) => s.v.set([0, -0.55, 0, 0, 0.55, 0]))).presetId).toBe('kepler-orbit');
  });
});

describe('what depends on the count elsewhere', () => {
  it('writes only the bodies there are into the trajectory CSV', () => {
    const { controller } = make('kepler-orbit');
    controller.restartHistory();
    const header = controller.sampler.toTrajectoryCsv().split('\n')[0];
    expect(header).toBe('elapsed_time,t,x1,y1,z1,x2,y2,z2');
    controller.setBodyCount(3);
    controller.restartHistory();
    expect(controller.sampler.toTrajectoryCsv().split('\n')[0]).toBe('elapsed_time,t,x1,y1,z1,x2,y2,z2,x3,y3,z3');
  });

  it('follows the center of mass when asked to follow a third body a pair does not have', () => {
    const x = Float64Array.of(-1, 0, 0, 3, 0, 0, 0, 0, 0);
    const m = Float64Array.of(3, 1, 0);
    const out = new Float64Array(3);
    expect(focusPoint('body2', x, m, out, 2)).toBe(true);
    expect(out[0]).toBeCloseTo(0, 14); // (3 * -1 + 1 * 3) / 4
    expect(focusPoint('body1', x, m, out, 2)).toBe(true);
    expect(out[0]).toBe(3);
    // With no mass at all, the center is the mean of the two, not of three.
    focusPoint('com', x, Float64Array.of(0, 0, 0), out, 2);
    expect(out[0]).toBeCloseTo(1, 14);
  });
});

describe('the figure-eight stays what it was', () => {
  it('is a three-body preset with all three bodies present', () => {
    const s = instantiate(FIGURE_EIGHT).state;
    expect(s.n).toBe(3);
    expect(Array.from(s.m)).toEqual([1, 1, 1]);
  });
});
