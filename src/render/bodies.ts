import * as THREE from 'three';

/** Gold, cornflower, bone: apart under protan, deutan and tritan vision, and each readable on the night plate. */
export const BODY_COLORS = ['#f2b84b', '#6aa6ff', '#ece8dc'] as const;

/**
 * The three body spheres (plan §7.6). The displayed radius is proportional to m^(1/3) and
 * clamped to a minimum size in pixels. It is a visual aid, not a physical radius.
 *
 * Lambert shaded, with some emission so the dark side never goes black: the shading is what
 * makes them read as spheres, and so as being at a depth. The scene supplies the lights.
 */
export class Bodies {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(1, 24, 16);
  private readonly materials: THREE.MeshLambertMaterial[];
  private readonly meshes: THREE.Mesh[];

  /** `opacity` below 1 makes ghost bodies, for drawing a second run over the first. */
  constructor(opacity = 1) {
    this.materials = BODY_COLORS.map(
      (color) =>
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, transparent: opacity < 1, opacity }),
    );
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
   * minRadius the smallest radius to show (the world size of the minimum pixel size). n is how many bodies there are.
   */
  update(x: Float64Array, m: Float64Array, origin: Float64Array, referenceRadius: number, minRadius: number, n = 3): void {
    const heaviest = Math.max(m[0], m[1], m[2]);
    for (let i = 0; i < 3; i++) {
      const mesh = this.meshes[i];
      mesh.visible = i < n; // with two bodies, the third is absent
      if (i >= n) continue;
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
