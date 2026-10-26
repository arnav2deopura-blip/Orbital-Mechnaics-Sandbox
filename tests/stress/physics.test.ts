// Stress harness, phase 1 (physics). Slow and deliberately adversarial, so skipped unless asked:
//   STRESS=1 npx vitest run tests/stress/physics.test.ts
// Each case states what should be true. A failure here is a finding, not necessarily a regression.
import { describe, expect, it } from 'vitest';
import { findPreset, PRESETS } from '../../src/presets';
import { instantiate } from '../../src/presets/schema';
import { energyError } from '../../src/sim/diagnostics';
import { keplerDrift } from '../../src/sim/kepler';
import { Simulation } from '../../src/sim/simulation';
import { createState, snapshot } from '../../src/sim/state';
import type { IntegratorId } from '../../src/sim/integrators/types';
import type { SystemState } from '../../src/sim/types';
import { ellipseAt, ellipseState, hyperbolaAt, hyperbolaState } from '../helpers';

const on = process.env.STRESS === '1';
const suite = on ? describe : describe.skip;
const log = (...a: unknown[]): void => console.log('[stress]', ...a);

const preset = (id: string) => instantiate(findPreset(id)!);
const maxPosDiff = (a: SystemState, b: SystemState): number => {
  let w = 0;
  for (let i = 0; i < 9; i++) w = Math.max(w, Math.abs(a.x[i] - b.x[i]));
  return w;
};

suite('Trojan inclination slider (plan B.1)', () => {
  it('keeps the semi-major axis at the starting radius for every inclination', () => {
    const bad: string[] = [];
    for (let inc = 0; inc <= 30; inc += 5) {
      const s = instantiate(findPreset('trojan')!, { inclination: inc }).state;
      const r = Math.hypot(s.x[6] - s.x[0], s.x[7] - s.x[1], s.x[8] - s.x[2]);
      const v2 = (s.v[6] - s.v[0]) ** 2 + (s.v[7] - s.v[1]) ** 2 + (s.v[8] - s.v[2]) ** 2;
      const a = 1 / (2 / r - v2 / (s.G * s.m[0]));
      if (Math.abs(a / r - 1) > 0.005) bad.push(`inc=${inc}: a/r=${(a / r).toFixed(4)}`);
    }
    log('trojan a/r deviations >0.5%:', bad.join('; ') || 'none');
    expect(bad).toEqual([]);
  });
});

suite('IAS15 corrector convergence flag (plan B.2)', () => {
  it('does not report non-convergence on plain orbits', () => {
    const rows: string[] = [];
    const bad: string[] = [];
    for (const id of ['kepler-orbit', 'sandbox-2', 'euler', 'near-radial', 'circular-binary', 'lagrange', 'zlk']) {
      for (const eps of [1e-6, 1e-9, 1e-12]) {
        const inst = preset(id);
        const sim = new Simulation(inst.state, { integrator: 'ias15', params: { dt: (inst.period ?? 1) / 100, epsTol: eps }, load: { period: inst.period } });
        for (let k = 0; k < 5000; k++) sim.step();
        const ig = sim.integrator as unknown as { convergenceFailures: number; dtMinHits: number };
        const row = `${id} eps=${eps} convFail=${ig.convergenceFailures} dtMinHits=${ig.dtMinHits} evals/step=${(sim.counters.forceEvals / sim.counters.stepCount).toFixed(1)} rejected=${sim.counters.rejectedSteps}`;
        rows.push(row);
        if (ig.convergenceFailures > 0) bad.push(row);
      }
    }
    log('IAS15 sweep\n' + rows.join('\n'));
    expect(bad).toEqual([]);
  }, 300_000);
});

suite('Kepler drift torture (plan 4)', () => {
  it('matches an independent bisection solution on ellipses', () => {
    const bad: string[] = [];
    for (const e of [0, 1e-12, 0.5, 0.9, 0.999, 0.999999]) {
      const mu = 1;
      const a = 1;
      const P = 2 * Math.PI;
      for (const f0 of [0, 1, 3]) {
        for (const frac of [1e-12, 1e-6, 1e-3, 0.37, 1, 7.3, 100]) {
          for (const sgn of [1, -1]) {
            const o = ellipseState(mu, a, e, f0);
            const pos = Float64Array.from(o.r);
            const vel = Float64Array.from(o.v);
            const t = sgn * frac * P;
            const ok = keplerDrift(mu, t, pos, vel, 0);
            const ref = ellipseAt(mu, a, e, f0, t);
            const err = Math.hypot(pos[0] - ref.r[0], pos[1] - ref.r[1], pos[2] - ref.r[2]);
            // Near e = 1 the reference itself loses accuracy at pericentre (E^3/6 ~ M, so a 1e-16 error in M is ~1e-5 in E).
            const tol = e > 0.99999 ? 1e-3 : 1e-8 * (1 + frac);
            if (!ok || !(err < tol)) bad.push(`e=${e} f0=${f0} dt=${t.toExponential(2)} err=${err.toExponential(2)} converged=${ok}`);
          }
        }
      }
    }
    log('ellipse failures', bad.length, bad.slice(0, 12).join(' | '));
    expect(bad).toEqual([]);
  });

  it('matches an independent solution on hyperbolas', () => {
    const bad: string[] = [];
    for (const e of [1.000001, 1.5, 5, 50]) {
      for (const f0 of [-1, 0, 0.5]) {
        for (const t of [-100, -1, -1e-6, 1e-9, 0.5, 3, 100]) {
          const o = hyperbolaState(1, 1, e, f0);
          const pos = Float64Array.from(o.r);
          const vel = Float64Array.from(o.v);
          const ok = keplerDrift(1, t, pos, vel, 0);
          const ref = hyperbolaAt(1, 1, e, f0, t);
          const scale = Math.max(1, Math.hypot(ref.r[0], ref.r[1]));
          const err = Math.hypot(pos[0] - ref.r[0], pos[1] - ref.r[1], pos[2] - ref.r[2]) / scale;
          if (!ok || !(err < 1e-8)) bad.push(`e=${e} f0=${f0} dt=${t} relErr=${err.toExponential(2)} converged=${ok}`);
        }
      }
    }
    log('hyperbola failures', bad.length, bad.slice(0, 12).join(' | '));
    expect(bad).toEqual([]);
  });

  it('round-trips forward then back to roundoff, including a near-radial plunge', () => {
    const bad: string[] = [];
    for (const h of [1, 0.1, 1e-3, 1e-6]) {
      const pos = Float64Array.of(1, 0, 0);
      const vel = Float64Array.of(0, h, 0); // apocentre with tiny angular momentum: e ~ 1
      const p0 = Float64Array.from(pos);
      const v0 = Float64Array.from(vel);
      const ok1 = keplerDrift(1, 5, pos, vel, 0);
      const ok2 = keplerDrift(1, -5, pos, vel, 0);
      const err = Math.hypot(pos[0] - p0[0], pos[1] - p0[1], vel[1] - v0[1], vel[0] - v0[0]);
      if (!ok1 || !ok2 || !(err < 1e-6)) bad.push(`h=${h} err=${err.toExponential(2)} ok=${ok1}/${ok2}`);
    }
    log('round-trip failures', bad.join(' | ') || 'none');
    expect(bad).toEqual([]);
  });
});

suite('Reversibility (plan 3)', () => {
  const methods: Array<[IntegratorId, boolean, string]> = [
    ['leapfrog', false, 'leapfrog'],
    ['euler', true, 'symplectic euler'],
    ['euler', false, 'explicit euler'],
    ['rk4', false, 'rk4'],
    ['wh', false, 'wh'],
    ['ias15', false, 'ias15'],
  ];
  it('reports how far forward-then-back lands from the start, per method', () => {
    const rows: string[] = [];
    for (const [id, sym, label] of methods) {
      const inst = preset(id === 'wh' ? 'star-planet-moon' : 'figure-eight');
      const T = inst.period!;
      const sim = new Simulation(inst.state, { integrator: id, symplecticEuler: sym, params: { dt: T / 400, centralBody: id === 'wh' ? 1 : undefined, epsTol: 1e-10 }, load: { period: T } });
      const base = snapshot(sim.state);
      for (let k = 0; k < 800; k++) sim.step();
      sim.setDirection(-1);
      for (let k = 0; k < 800; k++) sim.step();
      rows.push(`${label.padEnd(18)} |t|=${Math.abs(sim.state.t).toExponential(1)} return-distance=${maxPosDiff(sim.state, base).toExponential(2)}`);
    }
    log('reversibility\n' + rows.join('\n'));
  });
});

suite('Convergence order (plan 1)', () => {
  const fit = (hs: number[], es: number[]): number => {
    const lx = hs.map(Math.log);
    const ly = es.map(Math.log);
    const n = hs.length;
    const mx = lx.reduce((a, b) => a + b) / n;
    const my = ly.reduce((a, b) => a + b) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
    return num / den;
  };
  const cases: Array<{ label: string; setup: () => SystemState; eps2: number }> = [
    { label: 'figure-eight', setup: () => preset('figure-eight').state, eps2: 0 },
    { label: 'figure-eight softened', setup: () => { const s = preset('figure-eight').state; s.eps2 = 0.01; return s; }, eps2: 0.01 },
    { label: 'kepler pair + test particle', setup: () => preset('kepler').state, eps2: 0 },
    { label: 'sandbox (3D, unequal start)', setup: () => preset('sandbox').state, eps2: 0 },
  ];
  const nominal: Array<[IntegratorId, boolean, number, number[]]> = [
    ['euler', false, 1, [4000, 8000, 16000, 32000]],
    ['euler', true, 1, [4000, 8000, 16000, 32000]],
    ['leapfrog', false, 2, [200, 400, 800, 1600]],
    ['rk4', false, 4, [100, 200, 400, 800]],
  ];
  it('fits the nominal order within 0.2 on systems the suite does not cover', () => {
    const rows: string[] = [];
    const bad: string[] = [];
    for (const c of cases) {
      const s0 = c.setup();
      const T = 2 * Math.PI;
      const tEnd = c.label.startsWith('figure') ? 3 : 1.5 * T * 0.5;
      const ref = new Simulation(snapshot(s0), { integrator: 'ias15', params: { dt: 0.01, epsTol: 1e-12 } });
      ref.advanceTo(tEnd, Infinity);
      const refAt = createState(); ref.stateAt(tEnd, refAt);
      for (const [id, sym, order, Ns] of nominal) {
        const hs: number[] = [];
        const es: number[] = [];
        for (const N of Ns) {
          const h = tEnd / N;
          const sim = new Simulation(snapshot(s0), { integrator: id, symplecticEuler: sym, params: { dt: h } });
          for (let k = 0; k < N; k++) sim.step();
          hs.push(h);
          es.push(maxPosDiff(sim.state, refAt));
        }
        const slope = fit(hs, es);
        const row = `${c.label} | ${id}${sym ? '(symplectic)' : ''} slope=${slope.toFixed(2)} nominal=${order}`;
        rows.push(row);
        if (Math.abs(slope - order) > 0.2) bad.push(row);
      }
    }
    log('convergence\n' + rows.join('\n'));
    expect(bad).toEqual([]);
  }, 300_000);
});

suite('Invariants over long runs, every preset (plan 2)', () => {
  it('records energy, momentum and angular-momentum error per preset for the recommended method', () => {
    const rows: string[] = [];
    for (const pr of PRESETS) {
      const inst = instantiate(pr);
      const id = pr.recommended.integrator;
      const T = inst.period ?? 1;
      const dt = inst.dt ?? pr.recommended.dt ?? T / 200;
      const sim = new Simulation(inst.state, { integrator: id, params: { dt, centralBody: pr.recommended.centralBody }, load: { period: inst.period } });
      const deadline = performance.now() + 8000;
      const r = sim.advanceTo(300 * sim.reference.period, deadline);
      const d = sim.refreshDiagnostics();
      const ref = sim.reference;
      const dP = Math.hypot(d.P[0] - ref.P[0], d.P[1] - ref.P[1], d.P[2] - ref.P[2]);
      const dL = Math.hypot(d.L[0] - ref.L[0], d.L[1] - ref.L[1], d.L[2] - ref.L[2]) / ref.Lscale;
      rows.push(`${pr.id.padEnd(26)} ${id.padEnd(8)} ${r.status.padEnd(7)} t/T=${(sim.state.t / sim.reference.period).toFixed(1).padStart(6)} dE=${energyError(d, ref).toExponential(1)} dL=${dL.toExponential(1)} dP=${dP.toExponential(1)}`);
    }
    log('invariants\n' + rows.join('\n'));
  }, 400_000);
});

suite('Chaos census, Benettin exponent (plan 8)', () => {
  it('estimates the Lyapunov time of every preset, in units of T_char', () => {
    const rows: string[] = [];
    for (const pr of PRESETS) {
      const inst = instantiate(pr);
      const period = inst.period;
      const mk = (s: SystemState) => new Simulation(s, { integrator: 'ias15', params: { dt: 0.01, epsTol: 1e-10 }, load: { period } });
      const a = mk(snapshot(inst.state));
      const T = a.reference.period;
      const d0 = 1e-8 * a.reference.size;
      const s2 = snapshot(a.state);
      s2.x[0] += d0;
      const b = new Simulation(s2, { integrator: 'ias15', params: { dt: 0.01, epsTol: 1e-10 }, load: { period, recenter: false } });
      const interval = T / 4;
      const deadline = performance.now() + 6000;
      const aAt = createState(a.state.G, a.state.eps2, a.state.n);
      const bAt = createState(a.state.G, a.state.eps2, a.state.n);
      let sum = 0;
      let prev = d0;
      let elapsed = 0;
      let failed = false;
      for (let k = 1; performance.now() < deadline && k <= 400; k++) {
        const t = k * interval;
        if (a.advanceTo(t, deadline).status === 'failed' || b.advanceTo(t, deadline).status === 'failed') { failed = true; break; }
        // Both runs at exactly t, from dense output: IAS15 overshoots t by a different amount in each.
        a.stateAt(t, aAt);
        b.stateAt(t, bAt);
        let d = 0;
        for (let i = 0; i < 9; i++) d += (aAt.x[i] - bAt.x[i]) ** 2 + (aAt.v[i] - bAt.v[i]) ** 2;
        d = Math.sqrt(d);
        if (!(d > 0) || !Number.isFinite(d)) { failed = true; break; }
        sum += Math.log(d / (k === 1 ? d0 : prev));
        elapsed = t;
        // Renormalise the twin onto separation d0 along the separation vector, and restart both at t.
        const scale = d0 / d;
        prev = d0;
        for (let i = 0; i < 9; i++) {
          bAt.x[i] = aAt.x[i] + (bAt.x[i] - aAt.x[i]) * scale;
          bAt.v[i] = aAt.v[i] + (bAt.v[i] - aAt.v[i]) * scale;
        }
        a.load(aAt, { period, recenter: false });
        b.load(bAt, { period, recenter: false });
      }
      const lambda = elapsed > 0 ? sum / elapsed : NaN;
      rows.push(`${pr.id.padEnd(26)} lambda=${lambda.toExponential(2).padStart(10)} T_lambda/T_char=${lambda > 1e-9 ? (1 / lambda / T).toFixed(2) : 'inf'} over ${(elapsed / T).toFixed(0)} T${failed ? ' (FAILED)' : ''}`);
    }
    log('chaos census\n' + rows.join('\n'));
  }, 600_000);
});
