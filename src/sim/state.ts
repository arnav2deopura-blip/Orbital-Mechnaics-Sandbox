import type { CostCounters, SystemState } from './types';

export const NUM_BODIES = 3;
export const DIM = 3;
/** Length of the x and v arrays. */
export const STATE_LEN = NUM_BODIES * DIM;

// createState, snapshot and createCounters allocate. Call them at init time only,
// never inside step() or computeAccel() (allocation rule, plan §3).

/** A zeroed state at t = 0. */
export function createState(G = 1, eps2 = 0): SystemState {
  return {
    t: 0,
    m: new Float64Array(NUM_BODIES),
    x: new Float64Array(STATE_LEN),
    v: new Float64Array(STATE_LEN),
    G,
    eps2,
  };
}

export function createCounters(): CostCounters {
  return { stepCount: 0, forceEvals: 0, rejectedSteps: 0 };
}

/** Independent deep copy of s. */
export function snapshot(s: SystemState): SystemState {
  const out = createState(s.G, s.eps2);
  copyState(s, out);
  return out;
}

/** Copies src into dst in place and allocates nothing, so it is safe in the step loop (e.g. prev <- state). */
export function copyState(src: SystemState, dst: SystemState): void {
  dst.t = src.t;
  dst.m.set(src.m);
  dst.x.set(src.x);
  dst.v.set(src.v);
  dst.G = src.G;
  dst.eps2 = src.eps2;
}
