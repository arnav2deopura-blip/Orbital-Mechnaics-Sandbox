// Stress harness, phase 2 (input fuzzing). Skipped unless asked:
//   STRESS=1 npx vitest run tests/stress/inputs.test.ts
// Failure lists are findings: each entry is an input that threw, produced a non-finite state, or
// was dropped without feedback.
import { describe, expect, it } from 'vitest';
import { applyState, decodeShare, encodeShare } from '../../src/app/urlState';
import type { ShareView } from '../../src/app/urlState';
import { Controller } from '../../src/app/controller';
import type { ViewPort } from '../../src/app/controller';
import { PRESETS } from '../../src/presets';
import { defaultSettings } from '../../src/render/scene';
import type { CameraMode } from '../../src/render/scene';
import { createState } from '../../src/sim/state';
import type { SystemState } from '../../src/sim/types';
import { makeRng } from '../helpers';

const on = process.env.STRESS === '1';
const suite = on ? describe : describe.skip;
const log = (...a: unknown[]): void => console.log('[stress]', ...a);

class StubView implements ViewPort, ShareView {
  settings = defaultSettings();
  camera = { position: { x: 1, y: -2, z: 3, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } } };
  frame: ((dt: number) => SystemState) | null = null;
  setSystemScale(): void {}
  setCameraMode(mode: CameraMode): void { this.settings.cameraMode = mode; }
  recordSample(): void {}
  recordGhostSample(): void {}
  setGhost(): void {}
  clearTrails(): void {}
  setTrailLength(): void {}
  start(frame: (dt: number) => SystemState): void { this.frame = frame; }
}

const make = (id = 'figure-eight') => {
  const view = new StubView();
  return { controller: new Controller(view, PRESETS.find((p) => p.id === id)!), view };
};
const finiteState = (s: SystemState): boolean => [...s.x, ...s.v, ...s.m].every(Number.isFinite) && Number.isFinite(s.t);

/** Applies a decoded link, runs a little, and says what went wrong (or null). */
function tryLink(hash: string): string | null {
  let state;
  try { state = decodeShare(hash); } catch (e) { return `decode threw: ${(e as Error).message}`; }
  if (!state) return null; // rejected: feedback is a UI matter, noted separately
  const { controller, view } = make();
  try {
    applyState(controller, view, state);
    const sim = controller.sim;
    if (!finiteState(sim.state)) return 'non-finite state after apply';
    const r = sim.advanceTo(sim.state.t + 0.5 * sim.reference.period, performance.now() + 300);
    if (r.status === 'failed' && sim.failure) return `fails immediately: ${sim.failure}`;
    return null;
  } catch (e) {
    return `apply threw: ${(e as Error).message}`;
  }
}

suite('URL hash fuzzing (plan 2.1)', () => {
  it('survives hostile query-style links', () => {
    const bad: string[] = [];
    const numbers = ['NaN', 'Infinity', '-Infinity', '1e308', '-1e308', '1e-308', '0', '-1', '1e300', '0x10', '', ' ', 'abc'];
    const keys = ['dt', 'epsTol', 'dtMin', 'dtMax', 'central', 'speed', 'direction', 'G', 'softening', 'running', 'e', 'massRatio', 'mass', 'inclination', 'tilt', 'offset', 'fraction', '__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    const integrators = ['leapfrog', 'rk4', 'wh', 'ias15', 'euler', 'symplectic-euler', 'bogus', ''];
    for (const p of PRESETS) {
      for (const k of keys) {
        for (const v of numbers) {
          const h = `preset=${p.id}&${k}=${v}`;
          const out = tryLink(h);
          if (out) bad.push(`#${h} -> ${out}`);
        }
      }
      for (const i of integrators) {
        for (const k of ['dt=1e-300', 'dt=1e300', 'dt=1']) {
          const out = tryLink(`preset=${p.id}&integrator=${i}&${k}`);
          if (out) bad.push(`#preset=${p.id}&integrator=${i}&${k} -> ${out}`);
        }
      }
    }
    for (const junk of ['preset=nope', 'preset=', '%', '%E0%A4%A', '&&&', 'preset=figure-eight&%ZZ=1', 's=!!!', 's=', 'preset=figure-eight&=1']) {
      const out = tryLink(junk);
      if (out) bad.push(`#${junk} -> ${out}`);
    }
    // A system that fails on its first step with a clear message (dt of 1e300, G of 1e308) is handled; only throws and NaN states are not.
    const clean = bad.filter((b) => b.includes('fails immediately'));
    const broken = bad.filter((b) => !b.includes('fails immediately'));
    log(`query-style: ${clean.length} failed cleanly on the first step, ${broken.length} broke\n` + broken.slice(0, 60).join('\n'));
    expect(broken).toEqual([]);
  }, 600_000);

  it('survives hostile structured (s=) links', () => {
    const bad: string[] = [];
    const rng = makeRng(12345);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const weird: unknown[] = [NaN, Infinity, -Infinity, 1e308, -1e308, 0, -1, 1e-320, 1e300, null, undefined, 'x', [], {}, true];
    for (let i = 0; i < 1500; i++) {
      const p = pick(PRESETS);
      const m = [1, 1, 1].map(() => (rng() < 0.2 ? pick(weird) : rng() * 3));
      const x = Array.from({ length: 9 }, () => (rng() < 0.15 ? pick(weird) : rng() * 4 - 2));
      const v = Array.from({ length: 9 }, () => (rng() < 0.15 ? pick(weird) : rng() * 2 - 1));
      const s: Record<string, unknown> = { preset: p.id };
      if (rng() < 0.5) s.bodies = { t: pick([0, 1, -5, 1e300, NaN]), m, x, v };
      if (rng() < 0.4) s.dt = pick(weird);
      if (rng() < 0.3) s.G = pick(weird);
      if (rng() < 0.3) s.softening = pick(weird);
      if (rng() < 0.3) s.integrator = pick(['leapfrog', 'rk4', 'wh', 'ias15', 'euler', 'symplectic-euler']);
      if (rng() < 0.2) s.centralBody = pick([0, 1, 2, 3, -1]);
      if (rng() < 0.2) s.epsTol = pick(weird);
      if (rng() < 0.2) s.dtMin = pick(weird);
      if (rng() < 0.2) s.dtMax = pick(weird);
      if (rng() < 0.2) s.speed = pick(weird);
      const out = tryLink('s=' + encodeShare(s as never).slice(2));
      if (out) bad.push(`${JSON.stringify(s).slice(0, 180)} -> ${out}`);
    }
    const clean = bad.filter((b) => b.includes('fails immediately'));
    const broken = bad.filter((b) => !b.includes('fails immediately'));
    log(`structured: ${clean.length} failed cleanly on the first step, ${broken.length} broke\n` + broken.slice(0, 40).join('\n'));
    expect(broken).toEqual([]);
  }, 600_000);

  it('every preset slider stays finite at and beyond its range', () => {
    const bad: string[] = [];
    for (const p of PRESETS) {
      for (const spec of p.params ?? []) {
        const span = spec.max - spec.min;
        for (const value of [spec.min, spec.max, spec.min - span, spec.max + span, 0, -1, 1e6]) {
          try {
            const { controller } = make(p.id);
            controller.loadPreset(p, { params: { [spec.key]: value } });
            const s = controller.sim.state;
            if (!finiteState(s)) bad.push(`${p.id}.${spec.key}=${value}: non-finite`);
            else if (!Number.isFinite(controller.sim.reference.period) || controller.sim.reference.period <= 0) bad.push(`${p.id}.${spec.key}=${value}: bad period ${controller.sim.reference.period}`);
            else if (value >= spec.min && value <= spec.max) {
              const r = controller.sim.advanceTo(controller.sim.state.t + controller.sim.reference.period, performance.now() + 1000);
              if (r.status === 'failed') bad.push(`${p.id}.${spec.key}=${value} (IN RANGE): ${controller.sim.failure}`);
            }
          } catch (e) { bad.push(`${p.id}.${spec.key}=${value}: threw ${(e as Error).message}`); }
        }
      }
    }
    log(`slider failures: ${bad.length}\n` + bad.join('\n'));
    // Out-of-range values are pulled back to the slider range, so nothing may fail now, in range or not.
    expect(bad).toEqual([]);
  }, 300_000);
});

suite('Body and physics edits through the controller (plan 2.2)', () => {
  it('never throws, and either runs or fails cleanly', () => {
    const bad: string[] = [];
    const integrators: Array<[string, boolean]> = [['leapfrog', false], ['rk4', false], ['wh', false], ['ias15', false], ['euler', false], ['euler', true]];
    const masses: number[][] = [[0, 0, 0], [1, 0, 0], [0, 1, 1], [1e-30, 1, 1], [1e30, 1, 1], [1, 1, 1e-300], [-1, 1, 1], [NaN, 1, 1]];
    const sizes: Array<[string, (s: SystemState) => void]> = [
      ['coincident 0&1', (s) => { s.x.set([0, 0, 0], 3); s.x.set([0, 0, 0], 0); }],
      ['coincident all', (s) => { s.x.fill(0); }],
      ['huge positions', (s) => { for (let i = 0; i < 9; i++) s.x[i] *= 1e200; }],
      ['tiny positions', (s) => { for (let i = 0; i < 9; i++) s.x[i] *= 1e-200; }],
      ['huge velocities', (s) => { for (let i = 0; i < 9; i++) s.v[i] *= 1e150; }],
      ['G=1e12', (s) => { s.G = 1e12; }],
      ['G=1e-12', (s) => { s.G = 1e-12; }],
      ['softening 1e3', (s) => { s.eps2 = 1e6; }],
      ['softening 1e-12', (s) => { s.eps2 = 1e-24; }],
    ];
    for (const [id, sym] of integrators) {
      for (const m of masses) {
        for (const [label, mutate] of [['masses', (s: SystemState) => s.m.set(m)] as [string, (s: SystemState) => void], ...sizes]) {
          const tag = `${id}${sym ? '(sym)' : ''} ${label}${label === 'masses' ? ' ' + m.join(',') : ''}`;
          try {
            const { controller } = make('figure-eight');
            controller.setIntegrator(id as never, sym);
            const next = createState(controller.sim.state.G, controller.sim.state.eps2, 3);
            next.m.set(controller.sim.state.m); next.x.set(controller.sim.state.x); next.v.set(controller.sim.state.v);
            mutate(next);
            controller.edit(next, true);
            const sim = controller.sim;
            sim.advanceTo(sim.state.t + 1, performance.now() + 100);
            if (sim.failure === null && !finiteState(sim.state)) bad.push(`${tag}: non-finite state without a reported failure`);
          } catch (e) { bad.push(`${tag}: THREW ${(e as Error).message}`); }
          if (label !== 'masses') break; // size mutations are independent of the mass loop
        }
      }
      for (const [label, mutate] of sizes) {
        const tag = `${id}${sym ? '(sym)' : ''} ${label}`;
        try {
          const { controller } = make('figure-eight');
          controller.setIntegrator(id as never, sym);
          const next = createState(controller.sim.state.G, controller.sim.state.eps2, 3);
          next.m.set(controller.sim.state.m); next.x.set(controller.sim.state.x); next.v.set(controller.sim.state.v);
          mutate(next);
          controller.edit(next, true);
          controller.sim.advanceTo(controller.sim.state.t + 1, performance.now() + 100);
        } catch (e) { bad.push(`${tag}: THREW ${(e as Error).message}`); }
      }
    }
    // softening, then WH
    try { const { controller } = make('figure-eight'); controller.setSoftening(0.1); controller.setIntegrator('wh'); } catch (e) { bad.push(`softening then WH: THREW ${(e as Error).message}`); }
    try { const { controller } = make('figure-eight'); controller.setIntegrator('wh'); controller.setSoftening(0.1); controller.sim.advanceTo(1, performance.now() + 100); } catch (e) { bad.push(`WH then softening: THREW ${(e as Error).message}`); }
    log(`edit failures: ${bad.length}\n` + [...new Set(bad)].slice(0, 80).join('\n'));
    expect(bad).toEqual([]);
  }, 600_000);
});

suite('Controller state machine (plan 2.3)', () => {
  it('survives randomised action sequences', () => {
    const rng = makeRng(2026);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const bad: string[] = [];
    const runs = 120;
    for (let run = 0; run < runs; run++) {
      const { controller } = make(pick(PRESETS).id);
      const trail: string[] = [];
      for (let step = 0; step < 40; step++) {
        const actions: Array<[string, () => void]> = [
          ['play', () => controller.play()],
          ['pause', () => controller.pause()],
          ['step', () => controller.step()],
          ['reset', () => controller.reset()],
          ['reverse', () => controller.setDirection(controller.sim.direction === 1 ? -1 : 1)],
          ['returnToStart', () => controller.returnToStart()],
          ['loadPreset', () => controller.loadPreset(pick(PRESETS.filter((p) => (p.bodyCount ?? 3) === controller.bodyCount)))],
          ['setBodyCount', () => controller.setBodyCount(pick([2, 3] as const))],
          ['setIntegrator', () => controller.setIntegrator(pick(['leapfrog', 'rk4', 'wh', 'ias15', 'euler'] as const), rng() < 0.3)],
          ['setDt', () => controller.setDt(controller.sim.reference.period / pick([3, 20, 200, 5000]))],
          ['twin', () => controller.startComparison({ kind: 'twin', nudge: { body: 0, target: 'position', direction: 'random', size: 1e-6 } })],
          ['methodCompare', () => controller.startComparison({ kind: 'method', integrator: pick(['rk4', 'leapfrog', 'ias15'] as const) })],
          ['stopComparison', () => controller.stopComparison()],
          ['rotate', () => controller.rotate(pick(['x', 'y', 'z'] as const), rng() * 90)],
          ['nudge', () => controller.nudge({ body: 0, target: 'velocity', direction: 'random', size: 1e-4 })],
          ['setG', () => controller.setG(pick([0.5, 1, 2, 4 * Math.PI ** 2]))],
          ['setSoftening', () => controller.setSoftening(pick([0, 0.01, 0.2]))],
          ['setEncounter', () => controller.setEncounter(0.05, rng() < 0.5)],
          ['advance', () => { const s = controller.sim; s.advanceTo(s.state.t + s.direction * s.reference.period * 0.2, performance.now() + 30); }],
          ['setCentralBody', () => controller.setCentralBody(pick([0, 1, 2, undefined] as const))],
          ['samplesPerPeriod', () => controller.setSamplesPerPeriod(pick([20, 200, 2000]))],
        ];
        const [name, fn] = pick(actions);
        trail.push(name);
        try { fn(); } catch (e) { bad.push(`run ${run}: ${name} threw "${(e as Error).message}" after [${trail.slice(-8).join(', ')}]`); break; }
        const s = controller.sim.state;
        if (controller.sim.failure === null && !finiteState(s)) { bad.push(`run ${run}: non-finite state after ${name}`); break; }
        if (s.n === 2 && (s.m[2] !== 0 || s.x[6] !== 0 || s.v[8] !== 0)) { bad.push(`run ${run}: slot 2 not empty after ${name} (n=2)`); break; }
      }
    }
    log(`state-machine failures: ${bad.length}/${runs}\n` + bad.slice(0, 30).join('\n'));
    expect(bad).toEqual([]);
  }, 600_000);
});

suite('Random ordinary systems: is trouble shown to the user? (plan 2, chaos)', () => {
  it('buckets the end-of-run energy error per method and checks a banner is raised when it should be', () => {
    const rng = makeRng(777);
    const methods: Array<[string, boolean]> = [['leapfrog', false], ['rk4', false], ['ias15', false], ['euler', true], ['euler', false]];
    const trials = 60;
    const buckets = ['<1e-6', '<1e-3', '<1e-2', '<0.1', '>=0.1', 'failed'];
    const rows: string[] = [];
    const silent: string[] = [];
    for (const [id, sym] of methods) {
      const counts = Object.fromEntries(buckets.map((b) => [b, 0])) as Record<string, number>;
      let bannered = 0;
      let escapedSeen = 0;
      for (let t = 0; t < trials; t++) {
        const { controller } = make('sandbox');
        controller.setIntegrator(id as never, sym);
        const next = createState(1, 0, 3);
        for (let i = 0; i < 3; i++) {
          next.m[i] = 0.2 + rng() * 2.8;
          for (let c = 0; c < 3; c++) { next.x[3 * i + c] = rng() * 4 - 2; next.v[3 * i + c] = rng() * 1.6 - 0.8; }
        }
        controller.edit(next, true);
        const sim = controller.sim;
        sim.advanceTo(10 * sim.reference.period, performance.now() + 250);
        (controller as unknown as { updateReadout(): void }).updateReadout();
        const e = controller.readout.energyError;
        const bucket = sim.failure !== null ? 'failed' : !(e < 1e-6) ? (e < 1e-3 ? '<1e-3' : e < 1e-2 ? '<1e-2' : e < 0.1 ? '<0.1' : '>=0.1') : '<1e-6';
        counts[bucket]++;
        const sevIssues = controller.issues.filter((i) => i.severity !== 'info');
        if (sevIssues.length > 0) bannered++;
        if (controller.issues.some((i) => i.id.startsWith('escaped'))) escapedSeen++;
        const explicit = id === 'euler' && !sym;
        if (!explicit && (bucket === '>=0.1' || bucket === 'failed') && sevIssues.length === 0) silent.push(`${id}${sym ? '(sym)' : ''} trial ${t}: ${bucket} but no warning`);
        if (!explicit && bucket === '<0.1' && e > 1e-2 && sevIssues.length === 0) silent.push(`${id}${sym ? '(sym)' : ''} trial ${t}: e=${e.toExponential(1)} but no warning`);
      }
      rows.push(`${id}${sym ? '(sym)' : ''}`.padEnd(14) + buckets.map((b) => `${b}: ${counts[b] ?? 0}`).join('  ') + `  | warning/danger banner in ${bannered}/${trials}, escape notice in ${escapedSeen}`);
    }
    log('random systems at sandbox dt, 10 T_char\n' + rows.join('\n') + `\nsilent cases: ${silent.length}\n` + silent.slice(0, 20).join('\n'));
    expect(silent).toEqual([]);
  }, 600_000);
});
