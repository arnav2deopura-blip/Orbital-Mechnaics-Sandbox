import { describe, expect, it } from 'vitest';
import { BatchClient } from '../src/app/batch';
import type { WorkerLike } from '../src/app/batch';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { runtimeIssues } from '../src/app/health';
import type { RuntimeInput } from '../src/app/health';
import { findPreset } from '../src/presets';
import { instantiate } from '../src/presets/schema';
import { Cancelled } from '../src/sim/batch';
import { chaosOffReason, chaosProbe, ChaosMonitor, createVerdict, predictabilityHorizon } from '../src/sim/chaos';
import type { ChaosSpec, ChaosVerdict } from '../src/sim/chaos';
import { Simulation } from '../src/sim/simulation';
import { snapshot } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { createBatchHost } from '../src/worker/host';
import type { ClientMessage, HostMessage } from '../src/worker/protocol';

/** The baseline, T_char and size of a preset, as the controller would hand them to the probe. */
function specOf(id: string, params: Record<string, number> = {}): ChaosSpec {
  const inst = instantiate(findPreset(id)!, params);
  const sim = new Simulation(inst.state, { integrator: 'ias15', params: { dt: 0.01 }, load: { period: inst.period } });
  return { state: sim.baselineSnapshot(), period: sim.reference.period, size: sim.reference.size };
}

function probe(id: string, params?: Record<string, number>): ChaosVerdict {
  const spec = specOf(id, params);
  const monitor = new ChaosMonitor();
  monitor.start(spec.state, spec.period, spec.size);
  return { ...monitor.runToEnd() };
}

describe('ChaosMonitor', () => {
  it('does not probe two bodies, or fewer than two massive ones', () => {
    for (const id of ['kepler-orbit', 'near-radial', 'hyperbolic-flyby']) {
      const spec = specOf(id);
      expect(chaosOffReason(spec.state, spec.period, spec.size)).toMatch(/two bodies/i);
      const v = probe(id);
      expect(v.state).toBe('off');
      expect(v.done).toBe(true);
    }
    const one = specOf('figure-eight');
    one.state.m.set([1, 0, 0]);
    expect(chaosOffReason(one.state, one.period, one.size)).toMatch(/fewer than two/);
    expect(chaosOffReason(specOf('figure-eight').state, 0, 1)).toMatch(/scale/);
  });

  it('finds the unstable Euler collinear orbit extremely chaotic, quickly', () => {
    const v = probe('euler');
    expect(v.state).toBe('very-chaotic');
    expect(v.lyapunovPeriods).toBeLessThan(1);
    expect(v.done).toBe(true);
  });

  it('finds the 3D sandbox chaotic', () => {
    const v = probe('sandbox');
    expect(['chaotic', 'very-chaotic']).toContain(v.state);
    expect(v.lyapunovPeriods).toBeGreaterThan(0.3);
    expect(v.lyapunovPeriods).toBeLessThan(3);
  }, 60_000);

  it('finds no chaos in regular orbits, and says it saw none rather than proving it', () => {
    for (const [id, params] of [
      ['lagrange', {}],
      ['trojan', {}],
      ['zlk', {}],
      ['figure-eight', {}],
    ] as const) {
      const v = probe(id, params);
      expect(v.state, id).toBe('regular');
      expect(v.probedPeriods, id).toBeGreaterThan(40);
      expect(v.lyapunovPeriods, id).toBeGreaterThan(3);
    }
  }, 60_000);

  it('gives the same verdict every time for the same system', () => {
    const a = probe('lagrange');
    const b = probe('lagrange');
    expect(b.lambda).toBe(a.lambda);
    expect(b.probedPeriods).toBe(a.probedPeriods);
  });

  it('can be cut into small slices without changing the result', () => {
    const spec = specOf('lagrange');
    const whole = new ChaosMonitor();
    whole.start(spec.state, spec.period, spec.size);
    whole.runToEnd();
    const sliced = new ChaosMonitor();
    sliced.start(spec.state, spec.period, spec.size);
    let ticks = 0;
    while (sliced.tick(0.5)) ticks++;
    expect(ticks).toBeGreaterThan(5);
    expect(sliced.verdict.state).toBe(whole.verdict.state);
    expect(sliced.verdict.probedPeriods).toBeCloseTo(whole.verdict.probedPeriods, 6);
  });

  it('cancel() abandons the probe without a verdict', () => {
    const spec = specOf('lagrange');
    const m = new ChaosMonitor();
    m.start(spec.state, spec.period, spec.size);
    m.tick(5);
    m.cancel();
    expect(m.tick(5)).toBe(false);
    expect(m.verdict.state).toBe('off');
  });

  it('is inconclusive, not wrong, when the integrator cannot follow the system', () => {
    const spec = specOf('figure-eight');
    spec.state.x.set([0, 0, 0, 0, 0, 0, 1, 0, 0]); // two bodies on top of each other
    const v = new ChaosMonitor().runToEnd();
    expect(v.state).toBe('off'); // never started
    const m = new ChaosMonitor();
    m.start(spec.state, spec.period, spec.size);
    expect(m.runToEnd().state).toBe('inconclusive');
  });
});

describe('predictabilityHorizon', () => {
  it('is the Lyapunov time times the number of e-folds an error needs to reach a tenth of the system', () => {
    expect(predictabilityHorizon(2, 1e-9)).toBeCloseTo(2 * Math.log(1e8), 9);
    expect(predictabilityHorizon(2, 1e-9)).toBeGreaterThan(predictabilityHorizon(2, 1e-3));
    // Rounding is the floor: a smaller error does not lengthen it without bound.
    expect(predictabilityHorizon(1, 1e-30)).toBe(predictabilityHorizon(1, 1e-16));
  });
});

describe('the chaos job in the worker', () => {
  it('runs through the host and client, with progress, and returns the verdict', async () => {
    class FakeWorker implements WorkerLike {
      onmessage: ((event: { data: HostMessage }) => void) | null = null;
      onerror: ((event: { message?: string }) => void) | null = null;
      private readonly host = createBatchHost(
        (message, transfer) => {
          const copy = structuredClone(message, { transfer });
          setTimeout(() => this.onmessage?.({ data: copy }), 0);
        },
        () => new Promise((resolve) => setTimeout(resolve, 0)),
      );
      postMessage(message: ClientMessage): void {
        const copy = structuredClone(message);
        setTimeout(() => void this.host.handle(copy), 0);
      }
      terminate(): void {}
    }
    const client = new BatchClient(() => new FakeWorker());
    const seen: number[] = [];
    const verdict = await client.chaos(specOf('euler'), (f) => seen.push(f)).result;
    expect(verdict.state).toBe('very-chaotic');
    expect(verdict.done).toBe(true);
  });

  it('stops with Cancelled when told to', async () => {
    let cancelled = false;
    const promise = chaosProbe(specOf('lagrange'), {
      cancelled: () => cancelled,
      progress: () => {},
      yield: async () => {
        cancelled = true;
      },
    });
    await expect(promise).rejects.toBeInstanceOf(Cancelled);
  });
});

// ---- the banner rules ---------------------------------------------------------------------

const base: RuntimeInput = { integrator: 'ias15', explicitEuler: false, failure: null, warning: null, energyError: 1e-13, escaped: [false, false, false], far: [false, false, false], custom: false };

describe('chaos in the run health', () => {
  it('says nothing without a finding', () => {
    expect(runtimeIssues(base).map((i) => i.id)).not.toContain('chaotic');
    expect(runtimeIssues({ ...base, chaos: null }).map((i) => i.id)).not.toContain('chaotic');
  });

  it('is a notice for a chaotic run and a warning for an extremely chaotic one, and offers to show it', () => {
    const chaotic = runtimeIssues({ ...base, chaos: { state: 'chaotic', lyapunovPeriods: 2, horizonPeriods: 50, elapsedPeriods: 3 } }).find((i) => i.id === 'chaotic')!;
    expect(chaotic.severity).toBe('info');
    expect(chaotic.fixes).toContain('twin');
    expect(chaotic.learn).toBe('chaos');
    expect(chaotic.detail).toMatch(/every 2\.0 orbits|every 2 orbits/);
    expect(chaotic.detail).toMatch(/about 50 orbits/);
    const very = runtimeIssues({ ...base, chaos: { state: 'very-chaotic', lyapunovPeriods: 0.3, horizonPeriods: 8, elapsedPeriods: 1 } }).find((i) => i.id === 'chaotic')!;
    expect(very.severity).toBe('warning');
    expect(very.title).toMatch(/extremely/);
  });

  it('adds a second warning once the run is past the point where the path can be trusted', () => {
    const before = runtimeIssues({ ...base, chaos: { state: 'chaotic', lyapunovPeriods: 2, horizonPeriods: 50, elapsedPeriods: 49 } });
    expect(before.map((i) => i.id)).not.toContain('chaos-horizon');
    const after = runtimeIssues({ ...base, chaos: { state: 'chaotic', lyapunovPeriods: 2, horizonPeriods: 50, elapsedPeriods: 51 } });
    expect(after.find((i) => i.id === 'chaos-horizon')?.severity).toBe('warning');
  });

  it('never pauses the run', () => {
    const issues = runtimeIssues({ ...base, chaos: { state: 'very-chaotic', lyapunovPeriods: 0.1, horizonPeriods: 2, elapsedPeriods: 99 } });
    expect(issues.filter((i) => i.id.startsWith('chaos')).some((i) => i.pause)).toBe(false);
  });
});

// ---- the controller -----------------------------------------------------------------------

class StubView implements ViewPort {
  setSystemScale(): void {}
  setCameraMode(): void {}
  recordSample(): void {}
  recordGhostSample(): void {}
  setGhost(): void {}
  clearTrails(): void {}
  start(): void {}
}

function controllerWithProbe(id: string): { controller: Controller; started: number[]; cancels: number[] } {
  const controller = new Controller(new StubView(), findPreset(id)!);
  const started: number[] = [];
  const cancels: number[] = [];
  controller.chaosProbe = (spec) => {
    const n = started.length;
    started.push(n);
    let cancelled = false;
    return {
      result: chaosProbe(spec, { cancelled: () => cancelled, progress: () => {}, yield: () => Promise.resolve() }),
      cancel: () => {
        cancels.push(n);
        cancelled = true;
      },
    };
  };
  return { controller, started, cancels };
}
const refresh = (c: Controller): void => (c as unknown as { updateReadout(): void }).updateReadout();

describe('the controller and the chaos probe', () => {
  it('does not start a probe for a pair, and says why', () => {
    const { controller, started } = controllerWithProbe('kepler-orbit');
    expect(controller.chaos.state).toBe('off');
    expect(controller.chaos.reason).toMatch(/two bodies/i);
    refresh(controller);
    expect(controller.readout.chaos).toBe('none: two bodies');
    expect(started).toHaveLength(0);
  });

  it('finds chaos in the sandbox, reports it in the numbers, and raises the notice', async () => {
    const { controller } = controllerWithProbe('sandbox');
    expect(controller.chaos.state).toBe('measuring');
    await controller.probeChaos();
    expect(['chaotic', 'very-chaotic']).toContain(controller.chaos.state);
    refresh(controller);
    expect(controller.readout.chaos).toMatch(/^(chaotic|extreme), e per [\d.]+ T$/);
    expect(controller.issues.map((i) => i.id)).toContain('chaotic');
  }, 60_000);

  it('raises nothing for a regular system', async () => {
    const { controller } = controllerWithProbe('lagrange');
    await controller.probeChaos();
    expect(controller.chaos.state).toBe('regular');
    refresh(controller);
    expect(controller.readout.chaos).toMatch(/^no sign in \d+ T$/);
    expect(controller.issues.map((i) => i.id)).not.toContain('chaotic');
  }, 60_000);

  it('marks the predictability horizon on the charts once, when the run passes it', async () => {
    const { controller } = controllerWithProbe('euler');
    await controller.probeChaos();
    refresh(controller);
    expect(controller.issues.map((i) => i.id)).not.toContain('chaos-horizon');
    controller.sim.state.t = 1e4 * controller.sim.reference.period; // far past any horizon, without stepping there
    refresh(controller);
    refresh(controller);
    expect(controller.issues.map((i) => i.id)).toContain('chaos-horizon');
    expect(controller.sampler.markers.filter((m) => m.label === 'predictability horizon')).toHaveLength(1);
  });

  it('restarts the probe on an edit, cancelling the old one, but keeps the verdict through a reset', async () => {
    const { controller, started, cancels } = controllerWithProbe('euler');
    await controller.probeChaos();
    const verdict = controller.chaos.state;
    expect(verdict).toBe('very-chaotic');
    controller.reset();
    expect(controller.chaos.state).toBe(verdict);
    expect(started).toHaveLength(1);

    const next = snapshot(controller.sim.state) as SystemState;
    next.m[2] *= 1.01;
    controller.edit(next, true);
    expect(controller.chaos.state).toBe('measuring');
    expect(controller.chaos.done).toBe(false);
    expect(cancels).toEqual([0]);
    await controller.probeChaos();
    expect(started).toHaveLength(2);
  });

  it('starts the probe a moment after a load, not on every frame of a slider drag', async () => {
    const { controller, started } = controllerWithProbe('lagrange');
    const frame = (controller as unknown as { frame(dt: number): SystemState }).frame.bind(controller);
    frame(0.1);
    frame(0.1);
    expect(started).toHaveLength(0);
    frame(0.3);
    expect(started).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    frame(0.1);
    expect(started).toHaveLength(1);
  });

  it('shows the probe\'s progress while it works', async () => {
    const controller = new Controller(new StubView(), findPreset('lagrange')!);
    let report: ((fraction: number) => void) | null = null;
    let finish: (v: ChaosVerdict) => void = () => {};
    controller.chaosProbe = (_spec, onProgress) => {
      report = onProgress;
      return { result: new Promise<ChaosVerdict>((resolve) => (finish = resolve)), cancel: () => {} };
    };
    const done = controller.probeChaos();
    expect(controller.chaos.state).toBe('measuring');
    (report as unknown as (f: number) => void)(0.4);
    refresh(controller);
    expect(controller.chaos.progress).toBe(0.4);
    expect(controller.readout.chaos).toBe('measuring 40%');
    finish({ ...createVerdict(), state: 'regular', done: true, probedPeriods: 48, progress: 1 });
    await done;
    expect(controller.chaos.state).toBe('regular');
  });

  it('survives a missing worker, and a probe that fails', async () => {
    const plain = new Controller(new StubView(), findPreset('lagrange')!);
    await plain.probeChaos();
    expect(plain.chaos.state).toBe('off');
    expect(plain.chaos.reason).toMatch(/worker/i);

    const broken = new Controller(new StubView(), findPreset('lagrange')!);
    broken.chaosProbe = () => ({ result: Promise.reject(new Error('worker blew up')), cancel: () => {} });
    await broken.probeChaos();
    expect(broken.chaos.state).toBe('inconclusive');
    expect(broken.chaos.reason).toBe('worker blew up');

    const throwing = new Controller(new StubView(), findPreset('lagrange')!);
    throwing.chaosProbe = () => {
      throw new Error('no Worker here');
    };
    await throwing.probeChaos();
    expect(throwing.chaos.state).toBe('inconclusive');
  });

  it('"Show me" starts a ghost twin', async () => {
    const { controller } = controllerWithProbe('sandbox');
    expect(controller.comparison).toBeNull();
    controller.applyFix('twin');
    expect(controller.comparison).not.toBeNull();
    expect(controller.comparison?.kind).toBe('twin');
  });
});

describe('createVerdict', () => {
  it('starts off and done', () => {
    const v = createVerdict();
    expect(v.state).toBe('off');
    expect(v.done).toBe(true);
  });
});
