import { describe, expect, it } from 'vitest';
import { applyState, captureState, decodeShare, encodeShare, linkProblem, RunLinks, sanitize, shareUrl } from '../src/app/urlState';
import type { ShareState, ShareView } from '../src/app/urlState';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { PRESETS } from '../src/presets';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import { defaultSettings } from '../src/render/scene';
import type { CameraMode } from '../src/render/scene';
import type { SystemState } from '../src/sim/types';

class StubView implements ViewPort, ShareView {
  settings = defaultSettings();
  camera = { position: { x: 1, y: -2, z: 3, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } } };
  trailLengths: number[] = [];
  frame: ((dt: number) => SystemState) | null = null;
  setSystemScale(): void {}
  setCameraMode(mode: CameraMode): void {
    this.settings.cameraMode = mode;
  }
  recordSample(): void {}
  recordGhostSample(): void {}
  setGhost(): void {}
  clearTrails(): void {}
  setTrailLength(samples: number): void {
    this.trailLengths.push(samples);
  }
  start(frame: (dt: number) => SystemState): void {
    this.frame = frame;
  }
}

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;
function make(id = 'figure-eight'): { controller: Controller; view: StubView } {
  const view = new StubView();
  return { controller: new Controller(view, preset(id)), view };
}

describe('encodeShare / decodeShare', () => {
  it('round-trips a state through the hash', () => {
    const state: ShareState = {
      preset: 'lagrange',
      params: { mass: 42.5, tilt: 30 },
      integrator: 'symplectic-euler',
      dt: 0.00123,
      speed: 3,
      direction: -1,
      running: false,
      view: { cameraMode: 'body1', showWalls: true, trailFade: 2 },
      camera: [1, 2, 3],
    };
    const hash = encodeShare(state);
    expect(hash.startsWith('s=')).toBe(true);
    expect(hash).toMatch(/^s=[A-Za-z0-9_-]+$/); // safe in a URL, no padding
    expect(decodeShare(hash)).toEqual(state);
    expect(decodeShare('#' + hash)).toEqual(state);
  });

  it('survives non-ASCII text in the preset id', () => {
    expect(decodeShare(encodeShare({ preset: 'möth — I' }))?.preset).toBe('möth — I');
  });

  it('is empty-safe: nothing, junk and half a link all decode to null', () => {
    for (const bad of ['', '#', 's=', 's=!!!notbase64', 's=' + btoa('{not json'), 's=' + btoa('[]'), 's=' + btoa('"text"'), 's=' + btoa('{"x":1}')]) {
      expect(decodeShare(bad)).toBeNull();
    }
  });

  it('reads a hand-written link, with unknown keys as preset parameters', () => {
    const state = decodeShare('#preset=lagrange&mass=40&integrator=wh&dt=0.01&speed=2&direction=-1&running=0&focus=body0&plane=angular&central=1');
    expect(state).toEqual({
      preset: 'lagrange',
      params: { mass: 40 },
      integrator: 'wh',
      dt: 0.01,
      speed: 2,
      direction: -1,
      running: false,
      centralBody: 1,
      view: { cameraMode: 'body0', planeMode: 'angular' },
    });
  });

  it('builds a full URL, replacing any hash already there', () => {
    const url = shareUrl({ preset: 'kepler' }, 'https://example.org/app/index.html#old');
    expect(url.startsWith('https://example.org/app/index.html#s=')).toBe(true);
    expect(decodeShare(new URL(url).hash)?.preset).toBe('kepler');
  });
});

describe('sanitize', () => {
  it('drops what is invalid and keeps what is valid', () => {
    const state = sanitize({
      preset: 'zlk',
      params: { inclination: 65, bad: 'x', worse: NaN, inf: Infinity },
      integrator: 'rocket',
      dt: -1,
      epsTol: 1e-9,
      dtMin: 0,
      speed: Infinity,
      direction: 2,
      centralBody: 3,
      G: -5,
      softening: -1,
      running: 'yes',
      view: { showWalls: true, showGrid: 'no', cameraMode: 'sideways', planeMode: 'angular', trailLength: 1e9, trailFade: -4, bodyScale: 3, evil: 1 },
      camera: [0, 0, 0],
      bodies: { t: 0, m: [1, 1], x: [], v: [] },
    });
    expect(state).toEqual({
      preset: 'zlk',
      params: { inclination: 65 },
      epsTol: 1e-9,
      view: { showWalls: true, planeMode: 'angular', trailLength: 20000, trailFade: 0, bodyScale: 3 },
    });
  });

  it('requires a preset, and an object', () => {
    for (const bad of [null, undefined, 3, 'x', [], {}, { preset: '' }, { preset: 5 }]) expect(sanitize(bad)).toBeNull();
  });

  it('accepts edited bodies only when complete and sensible', () => {
    const good = { t: 2, m: [1, 2, 3], x: [0, 1, 2, 3, 4, 5, 6, 7, 8], v: [1, 1, 1, 1, 1, 1, 1, 1, 1] };
    expect(sanitize({ preset: 'x', bodies: good })?.bodies).toEqual(good);
    expect(sanitize({ preset: 'x', bodies: { ...good, m: [1, -2, 3] } })?.bodies).toBeUndefined();
    expect(sanitize({ preset: 'x', bodies: { ...good, x: [...good.x.slice(0, 8), NaN] } })?.bodies).toBeUndefined();
  });
});

describe('captureState / applyState', () => {
  it('captures the method, step, speed, preset parameters and view', () => {
    const { controller, view } = make('kepler');
    controller.params.e = 0.8;
    controller.applyParams();
    controller.setIntegrator('rk4');
    controller.setDt(0.02);
    controller.setSpeed(2.5);
    view.settings.showWalls = true;
    const state = captureState(controller, view);
    expect(state).toMatchObject({ preset: 'kepler', params: { e: 0.8 }, integrator: 'rk4', dt: 0.02, speed: 2.5, direction: 1 });
    expect(state.view).toMatchObject({ showWalls: true, planeMode: 'xy' });
    expect(state.camera).toEqual([1, -2, 3]);
    expect(state.bodies).toBeUndefined(); // untouched bodies are not shared
  });

  it('shares edited bodies, z included, G and softening', () => {
    const { controller, view } = make();
    controller.draft[2].pos.z = 0.5;
    controller.applyDraft();
    controller.setG(1.5);
    controller.setSoftening(0.02);
    const state = captureState(controller, view);
    expect(state.bodies).toBeDefined();
    expect(state.bodies!.x[8]).toBeCloseTo(0.5 - 0.5 / 3, 12); // after re-centering
    expect(state.G).toBe(1.5);
    expect(state.softening).toBeCloseTo(0.02, 15);
  });

  it('restores a run into a fresh controller: the same method, step, bodies and view', () => {
    const a = make('lagrange');
    a.controller.params.mass = 60;
    a.controller.applyParams();
    a.controller.setIntegrator('leapfrog');
    a.controller.setDt(0.002);
    a.controller.draft[0].pos.z = 0.4;
    a.controller.draft[1].vel.z = -0.1;
    a.controller.applyDraft();
    a.controller.setSpeed(0.7);
    a.controller.setDirection(-1);
    a.controller.pause();
    a.view.settings.cameraMode = 'body2';
    a.view.settings.showVelocity = true;
    a.view.settings.trailLength = 1000;
    const hash = encodeShare(captureState(a.controller, a.view));

    const b = make('figure-eight');
    expect(applyState(b.controller, b.view, decodeShare(hash)!)).toBe(true);
    expect(b.controller.preset.id).toBe('lagrange');
    expect(b.controller.params.mass).toBe(60);
    expect(b.controller.sim.integrator.id).toBe('leapfrog');
    expect(b.controller.sim.params.dt).toBe(0.002);
    expect(b.controller.loop.settings.speed).toBe(0.7);
    expect(b.controller.sim.direction).toBe(-1);
    expect(b.controller.loop.settings.running).toBe(false);
    expect(Array.from(b.controller.sim.state.x)).toEqual(Array.from(a.controller.sim.baselineSnapshot().x));
    expect(Array.from(b.controller.sim.state.v)).toEqual(Array.from(a.controller.sim.baselineSnapshot().v));
    expect(b.controller.sim.state.x[2]).not.toBe(0);
    expect(b.view.settings).toMatchObject({ cameraMode: 'body2', showVelocity: true, trailLength: 1000 });
    expect(b.view.trailLengths).toContain(1000);
    expect(b.view.camera.position.x).toBe(1);
  });

  it('restores symplectic Euler and Wisdom-Holman settings', () => {
    const a = make('star-planet-moon');
    expect(a.controller.sim.integrator.id).toBe('wh');
    const wh = captureState(a.controller, a.view);
    expect(wh.centralBody).toBe(1);
    a.controller.setIntegrator('euler', true);
    const euler = captureState(a.controller, a.view);
    expect(euler.integrator).toBe('symplectic-euler');

    const b = make();
    applyState(b.controller, b.view, euler);
    expect(b.controller.sim.integrator.id).toBe('euler');
    expect(b.controller.sim.integrator.symplectic).toBe(true);
    const c = make();
    applyState(c.controller, c.view, wh);
    expect(c.controller.sim.integrator.id).toBe('wh');
    expect(c.controller.sim.params.centralBody).toBe(1);
  });

  it('ignores an unknown preset, leaving the run as it was', () => {
    const { controller, view } = make();
    expect(applyState(controller, view, { preset: 'no-such-preset' })).toBe(false);
    expect(controller.preset.id).toBe(FIGURE_EIGHT.id);
  });

  it('loads a bare hand-written link', () => {
    const { controller, view } = make();
    applyState(controller, view, decodeShare('#preset=lagrange&mass=40&integrator=wh&speed=2')!);
    expect(controller.preset.id).toBe('lagrange');
    expect(controller.params.mass).toBe(40);
    expect(controller.sim.integrator.id).toBe('wh');
    expect(controller.loop.settings.speed).toBe(2);
    expect(controller.loop.settings.running).toBe(true);
  });
});

describe('hostile links', () => {
  it('reads a link whose key is a prototype property name, instead of throwing the whole link away', () => {
    expect(decodeShare('preset=figure-eight&__proto__=1')).toEqual({ preset: 'figure-eight' });
    const named = decodeShare('preset=figure-eight&constructor=1&toString=2&hasOwnProperty=3&dt=0.01');
    expect(named?.preset).toBe('figure-eight');
    expect(named?.dt).toBe(0.01);
  });

  it('pulls a preset parameter back to its slider range, so the state is real and runs', () => {
    for (const hash of ['preset=near-radial&e=1.5', 'preset=near-radial&e=-1', 'preset=kepler&massRatio=-1', 'preset=kepler&e=1e6', 'preset=star-planet-moon&fraction=0', 'preset=hyperbolic-flyby&e=0', 'preset=lagrange&mass=-198']) {
      const state = decodeShare(hash);
      expect(state, hash).not.toBeNull();
      const { controller, view } = make();
      expect(() => applyState(controller, view, state as ShareState), hash).not.toThrow();
      const sim = controller.sim;
      expect([...sim.state.x, ...sim.state.v].every(Number.isFinite), hash).toBe(true);
      const result = sim.advanceTo(sim.state.t + 0.1 * sim.reference.period, Infinity);
      expect(result.status, hash).not.toBe('failed');
    }
  });

  it('does not throw on a parameter so extreme the generator would have made a NaN period', () => {
    const { controller, view } = make();
    expect(() => applyState(controller, view, decodeShare('preset=kepler&massRatio=-1e308') as ShareState)).not.toThrow();
    expect(Number.isFinite(controller.sim.reference.period)).toBe(true);
  });
});

describe('step limits in a link', () => {
  it('never leaves the minimum step above the maximum', () => {
    const { controller, view } = make();
    applyState(controller, view, decodeShare('#preset=kepler-orbit&integrator=ias15&dtMin=0.1&dtMax=0.01')!);
    const { dtMin, dtMax } = controller.sim.params;
    expect(dtMax).toBe(0.01);
    expect(dtMin).toBeLessThanOrEqual(dtMax!);
    expect(controller.sim.advanceTo(0.5, Infinity).status).toBe('reached');
    expect(controller.sim.warning).toBeNull();
  });

  it('keeps a consistent pair as written', () => {
    const { controller, view } = make();
    applyState(controller, view, decodeShare('#preset=kepler-orbit&dtMin=0.001&dtMax=0.05')!);
    expect(controller.sim.params.dtMin).toBe(0.001);
    expect(controller.sim.params.dtMax).toBe(0.05);
  });
});

describe('RunLinks: Back and Forward to a link the simulator is already showing', () => {
  it('applies a link it has not shown, and does not restart the run for one it is showing', () => {
    const links = new RunLinks();
    expect(links.shouldApply('#preset=lagrange')).toBe(true); // at load
    links.note('#preset=lagrange');
    expect(links.shouldApply('#preset=lagrange')).toBe(false); // Back from the Learn page onto it: the run holds
    expect(links.shouldApply('#preset=euler')).toBe(true); // a different link, pasted or navigated to
  });

  it('applies the same link again when a Try-it link on the Learn page was clicked, so it gives a fresh run', () => {
    const links = new RunLinks();
    links.note('#preset=lagrange');
    expect(links.shouldApply('#preset=lagrange', true)).toBe(true);
  });

  it('counts a link that Share wrote as shown', () => {
    const links = new RunLinks();
    const { controller, view } = make();
    const url = shareUrl(captureState(controller, view), 'https://example.org/app/');
    links.note(url.slice(url.indexOf('#')));
    expect(links.shouldApply(url.slice(url.indexOf('#')))).toBe(false);
  });
});

describe('linkProblem and announce: a link that cannot be used says so', () => {
  it('is null for no link, a page address, another anchor, and a good link', () => {
    for (const hash of ['', '#', '#/learn/chaos', '#some-anchor', '#preset=lagrange&mass=40', '#' + encodeShare({ preset: 'lagrange' })]) {
      expect(linkProblem(hash), hash).toBeNull();
    }
  });

  it('describes a damaged link and a preset this version does not have', () => {
    expect(linkProblem('#s=!!!not-base64')).toMatch(/damaged|incomplete/);
    expect(linkProblem('#preset=')).toMatch(/damaged|incomplete/);
    expect(linkProblem('#preset=no-such-preset')).toMatch(/no-such-preset/);
    expect(linkProblem('#' + encodeShare({ preset: 'gone' }))).toMatch(/gone/);
  });

  it('is shown on the warnings banner, and does not change the run', () => {
    const { controller } = make();
    const before = controller.runId;
    controller.announce('warning', 'That link could not be opened', 'The link is damaged.');
    expect(controller.issues.find((i) => i.title === 'That link could not be opened')?.detail).toBe('The link is damaged.');
    expect(controller.runId).toBe(before);
    expect(controller.issues.find((i) => i.title === 'That link could not be opened')?.learn).toBeUndefined();
  });
});
