import * as THREE from 'three';
import { BODY_COLORS } from './bodies';
import type { PlaneFrame } from './frame';

const POINT_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aColor;
  uniform float uSize;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_PointSize = uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POINT_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.38, r));
    #include <colorspace_fragment>
  }
`;

/** Footprint dot diameter, in CSS pixels. */
const DOT_PIXELS = 6;

/**
 * The depth cue for z: a line from each body straight down to the reference plane, and a dot
 * where it lands. A body's height above the plane is then the length of its line, and the
 * dots show the plan view whatever the camera angle.
 */
export class DropLines {
  readonly group = new THREE.Group();
  private readonly lineGeometry = new THREE.BufferGeometry();
  private readonly dotGeometry = new THREE.BufferGeometry();
  private readonly linePositions = new Float32Array(18);
  private readonly dotPositions = new Float32Array(9);
  private readonly lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 });
  private readonly dotMaterial: THREE.ShaderMaterial;
  private readonly lines: THREE.LineSegments;
  private readonly dots: THREE.Points;

  constructor() {
    const color = new THREE.Color();
    const lineColors = new Float32Array(18);
    const dotColors = new Float32Array(9);
    BODY_COLORS.forEach((hex, i) => {
      color.set(hex);
      for (const k of [0, 1]) color.toArray(lineColors, 6 * i + 3 * k);
      color.toArray(dotColors, 3 * i);
    });
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    this.dotGeometry.setAttribute('position', new THREE.BufferAttribute(this.dotPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.dotGeometry.setAttribute('aColor', new THREE.BufferAttribute(dotColors, 3));
    this.dotMaterial = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: DOT_PIXELS } },
      vertexShader: POINT_VERTEX_SHADER,
      fragmentShader: POINT_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.lineGeometry, this.lineMaterial);
    this.dots = new THREE.Points(this.dotGeometry, this.dotMaterial);
    for (const object of [this.lines, this.dots]) {
      object.frustumCulled = false; // the bounding sphere would be computed from stale vertices
      this.group.add(object);
    }
  }

  /**
   * Places the lines for bodies at world positions x. Both ends are computed in Float64 relative
   * to the floating origin, so what reaches the GPU is small.
   */
  update(x: Float64Array, origin: Float64Array, frame: PlaneFrame, pixelRatio: number): void {
    const n = frame.n;
    const planeD = frame.offsetFrom(origin);
    for (let i = 0; i < 3; i++) {
      const rx = x[3 * i] - origin[0];
      const ry = x[3 * i + 1] - origin[1];
      const rz = x[3 * i + 2] - origin[2];
      const height = n[0] * rx + n[1] * ry + n[2] * rz - planeD;
      const fx = rx - height * n[0];
      const fy = ry - height * n[1];
      const fz = rz - height * n[2];
      const l = 6 * i;
      this.linePositions[l] = rx;
      this.linePositions[l + 1] = ry;
      this.linePositions[l + 2] = rz;
      this.linePositions[l + 3] = fx;
      this.linePositions[l + 4] = fy;
      this.linePositions[l + 5] = fz;
      this.dotPositions[3 * i] = fx;
      this.dotPositions[3 * i + 1] = fy;
      this.dotPositions[3 * i + 2] = fz;
    }
    this.lineGeometry.attributes.position.needsUpdate = true;
    this.dotGeometry.attributes.position.needsUpdate = true;
    this.dotMaterial.uniforms.uSize.value = DOT_PIXELS * pixelRatio;
  }

  set visible(value: boolean) {
    this.group.visible = value;
  }

  dispose(): void {
    this.lineGeometry.dispose();
    this.dotGeometry.dispose();
    this.lineMaterial.dispose();
    this.dotMaterial.dispose();
  }
}
