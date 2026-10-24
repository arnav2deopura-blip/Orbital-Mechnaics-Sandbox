// Core data model (plan §3). Types only, so sim/ stays DOM-free and import-free.
//
// Layout: exactly 3 bodies, 3 components each, stored body-major.
// x[3 * i + c] and v[3 * i + c] hold component c (0 = x, 1 = y, 2 = z) of body i.

export interface SystemState {
  /** Sim time. A negative direction is allowed (time reversal, plan §7.3). */
  t: number;
  /** Masses, length 3. A mass of 0 makes that body a test particle. */
  m: Float64Array;
  /** Inertial positions in the COM frame, length 9. */
  x: Float64Array;
  /** Inertial velocities in the COM frame, length 9. */
  v: Float64Array;
  G: number;
  /** Softening length squared. 0 is pure Newtonian gravity. */
  eps2: number;
}

/** Cost metrics (plan §3). Fair integrator comparisons are made in force evaluations. */
export interface CostCounters {
  stepCount: number;
  forceEvals: number;
  rejectedSteps: number;
}
