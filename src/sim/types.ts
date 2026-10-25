// Core data model (plan §3). Types only, so sim/ stays DOM-free and import-free.
//
// Layout: 3 slots of 3 components each, stored body-major.
// x[3 * i + c] and v[3 * i + c] hold component c (0 = x, 1 = y, 2 = z) of body i.
//
// A system has n = 3 bodies, or n = 2: then slot 2 is absent, not a massless particle. It holds
// m = x = v = 0 for good, the force kernel skips it, and every loop over bodies stops at n.

/** How many bodies the system has. */
export type BodyCount = 2 | 3;

export interface SystemState {
  /** The number of bodies. In a 2-body system slot 2 is absent and stays all zeros. */
  n: BodyCount;
  /** Sim time. A negative direction is allowed (time reversal, plan §7.3). */
  t: number;
  /** Masses, length 3. A mass of 0 makes that body a test particle. Slot 2 is 0 when n = 2. */
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
