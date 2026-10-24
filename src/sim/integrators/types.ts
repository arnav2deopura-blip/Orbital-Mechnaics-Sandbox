import type { CostCounters, SystemState } from '../types';

export type IntegratorId = 'euler' | 'leapfrog' | 'rk4' | 'wh' | 'ias15';

/**
 * Settings handed to init(). The integrator keeps this object by reference, so the
 * controller can change dt between steps (plan §4.7) with no setter.
 * Methods with more knobs (WH central body, IAS15 tolerances) will extend it.
 */
export interface IntegratorParams {
  /** Step size magnitude, finite and > 0. The sign comes from setDirection(). IAS15 uses it only as the first guess. */
  dt: number;
  /** Shared with the owning Simulation. The force kernel increments forceEvals. Simulation owns stepCount. */
  counters: CostCounters;
  /** WH only, read by init(): the body the others orbit. Defaults to the most massive. */
  centralBody?: 0 | 1 | 2;
  /** IAS15 only: tolerance on the last acceleration coefficient relative to the acceleration. Default 1e-9. */
  epsTol?: number;
  /** IAS15 only: smallest and largest step magnitudes, read every step. Default: no limits. */
  dtMin?: number;
  dtMax?: number;
}

/** Plan §3. All scratch memory is allocated in init(); step() must not allocate. */
export interface Integrator {
  readonly id: IntegratorId;
  readonly order: number;
  readonly symplectic: boolean;
  readonly adaptive: boolean;
  forceEvalsPerStep: number | 'variable';

  /**
   * Allocates scratch and drops any history. A fresh integrator steps forward, so call
   * setDirection() afterwards when switching methods mid-run in reverse (plan §4.7).
   */
  init(s: SystemState, p: IntegratorParams): void;
  /**
   * Advances s in place, including s.t. Returns the signed dt actually taken. An adaptive method
   * that cannot take a step at all (IAS15 on a NaN state) leaves s unchanged and returns 0, which
   * the caller must treat as a failure. The fixed-step methods never return 0.
   */
  step(s: SystemState): number;
  /** Drops cached history. Call after anything outside step() changes s (edits, rollback to prev). */
  reset(): void;
  /**
   * Dense output (plan §4.5): position and velocity at the fraction h of the most recent step
   * (0 is its start, 1 its end), from the polynomial that took it. Only methods that have one
   * (IAS15) define it; the rest are interpolated from the step's end points.
   */
  dense?(h: number, xOut: Float64Array, vOut: Float64Array): void;
  setDirection(sign: 1 | -1): void;
}
