// Calibration of the live chaos probe (src/sim/chaos.ts) against every preset. Skipped unless asked:
//   STRESS=1 npx vitest run tests/stress/chaos.test.ts
import { describe, it } from 'vitest';
import { PRESETS } from '../../src/presets';
import { instantiate } from '../../src/presets/schema';
import { ChaosMonitor } from '../../src/sim/chaos';
import { Simulation } from '../../src/sim/simulation';

const suite = process.env.STRESS === '1' ? describe : describe.skip;

suite('chaos probe calibration', () => {
  it('prints the trailing-window Lyapunov time per preset as the probe runs', () => {
    const rows: string[] = [];
    for (const pr of PRESETS) {
      const inst = instantiate(pr);
      const sim = new Simulation(inst.state, { integrator: 'ias15', params: { dt: 0.01 }, load: { period: inst.period } });
      const monitor = new ChaosMonitor();
      monitor.start(sim.baselineSnapshot(), sim.reference.period, sim.reference.size);
      const t0 = performance.now();
      const series: string[] = [];
      let nextCheck = 4;
      while (monitor.tick(200)) {
        const v = monitor.verdict;
        if (v.probedPeriods >= nextCheck) {
          series.push(`${nextCheck}T:${Number.isFinite(v.lyapunovPeriods) ? v.lyapunovPeriods.toFixed(2) : 'inf'}`);
          nextCheck += 4;
        }
        if (performance.now() - t0 > 60_000) break;
      }
      const v = monitor.verdict;
      rows.push(`${pr.id.padEnd(24)} -> ${v.state.padEnd(13)} Tlyap=${Number.isFinite(v.lyapunovPeriods) ? v.lyapunovPeriods.toFixed(2) : 'inf'} probed=${v.probedPeriods.toFixed(1)}T wall=${((performance.now() - t0) / 1000).toFixed(1)}s ${v.reason}\n    ${series.join(' ')}`);
    }
    console.log('[stress] chaos probe\n' + rows.join('\n'));
  }, 1_800_000);
});
