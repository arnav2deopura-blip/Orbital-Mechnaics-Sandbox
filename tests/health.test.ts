import { describe, expect, it } from 'vitest';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { bySeverity, preflight, runtimeIssues } from '../src/app/health';
import type { Issue, RuntimeInput } from '../src/app/health';
import { suggestPreset } from '../src/app/suggest';
import { findPreset, PRESETS } from '../src/presets';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import { instantiate } from '../src/presets/schema';
import { createDiagnostics, measure } from '../src/sim/diagnostics';
import { snapshot } from '../src/sim/state';
import { scaleToBound } from '../src/sim/transforms';
import type { SystemState } from '../src/sim/types';

class StubView implements ViewPort {
  framed = 0;
  frame: ((dt: number) => SystemState) | null = null;
  setSystemScale(): void {}
  setCameraMode(): void {}
  recordSample(): void {}
  recordGhostSample(): void {}
  setGhost(): void {}
  clearTrails(): void {}
  start(frame: (dt: number) => SystemState): void {
    this.frame = frame;
  }
  frameAll(): void {
    this.framed++;
  }
}

function state(m: number[], x: number[], v: number[]): SystemState {
  return { t: 0, G: 1, eps2: 0, m: Float64Array.from(m), x: Float64Array.from(x), v: Float64Array.from(v) };
}

function energy(s: SystemState): { kinetic: number; potential: number; energy: number } {
  const d = createDiagnostics();
  measure(s, d);
  return d;
}

const ids = (issues: Issue[]): string[] => issues.map((issue) => issue.id);

const quiet: RuntimeInput = {
  integrator: 'leapfrog',
  explicitEuler: false,
  failure: null,
  warning: null,
  energyError: 1e-8,
  escaped: [false, false, false],
  far: [false, false, false],
  custom: false,
};

describe('preflight', () => {
  const figure8 = instantiate(FIGURE_EIGHT).state;

  it('finds nothing wrong with the figure-eight at a sensible step', () => {
    expect(preflight({ state: figure8, integrator: 'leapfrog', dt: 0.001, period: 6.3 })).toEqual([]);
  });

  it('says a system moving too fast is unbound, and offers to slow it or a preset', () => {
    const fast = snapshot(figure8);
    for (let i = 0; i < 9; i++) fast.v[i] *= 3;
    const [issue] = preflight({ state: fast, integrator: 'ias15', dt: 0.01, period: 6.3 });
    expect(issue.id).toBe('unbound');
    expect(issue.fixes).toEqual(['bind', 'suggested']);
  });

  it('flags bodies that start on top of each other and fall together, but not a close pair in orbit', () => {
    const s = state([1, 1, 1], [0, 0, 0, 1e-4, 0, 0, 1, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ids(preflight({ state: s, integrator: 'ias15', dt: 1e-4, period: 1 }))).toContain('close-start');
    // The same pair moving around each other at the circular speed sqrt(G (m1 + m2) / r).
    const speed = Math.sqrt(2 / 1e-4) / 2;
    const orbiting = state([1, 1, 1], [0, 0, 0, 1e-4, 0, 0, 1, 1, 0], [0, -speed, 0, 0, speed, 0, 0, 0, 0]);
    expect(ids(preflight({ state: orbiting, integrator: 'ias15', dt: 1e-4, period: 1 }))).not.toContain('close-start');
  });

  it('flags a fixed step too large for the period, but not for IAS15, whose step is only a first guess', () => {
    expect(ids(preflight({ state: figure8, integrator: 'rk4', dt: 1, period: 6.3 }))).toEqual(['coarse-step']);
    expect(preflight({ state: figure8, integrator: 'ias15', dt: 1, period: 6.3 })).toEqual([]);
  });
});

describe('runtime issues', () => {
  it('reports a failure as the most serious thing, with ways to fix it', () => {
    const issues = runtimeIssues({ ...quiet, failure: 'integration failed at t=1, min separation 1e-9' });
    expect(issues[0]).toMatchObject({ id: 'failed', severity: 'danger' });
    expect(issues[0].fixes).toContain('ias15');
    expect(issues[0].detail).toMatch(/^Integration failed/);
  });

  it('pauses on an energy blow-up, except with explicit Euler, where it is the lesson', () => {
    const blowup = runtimeIssues({ ...quiet, energyError: 0.5 })[0];
    expect(blowup).toMatchObject({ id: 'energy-blowup', severity: 'danger', pause: true });
    const euler = runtimeIssues({ ...quiet, integrator: 'euler', explicitEuler: true, energyError: 0.5 })[0];
    expect(euler.severity).toBe('warning');
    expect(euler.pause).toBeUndefined();
  });

  it('offers another preset only when the user changed the system', () => {
    expect(runtimeIssues({ ...quiet, failure: 'x' })[0].fixes).not.toContain('suggested');
    expect(runtimeIssues({ ...quiet, failure: 'x', custom: true })[0].fixes).toContain('suggested');
  });

  it('tells an escape from a body that is merely far away', () => {
    const issues = runtimeIssues({ ...quiet, escaped: [false, true, false], far: [true, true, false] });
    expect(ids(issues)).toEqual(['far-0', 'escaped-1']);
    expect(issues[1].fixes[0]).toBe('frame');
  });

  it('orders by severity, keeping the order within one', () => {
    const make = (id: string, severity: Issue['severity']): Issue => ({ id, severity, title: '', detail: '', fixes: [] });
    expect(ids(bySeverity([make('a', 'info'), make('b', 'danger'), make('c', 'info'), make('d', 'warning')]))).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('scaleToBound', () => {
  it('brings kinetic energy to half the potential, keeping positions and the center-of-mass velocity', () => {
    const s = state([1, 2, 3], [1, 0, 0, -1, 0.5, 0, 0, -1, 0.2], [0, 4, 0, 3, 0, 1, -2, -2, 0]);
    const before = snapshot(s);
    scaleToBound(s);
    expect(Array.from(s.x)).toEqual(Array.from(before.x));
    const comV = (t: SystemState, c: number): number => (t.m[0] * t.v[c] + t.m[1] * t.v[3 + c] + t.m[2] * t.v[6 + c]) / 6;
    for (let c = 0; c < 3; c++) expect(comV(s, c)).toBeCloseTo(comV(before, c), 12);
    // With the COM moving, compare in the COM frame: shift it out first.
    const rest = snapshot(s);
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) rest.v[3 * i + c] -= comV(s, c);
    const d = energy(rest);
    expect(d.kinetic / -d.potential).toBeCloseTo(0.5, 12);
    expect(d.energy).toBeLessThan(0);
  });

  it('leaves a system at rest alone', () => {
    const s = state([1, 1, 1], [1, 0, 0, -1, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(scaleToBound(s)).toBe(1);
  });
});

describe('suggestPreset', () => {
  it('reads similar masses at rest as the Pythagorean problem', () => {
    const s = state([3, 4, 5], [1, 3, 0, -2, -1, 0, 1, -1, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(suggestPreset(s).presetId).toBe('pythagorean');
  });

  it('reads equal moving masses as the figure-eight', () => {
    const s = instantiate(FIGURE_EIGHT).state;
    for (let i = 0; i < 9; i++) s.v[i] *= 2.5;
    expect(suggestPreset(s).presetId).toBe('figure-eight');
  });

  it('reads a star with a planet and a massless body as the Trojan setup', () => {
    const s = state([1, 1e-3, 0], [0, 0, 0, 5, 0, 0, 2.5, 4.3, 0], [0, 0, 0, 0, 3, 0, -2.6, 1.5, 0]);
    expect(suggestPreset(s).presetId).toBe('trojan');
  });

  it('reads a star with a close planet-moon pair as star-planet-moon', () => {
    const s = state([1, 1e-3, 1e-5], [0, 0, 0, 1, 0, 0, 1.02, 0, 0], [0, 0, 0, 0, 1, 0, 0, 1.1, 0]);
    expect(suggestPreset(s).presetId).toBe('star-planet-moon');
  });

  it('only names presets that exist', () => {
    for (const preset of PRESETS) {
      const suggestion = suggestPreset(instantiate(preset).state);
      expect(findPreset(suggestion.presetId), suggestion.presetId).toBeDefined();
    }
  });
});

describe('Controller health', () => {
  it('has nothing to warn about when a preset loads with its own settings', () => {
    const controller = new Controller(new StubView(), FIGURE_EIGHT);
    for (const preset of PRESETS) {
      controller.loadPreset(preset);
      const serious = controller.issues.filter((issue) => issue.severity !== 'info');
      expect(serious.map((issue) => `${preset.id}: ${issue.id}`)).toEqual([]);
    }
  });

  it('warns about an unbound edit and fixes it by slowing the bodies, which then runs', () => {
    const controller = new Controller(new StubView(), FIGURE_EIGHT);
    for (const body of controller.draft) {
      body.vel.x *= 4;
      body.vel.y *= 4;
    }
    controller.applyDraft();
    expect(controller.custom).toBe(true);
    expect(controller.loop.settings.running).toBe(false);
    expect(ids([...controller.issues])).toContain('unbound');
    expect(controller.suggestion()?.presetId).toBe('figure-eight');

    controller.applyFix('bind');
    expect(ids([...controller.issues])).not.toContain('unbound');
    expect(energy(controller.sim.state).energy).toBeLessThan(0);
    expect(controller.loop.settings.running).toBe(true);
  });

  it('loads the suggested preset, and "defaults" reloads the preset unedited', () => {
    const controller = new Controller(new StubView(), FIGURE_EIGHT);
    controller.loadPreset(findPreset('sandbox')!);
    controller.applyFix('suggested');
    expect(controller.preset.id).not.toBe('sandbox');
    expect(controller.custom).toBe(false);
  });

  it('pauses once on a blow-up, and not again after play', () => {
    const view = new StubView();
    const controller = new Controller(view, FIGURE_EIGHT);
    controller.start();
    controller.setIntegrator('leapfrog');
    controller.play();
    // Cheat the energy: a different G makes the same state look like a huge energy error.
    controller.sim.state.G = 3;
    view.frame!(0.2);
    expect(ids([...controller.issues])).toContain('energy-blowup');
    expect(controller.loop.settings.running).toBe(false);
    controller.play();
    view.frame!(0.2);
    view.frame!(0.2);
    expect(controller.loop.settings.running).toBe(true);
  });

  it('turns the coarse-step warning off with a smaller step', () => {
    const view = new StubView();
    const controller = new Controller(view, FIGURE_EIGHT);
    controller.start();
    controller.setIntegrator('rk4');
    controller.setDt(controller.sim.reference.period / 5);
    view.frame!(0.2); // the issues refresh with the readout
    expect(ids([...controller.issues])).toContain('coarse-step');
    controller.applyFix('smaller-step');
    expect(controller.sim.reference.period / controller.sim.params.dt).toBeGreaterThanOrEqual(20);
    expect(ids([...controller.issues])).not.toContain('coarse-step');
  });

  it('frames the bodies through the view', () => {
    const view = new StubView();
    const controller = new Controller(view, FIGURE_EIGHT);
    controller.applyFix('frame');
    expect(view.framed).toBe(1);
  });
});
