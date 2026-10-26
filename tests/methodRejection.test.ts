import { describe, expect, it } from 'vitest';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { findPreset } from '../src/presets';
import { snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';

class StubView implements ViewPort {
  setSystemScale(): void {}
  setCameraMode(): void {}
  recordSample(): void {}
  recordGhostSample(): void {}
  setGhost(): void {}
  clearTrails(): void {}
  start(): void {}
}

const make = (id: string): Controller => new Controller(new StubView(), findPreset(id)!);
const withMasses = (c: Controller, m: number[]): SystemState => {
  const next = snapshot(c.sim.state);
  next.m.set(m);
  return next;
};
const issueIds = (c: Controller): string[] => {
  (c as unknown as { updateReadout(): void }).updateReadout();
  return c.issues.map((i) => i.id);
};

describe('a method that cannot run the system', () => {
  it('is refused with a message when Wisdom-Holman is chosen for a system with no mass in its central pair', () => {
    const c = make('figure-eight');
    c.edit(withMasses(c, [0, 0, 0]));
    const before = c.sim.integrator.id;
    let reason: string | null = null;
    expect(() => (reason = c.setIntegrator('wh'))).not.toThrow();
    expect(reason).toMatch(/Wisdom-Holman cannot run this system/);
    expect(reason).toMatch(/no mass/);
    expect(c.sim.integrator.id).toBe(before); // nothing changed
    expect(c.issues.find((i) => i.title === "Can't switch to that method")).toBeDefined();
  });

  it('does not touch the softening when the choice of Wisdom-Holman is refused', () => {
    const c = make('figure-eight');
    c.setSoftening(0.1);
    c.edit(withMasses(c, [0, 0, 0]));
    const eps2 = c.sim.state.eps2;
    expect(eps2).toBeGreaterThan(0);
    expect(c.setIntegrator('wh')).not.toBeNull();
    expect(c.sim.state.eps2).toBe(eps2);
  });

  it('chooses Wisdom-Holman as before for a system it can run, removing softening', () => {
    const c = make('figure-eight');
    c.setSoftening(0.1);
    expect(c.setIntegrator('wh')).toBeNull();
    expect(c.sim.integrator.id).toBe('wh');
    expect(c.sim.state.eps2).toBe(0);
    expect(issueIds(c)).not.toContain(c.issues.find((i) => i.title === "Can't switch to that method")?.id ?? 'none');
  });

  it('clears the refusal once a method is chosen successfully', () => {
    const c = make('figure-eight');
    c.edit(withMasses(c, [0, 0, 0]));
    c.setIntegrator('wh');
    expect(c.issues.some((i) => i.title === "Can't switch to that method")).toBe(true);
    expect(c.setIntegrator('ias15')).toBeNull();
    expect(c.issues.some((i) => i.title === "Can't switch to that method")).toBe(false);
  });

  it('switches a Wisdom-Holman run to IAS15, with a notice, when an edit leaves it a system it cannot run', () => {
    const c = make('trojan'); // Wisdom-Holman
    expect(c.sim.integrator.id).toBe('wh');
    expect(() => c.edit(withMasses(c, [0, 0, 0]))).not.toThrow();
    expect(c.sim.integrator.id).toBe('ias15');
    const notice = c.issues.find((i) => i.title === 'Switched to IAS15');
    expect(notice?.severity).toBe('info');
    expect(notice?.detail).toMatch(/Wisdom-Holman cannot run the system as edited/);
    // The state was loaded, and runs.
    expect(c.sim.failure).toBeNull();
    expect(c.sim.state.m.every((m) => m === 0)).toBe(true);
  });

  it('shows the switch notice for that run only', () => {
    const c = make('trojan');
    c.edit(withMasses(c, [0, 0, 0]));
    expect(c.issues.some((i) => i.title === 'Switched to IAS15')).toBe(true);
    c.reset();
    expect(c.issues.some((i) => i.title === 'Switched to IAS15')).toBe(false);
  });

  it('leaves an ordinary edit under Wisdom-Holman alone', () => {
    const c = make('trojan');
    const next = snapshot(c.sim.state);
    next.m[1] *= 2;
    c.edit(next);
    expect(c.sim.integrator.id).toBe('wh');
    expect(c.issues.some((i) => i.title === 'Switched to IAS15')).toBe(false);
  });

  it('keeps the old central body when choosing a new one cannot be run', () => {
    const c = make('figure-eight');
    expect(c.setIntegrator('wh')).toBeNull();
    c.edit(withMasses(c, [1, 0, 0])); // body 0 is the central body, as the most massive: this runs
    expect(c.sim.integrator.id).toBe('wh');
    const before = c.sim.params.centralBody;
    // Body 1 as central, with its nearest neighbour (body 2) inside: both are massless, so it cannot run.
    c.setCentralBody(1);
    expect(c.sim.params.centralBody).toBe(before);
    expect(c.sim.integrator.id).toBe('wh');
    expect(c.issues.some((i) => i.title === "Can't switch to that method")).toBe(true);
  });
});
