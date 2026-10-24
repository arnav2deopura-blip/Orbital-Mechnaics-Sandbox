// The reference plane the 3D view is drawn against: its orientation (an orthonormal frame
// e1, e2, n) and a point it passes through. The floor grid, the back walls, the drop lines and
// shadows, the axes gizmo and the snap views all use it, so they always agree.
//
// Two orientations. 'xy' is z = 0 through the world origin. 'angular' is the plane through the
// center of mass perpendicular to the total angular momentum L: the system's natural plane.
// For three bodies under a pairwise central force L is conserved, so that plane never moves, and
// planar orbits stay in it.

export type PlaneMode = 'xy' | 'angular';

/** L below this fraction of sum m|r||v| has no meaningful direction (figure-eight: zero), so 'angular' falls back to 'xy'. */
const L_NEGLIGIBLE = 1e-6;
/** Where the 'top' snap view tilts away from straight on, so the screen's up direction is defined. */
const TOP_TILT = 1e-3;

/** A right-handed orthonormal frame e1 x e2 = n, and a point on the plane. All Float64. */
export class PlaneFrame {
  readonly e1 = Float64Array.of(1, 0, 0);
  readonly e2 = Float64Array.of(0, 1, 0);
  readonly n = Float64Array.of(0, 0, 1);
  /** A world point the plane passes through. */
  readonly point = new Float64Array(3);
  /** True when the plane follows L; false for z = 0, whether chosen or fallen back to. */
  angular = false;

  /** The plane's signed distance from the floating origin along n, subtracted in Float64: the plane is n.p = d in render space. */
  offsetFrom(origin: Float64Array): number {
    const { n, point } = this;
    return n[0] * (point[0] - origin[0]) + n[1] * (point[1] - origin[1]) + n[2] * (point[2] - origin[2]);
  }
}

/**
 * Sets frame for the given mode from the state (positions x, velocities v, masses m, each in the
 * layout of SystemState). 'angular' uses L about the center of mass. Allocates nothing.
 */
export function updatePlaneFrame(
  mode: PlaneMode,
  x: Float64Array,
  v: Float64Array,
  m: Float64Array,
  frame: PlaneFrame,
): void {
  frame.angular = false;
  const { e1, e2, n, point } = frame;
  e1[0] = 1;
  e1[1] = 0;
  e1[2] = 0;
  e2[0] = 0;
  e2[1] = 1;
  e2[2] = 0;
  n[0] = 0;
  n[1] = 0;
  n[2] = 1;
  point.fill(0);
  if (mode !== 'angular') return;

  const M = m[0] + m[1] + m[2];
  if (!(M > 0)) return;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (let i = 0; i < 3; i++) {
    cx += m[i] * x[3 * i];
    cy += m[i] * x[3 * i + 1];
    cz += m[i] * x[3 * i + 2];
    vx += m[i] * v[3 * i];
    vy += m[i] * v[3 * i + 1];
    vz += m[i] * v[3 * i + 2];
  }
  cx /= M;
  cy /= M;
  cz /= M;
  vx /= M;
  vy /= M;
  vz /= M;

  let lx = 0;
  let ly = 0;
  let lz = 0;
  let scale = 0;
  for (let i = 0; i < 3; i++) {
    const rx = x[3 * i] - cx;
    const ry = x[3 * i + 1] - cy;
    const rz = x[3 * i + 2] - cz;
    const ux = v[3 * i] - vx;
    const uy = v[3 * i + 1] - vy;
    const uz = v[3 * i + 2] - vz;
    lx += m[i] * (ry * uz - rz * uy);
    ly += m[i] * (rz * ux - rx * uz);
    lz += m[i] * (rx * uy - ry * ux);
    scale += m[i] * Math.hypot(rx, ry, rz) * Math.hypot(ux, uy, uz);
  }
  const l = Math.hypot(lx, ly, lz);
  if (!(l > L_NEGLIGIBLE * scale) || !(l > 0)) return;

  n[0] = lx / l;
  n[1] = ly / l;
  n[2] = lz / l;
  // e1: the world x axis, or y if L is nearly along x, with its component along n removed.
  const rx = Math.abs(n[0]) > 0.9 ? 0 : 1;
  const ry = 1 - rx;
  const dot = rx * n[0] + ry * n[1];
  e1[0] = rx - dot * n[0];
  e1[1] = ry - dot * n[1];
  e1[2] = -dot * n[2];
  const len = Math.hypot(e1[0], e1[1], e1[2]);
  e1[0] /= len;
  e1[1] /= len;
  e1[2] /= len;
  // e2 = n x e1
  e2[0] = n[1] * e1[2] - n[2] * e1[1];
  e2[1] = n[2] * e1[0] - n[0] * e1[2];
  e2[2] = n[0] * e1[1] - n[1] * e1[0];
  point[0] = cx;
  point[1] = cy;
  point[2] = cz;
  frame.angular = true;
}

export type SnapView = 'top' | 'front' | 'side' | 'iso';

/**
 * Writes the unit direction from the focus to the camera for a snap view, in world coordinates.
 * Relative to the frame: 'top' looks down the normal onto the plane, 'front' along e2 (so e1 is to
 * the right and n is up), 'side' along -e1, and 'iso' from a corner.
 */
export function snapDirection(view: SnapView, frame: PlaneFrame, out: Float64Array): void {
  let a = 0; // along e1
  let b = 0; // along e2
  let c = 0; // along n
  switch (view) {
    case 'top':
      b = -TOP_TILT;
      c = 1;
      break;
    case 'front':
      b = -1;
      break;
    case 'side':
      a = 1;
      break;
    case 'iso':
      a = 0.35;
      b = -0.7;
      c = 0.62;
      break;
  }
  const len = Math.hypot(a, b, c);
  for (let i = 0; i < 3; i++) out[i] = (a * frame.e1[i] + b * frame.e2[i] + c * frame.n[i]) / len;
}
