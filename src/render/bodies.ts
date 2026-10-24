import * as THREE from 'three';

export const BODY_COLORS = ['#ffd166', '#06d6a0', '#4cc9f0'] as const;

/**
 * The three body spheres (plan §7.6). The displayed radius is proportional to m^(1/3) and
 * clamped to a minimum size in pixels. It is a visual aid, not a physical radius.
 */
export class Bodies {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(1, 24, 16);
  private readonly materials: THREE.MeshBasicMaterial[];
  private readonly meshes: THREE.Mesh[];

  constructor() {
    this.materials = BODY_COLORS.map((color) => new THREE.MeshBasicMaterial({ color }));
    this.meshes = this.materials.map((material) => {
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
  }

  /**
   * Places the spheres at x - origin (both Float64, so the subtraction is exact enough that the
   * result is small and safe to hand to the GPU) and sizes them.
   *
   * referenceRadius is the display radius of the heaviest body in world units, and
   * minRadius the smallest radius to show (the world size of the minimum pixel size).
   */
  update(x: Float64Array, m: Float64Array, origin: Float64Array, referenceRadius: number, minRadius: number): void {
    const heaviest = Math.max(m[0], m[1], m[2]);
    for (let i = 0; i < 3; i++) {
      const mesh = this.meshes[i];
      mesh.position.set(x[3 * i] - origin[0], x[3 * i + 1] - origin[1], x[3 * i + 2] - origin[2]);
      const radius = heaviest > 0 ? referenceRadius * Math.cbrt(m[i] / heaviest) : 0;
      mesh.scale.setScalar(Math.max(radius, minRadius));
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
