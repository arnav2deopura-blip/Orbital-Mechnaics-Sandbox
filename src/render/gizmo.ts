import * as THREE from 'three';
import type { PlaneFrame } from './frame';

/** Side of the square the gizmo is drawn in, and its distance from the top left corner, in CSS pixels. */
const SIZE = 96;
const MARGIN = 12;
/** Where the label sits along its axis, past the tip. */
const LABEL_REACH = 1.25;

const AXIS_COLORS = [0xff6b6b, 0x69db7c, 0x74c0fc];
const PLAIN_LABELS = ['x', 'y', 'z'];
const ANGULAR_LABELS = ['u', 'v', 'L'];

/**
 * A small x, y, z indicator in the corner that turns with the camera. It follows the plane frame:
 * when the plane is perpendicular to the angular momentum, its axes are the in-plane directions
 * u and v and L.
 */
export class AxesGizmo {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(18);
  private readonly labels: HTMLDivElement[];
  private readonly viewport = new THREE.Vector4();
  private readonly size = new THREE.Vector2();
  private readonly tip = new THREE.Vector3();
  private angular: boolean | null = null;

  constructor(host: HTMLElement) {
    const colors = new Float32Array(18);
    const color = new THREE.Color();
    AXIS_COLORS.forEach((hex, i) => {
      color.set(hex);
      color.toArray(colors, 6 * i);
      color.toArray(colors, 6 * i + 3);
    });
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(this.geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
    lines.frustumCulled = false;
    this.scene.add(lines);

    this.labels = AXIS_COLORS.map((hex) => {
      const label = document.createElement('div');
      label.style.cssText =
        'position:absolute;pointer-events:none;font:600 12px/1 ui-monospace,monospace;' +
        `color:#${hex.toString(16)};transform:translate(-50%,-50%);user-select:none`;
      host.appendChild(label);
      return label;
    });
  }

  /** Draws the gizmo over the already rendered scene, and moves its labels. */
  render(renderer: THREE.WebGLRenderer, main: THREE.Camera, frame: PlaneFrame, visible: boolean): void {
    for (const label of this.labels) label.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    if (frame.angular !== this.angular) {
      this.angular = frame.angular;
      const names = frame.angular ? ANGULAR_LABELS : PLAIN_LABELS;
      this.labels.forEach((label, i) => (label.textContent = names[i]));
    }
    const axes = [frame.e1, frame.e2, frame.n];
    for (let i = 0; i < 3; i++) {
      // Segment i runs from the origin to the axis tip; the first vertex stays at 0.
      for (let c = 0; c < 3; c++) this.positions[6 * i + 3 + c] = axes[i][c];
    }
    this.geometry.attributes.position.needsUpdate = true;

    this.camera.quaternion.copy(main.quaternion);
    this.camera.position.set(0, 0, 5).applyQuaternion(this.camera.quaternion);
    this.camera.updateMatrixWorld();

    this.labels.forEach((label, i) => {
      this.tip.set(axes[i][0], axes[i][1], axes[i][2]).multiplyScalar(LABEL_REACH).project(this.camera);
      label.style.left = `${MARGIN + (this.tip.x * 0.5 + 0.5) * SIZE}px`;
      label.style.top = `${MARGIN + (0.5 - this.tip.y * 0.5) * SIZE}px`;
    });

    const autoClear = renderer.autoClear;
    const scissorTest = renderer.getScissorTest();
    renderer.getViewport(this.viewport);
    renderer.getSize(this.size);
    const y = this.size.y - SIZE - MARGIN; // viewports count up from the bottom
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setViewport(MARGIN, y, SIZE, SIZE);
    renderer.setScissor(MARGIN, y, SIZE, SIZE);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setViewport(this.viewport);
    renderer.setScissorTest(scissorTest);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const label of this.labels) label.remove();
  }
}
