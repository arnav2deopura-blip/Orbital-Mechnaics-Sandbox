import * as THREE from 'three';
import { computeAccel } from '../sim/forces';
import type { SystemState } from '../sim/types';
import { BODY_COLORS } from './bodies';

/** The longest an arrow gets for a vector as large as the typical one, as a fraction of the view distance. */
const TYPICAL_LENGTH = 0.12;
const ACCELERATION_COLOR = 0xff5a36;

/**
 * Velocity and acceleration arrows (plan §7.6), from each body, in 3D. Lengths are logarithmic,
 * length = L ln(1 + |v| / v_typical) / ln 2, so a body ten times faster than the typical one is
 * not drawn ten times as long: slow bodies still show a direction, and fast ones stay on screen.
 * The typical size is the RMS over the three bodies. Nothing here allocates per frame.
 */
export class VectorArrows {
  readonly group = new THREE.Group();
  private readonly velocity: THREE.ArrowHelper[];
  private readonly acceleration: THREE.ArrowHelper[];
  private readonly a = new Float64Array(9);
  private readonly direction = new THREE.Vector3();

  constructor() {
    const make = (color: number): THREE.ArrowHelper => {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, color);
      arrow.frustumCulled = false;
      this.group.add(arrow);
      return arrow;
    };
    this.velocity = BODY_COLORS.map((color) => make(new THREE.Color(color).getHex()));
    this.acceleration = BODY_COLORS.map(() => make(ACCELERATION_COLOR));
  }

  /**
   * Places the arrows for the state s, drawn relative to the floating origin, for a camera
   * `viewDistance` away. Either set can be hidden.
   */
  update(s: SystemState, origin: Float64Array, viewDistance: number, showVelocity: boolean, showAcceleration: boolean): void {
    this.group.visible = showVelocity || showAcceleration;
    if (!this.group.visible) return;
    this.place(this.velocity, s.v, s, origin, viewDistance, showVelocity);
    if (showAcceleration) computeAccel(s, s.x, this.a); // not counted: this is for drawing
    this.place(this.acceleration, this.a, s, origin, viewDistance, showAcceleration);
  }

  private place(
    arrows: THREE.ArrowHelper[],
    vectors: Float64Array,
    s: SystemState,
    origin: Float64Array,
    viewDistance: number,
    visible: boolean,
  ): void {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += vectors[i] * vectors[i];
    const typical = Math.sqrt(sum / s.n);
    for (let i = 0; i < 3; i++) {
      const arrow = arrows[i];
      if (i >= s.n) {
        arrow.visible = false;
        continue;
      }
      const vx = vectors[3 * i];
      const vy = vectors[3 * i + 1];
      const vz = vectors[3 * i + 2];
      const size = Math.hypot(vx, vy, vz);
      arrow.visible = visible && size > 0 && typical > 0;
      if (!arrow.visible) continue;
      const length = arrowLength(size, typical, viewDistance);
      arrow.position.set(s.x[3 * i] - origin[0], s.x[3 * i + 1] - origin[1], s.x[3 * i + 2] - origin[2]);
      arrow.setDirection(this.direction.set(vx / size, vy / size, vz / size));
      arrow.setLength(length, 0.2 * length, 0.1 * length);
    }
  }

  dispose(): void {
    for (const arrow of [...this.velocity, ...this.acceleration]) arrow.dispose();
  }
}

/** The length an arrow is drawn at, for tests: L ln(1 + size / typical) / ln 2 with L the view distance times TYPICAL_LENGTH. */
export function arrowLength(size: number, typical: number, viewDistance: number): number {
  return (TYPICAL_LENGTH * viewDistance * Math.log1p(size / typical)) / Math.LN2;
}
