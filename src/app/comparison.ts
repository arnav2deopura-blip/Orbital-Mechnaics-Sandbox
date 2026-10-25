import { Sampler } from '../sim/sampler';
import { Simulation } from '../sim/simulation';
import { snapshot } from '../sim/state';
import { nudge } from '../sim/transforms';
import type { Nudge } from '../sim/transforms';
import type { Integrator, IntegratorId } from '../sim/integrators/types';
import type { SystemState } from '../sim/types';

// Comparison mode (plan §7.4): a second Simulation started from the same state as the first, run
// to the same time target and drawn over it as a ghost, with its own history for the charts and
// a divergence measure between the two.
//
// There are two uses. A "twin" is the same method with a tiny nudge to one body, which shows
// sensitive dependence on initial conditions as exponential divergence in a chaotic system. A
// "method" comparison runs a different integrator or step size on the identical start.

export interface ComparisonOptions {
  /** 'twin': the same method as the source, with `nudge` applied. 'method': `integrator` and `dt` as given. */
  kind: 'twin' | 'method';
  integrator?: IntegratorId;
  symplecticEuler?: boolean;
  dt?: number;
  /** A twin's nudge, applied to the copy only. Without one the twin is an exact copy. */
  nudge?: Nudge;
  /** Random numbers for a random nudge direction. */
  rng?: () => number;
  clock?: () => number;
}

export class Comparison {
  readonly kind: ComparisonOptions['kind'];
  readonly sim: Simulation;
  /** The twin's own diagnostic history, drawn on the same axes as the first run's. */
  readonly sampler = new Sampler();
  /** The latest divergence between the two runs, NaN before the first measurement. */
  divergence = NaN;

  /**
   * Starts from the source's current state, time included, with the source's direction and
   * settings, except those `options` change. The state is not re-centered: it already is.
   */
  constructor(source: Simulation, options: ComparisonOptions) {
    this.kind = options.kind;
    const initial = snapshot(source.state);
    if (options.kind === 'twin' && options.nudge) nudge(initial, options.nudge, options.rng);
    const id = options.kind === 'method' ? (options.integrator ?? source.integrator.id) : source.integrator.id;
    const { counters: _counters, ...params } = source.params;
    this.sim = new Simulation(initial, {
      integrator: id,
      symplecticEuler: options.kind === 'method' ? options.symplecticEuler : source.integrator.symplectic && source.integrator.id === 'euler',
      params: { ...params, dt: options.dt ?? source.params.dt },
      clock: options.clock,
      load: { recenter: false },
    });
    this.sim.setDirection(source.direction);
    this.sampler.clear(source.reference.period);
    this.sampler.record(this.sim);
  }

  /**
   * The largest distance between a body of the first run and the same body of the twin, at the
   * time the loop is drawing. When both are at the same time (the same fixed step from the same
   * start) the true states are compared exactly; otherwise the interpolated ones, which carry
   * the interpolation's error, small beside any divergence worth looking at.
   */
  measure(source: Simulation, drawn: SystemState, drawnTwin: SystemState): number {
    const sameTime = source.state.t === this.sim.state.t;
    const a = sameTime ? source.state.x : drawn.x;
    const b = sameTime ? this.sim.state.x : drawnTwin.x;
    let worst = 0;
    for (let i = 0; i < 3; i++) {
      worst = Math.max(worst, Math.hypot(a[3 * i] - b[3 * i], a[3 * i + 1] - b[3 * i + 1], a[3 * i + 2] - b[3 * i + 2]));
    }
    this.divergence = worst;
    return worst;
  }
}

/**
 * The step for `other` that costs the same force evaluations per unit time as `reference` does
 * with `dt` (plan §7.1, "equalize cost"): RK4 takes four evaluations a step, so dt_RK4 = 4 dt_leapfrog.
 * Null when either method's cost per step varies (IAS15).
 */
export function equalizedDt(dt: number, reference: Integrator, other: Integrator): number | null {
  const a = reference.forceEvalsPerStep;
  const b = other.forceEvalsPerStep;
  return typeof a === 'number' && typeof b === 'number' ? (dt * b) / a : null;
}
