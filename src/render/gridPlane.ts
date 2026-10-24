import * as THREE from 'three';

// A grid drawn on one quad, in the fragment shader. Lines are antialiased with fwidth() and fade
// out radially, so the grid has no hard edge however the camera tilts. Two line weights: cells
// of `uCell`, and heavier lines every tenth cell.
//
// The lines are fixed in world space. The quad is placed in render space (the floating origin),
// and `uCenter` carries the world position of the quad's center along the plane's two axes,
// reduced modulo ten cells in Float64 on the CPU, so the shader only ever sees small numbers.

const VERTEX_SHADER = /* glsl */ `
  uniform float uExtent;
  varying vec2 vPlane;
  void main() {
    vPlane = position.xy * uExtent;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 uCenter;
  uniform float uCell;
  uniform float uExtent;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vPlane;

  // 1 on a line of the grid with the given spacing, antialiased to about one pixel.
  float lines(vec2 coord, float spacing) {
    vec2 g = coord / spacing;
    vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    return 1.0 - min(min(d.x, d.y), 1.0);
  }

  void main() {
    vec2 world = vPlane + uCenter;
    float minor = lines(world, uCell) * 0.35;
    float major = lines(world, 10.0 * uCell) * 0.85;
    float fade = 1.0 - smoothstep(0.3, 1.0, length(vPlane) / uExtent);
    float alpha = max(minor, major) * fade * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`;

const shared = { geometry: null as THREE.PlaneGeometry | null, users: 0 };

/** Euclidean remainder into [0, modulus). */
export function wrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export class GridPlane {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(color: THREE.ColorRepresentation, opacity: number) {
    shared.geometry ??= new THREE.PlaneGeometry(2, 2);
    shared.users++;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uCell: { value: 1 },
        uExtent: { value: 1 },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(shared.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = -1; // behind the trails and bodies
  }

  /**
   * Puts the quad on the plane spanned by u and v (unit vectors, Float64) with its center at
   * `center` in render space, reaching `extent` out along each. `origin` is the floating origin,
   * so world = render + origin, and the grid lines sit on multiples of `cell` in world
   * coordinates along u and v.
   */
  place(
    u: Float64Array,
    v: Float64Array,
    normal: Float64Array,
    center: Float64Array,
    origin: Float64Array,
    cell: number,
    extent: number,
  ): void {
    this.mesh.matrix.set(
      u[0] * extent, v[0] * extent, normal[0], center[0],
      u[1] * extent, v[1] * extent, normal[1], center[1],
      u[2] * extent, v[2] * extent, normal[2], center[2],
      0, 0, 0, 1,
    );
    this.mesh.matrixWorldNeedsUpdate = true;
    const period = 10 * cell;
    const worldU = u[0] * (center[0] + origin[0]) + u[1] * (center[1] + origin[1]) + u[2] * (center[2] + origin[2]);
    const worldV = v[0] * (center[0] + origin[0]) + v[1] * (center[1] + origin[1]) + v[2] * (center[2] + origin[2]);
    const uniforms = this.material.uniforms;
    (uniforms.uCenter.value as THREE.Vector2).set(wrap(worldU, period), wrap(worldV, period));
    uniforms.uCell.value = cell;
    uniforms.uExtent.value = extent;
  }

  set visible(value: boolean) {
    this.mesh.visible = value;
  }

  dispose(): void {
    this.material.dispose();
    if (--shared.users === 0) {
      shared.geometry?.dispose();
      shared.geometry = null;
    }
  }
}
