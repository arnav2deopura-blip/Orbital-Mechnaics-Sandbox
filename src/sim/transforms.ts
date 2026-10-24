import { characteristicSpeed, createDiagnostics, measure, systemSize } from './diagnostics';
import type { SystemState } from './types';

// Edits of a state that are not "set this number" (plan §4.7, §7.2): turning the whole system,
// and nudging one body. Both work on a state in place, and the caller hands the result to
// Controller.edit(), which re-baselines the diagnostics.

export type Axis = 'x' | 'y' | 'z';

/**
 * Turns every position and velocity about an axis through the origin, by `degrees` (right-handed).
 * A rigid rotation is a symmetry of the equations of motion, so energy, momentum and angular
 * momentum keep their magnitudes: only the plane of the motion turns.
 */
export function rotateState(s: SystemState, axis: Axis, degrees: number): void {
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  // The two components the axis does not touch, as (first, second) of a right-handed turn.
  const a = axis === 'x' ? 1 : axis === 'y' ? 2 : 0;
  const b = axis === 'x' ? 2 : axis === 'y' ? 0 : 1;
  for (const arr of [s.x, s.v]) {
    for (let i = 0; i < 3; i++) {
      const p = arr[3 * i + a];
      const q = arr[3 * i + b];
      arr[3 * i + a] = c * p - sn * q;
      arr[3 * i + b] = sn * p + c * q;
    }
  }
}

export type NudgeDirection = Axis | 'normal' | 'random';

export interface Nudge {
  /** 0, 1 or 2. */
  body: number;
  target: 'position' | 'velocity';
  /** 'normal' is the direction of the total angular momentum (z if it has none): out of the orbital plane. */
  direction: NudgeDirection;
  /**
   * The size of the nudge as a fraction of the system: of its size for a position, and of its
   * characteristic speed for a velocity. 1e-12 to 1e-2 covers roundoff up to a visible kick.
   */
  size: number;
}

/**
 * Adds a small displacement or velocity kick to one body (plan §7.2). `random` draws the
 * direction uniformly on the sphere from `rng`, a function returning numbers in [0, 1).
 * Returns the unit direction used.
 */
export function nudge(s: SystemState, spec: Nudge, rng: () => number = Math.random): [number, number, number] {
  const dir: [number, number, number] = [0, 0, 0];
  if (spec.direction === 'x') dir[0] = 1;
  else if (spec.direction === 'y') dir[1] = 1;
  else if (spec.direction === 'z') dir[2] = 1;
  else if (spec.direction === 'normal') normalTo(s, dir);
  else {
    // Uniform on the sphere: z uniform in [-1, 1], azimuth uniform.
    const z = 2 * rng() - 1;
    const phi = 2 * Math.PI * rng();
    const r = Math.sqrt(1 - z * z);
    dir[0] = r * Math.cos(phi);
    dir[1] = r * Math.sin(phi);
    dir[2] = z;
  }
  const scale = spec.target === 'position' ? systemSize(s) : characteristicSpeed(s);
  const target = spec.target === 'position' ? s.x : s.v;
  for (let c = 0; c < 3; c++) target[3 * spec.body + c] += spec.size * scale * dir[c];
  return dir;
}

/** The unit direction of the angular momentum about the center of mass, or z when it is negligible. */
function normalTo(s: SystemState, out: [number, number, number]): void {
  const d = createDiagnostics();
  measure(s, d);
  const M = s.m[0] + s.m[1] + s.m[2];
  let lx = d.L[0];
  let ly = d.L[1];
  let lz = d.L[2];
  let scale = 0;
  for (let i = 0; i < 3; i++) {
    scale += s.m[i] * Math.hypot(s.x[3 * i], s.x[3 * i + 1], s.x[3 * i + 2]) * Math.hypot(s.v[3 * i], s.v[3 * i + 1], s.v[3 * i + 2]);
  }
  if (M > 0) {
    // About the COM: remove the part due to the COM's own motion, R x P.
    lx -= d.com[1] * d.P[2] - d.com[2] * d.P[1];
    ly -= d.com[2] * d.P[0] - d.com[0] * d.P[2];
    lz -= d.com[0] * d.P[1] - d.com[1] * d.P[0];
  }
  const l = Math.hypot(lx, ly, lz);
  if (l > 1e-6 * scale && l > 0) {
    out[0] = lx / l;
    out[1] = ly / l;
    out[2] = lz / l;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 1;
  }
}
