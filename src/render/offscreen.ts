import * as THREE from 'three';
import { BODY_COLORS } from './bodies';

// Arrows at the edge of the view pointing at bodies that are off screen, so a body that has been
// thrown out is not simply gone. Three DOM elements over the canvas, moved each frame while a
// body is off screen.

/** How far in from the edge the arrows sit, in CSS pixels. */
const INSET = 22;

/**
 * Where a point (relative to the render origin) sits as the camera sees it: in normalized device
 * coordinates, x to the right and y up, so |x| and |y| above 1 is outside the picture. `visible` is
 * whether it is drawn at all: in front of the camera, between the near and far planes, and inside the
 * picture. A body that is not visible gets an arrow in the direction x, y. `scratch` is only workspace.
 */
export function arrowTarget(point: THREE.Vector3, camera: THREE.Camera, scratch: THREE.Vector3): { visible: boolean; x: number; y: number } {
  scratch.copy(point).applyMatrix4(camera.matrixWorldInverse);
  // A perspective camera projects what is behind it mirrored through the center (the sign of w), and
  // the depth z of clip space says nothing about which side that is: ask the depth in the camera's own frame.
  // An orthographic one does not mirror.
  const mirrored = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true && scratch.z > 0;
  scratch.applyMatrix4(camera.projectionMatrix);
  const x = mirrored ? -scratch.x : scratch.x;
  const y = mirrored ? -scratch.y : scratch.y;
  const visible = !mirrored && scratch.z >= -1 && scratch.z <= 1 && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  return { visible, x, y };
}

export class OffscreenMarkers {
  private readonly markers: HTMLDivElement[];
  private readonly shown = [false, false, false];
  private readonly point = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  constructor(host: HTMLElement) {
    this.markers = BODY_COLORS.map((color, i) => {
      const marker = document.createElement('div');
      marker.className = 'offscreen-marker';
      marker.title = `Body ${i + 1} is off screen`;
      marker.style.setProperty('--marker-color', color);
      marker.innerHTML = `<span class="offscreen-arrow"></span><span class="offscreen-label">${i + 1}</span>`;
      marker.style.display = 'none';
      host.appendChild(marker);
      return marker;
    });
  }

  /**
   * Places the arrows for positions x (world) seen from `camera`, with the render origin at o.
   * width and height are the canvas size in CSS pixels.
   */
  update(x: Float64Array, o: Float64Array, camera: THREE.Camera, width: number, height: number, bodies = 3): void {
    const p = this.point;
    for (let i = 0; i < 3; i++) {
      if (i >= bodies) {
        this.show(i, false);
        continue;
      }
      p.set(x[3 * i] - o[0], x[3 * i + 1] - o[1], x[3 * i + 2] - o[2]);
      const target = arrowTarget(p, camera, this.scratch);
      let nx = target.x;
      let ny = target.y;
      if (target.visible) {
        this.show(i, false);
        continue;
      }
      // Scale the direction from the center until it meets the inset border.
      const halfW = width / 2 - INSET;
      const halfH = height / 2 - INSET;
      let px = nx * (width / 2);
      let py = -ny * (height / 2);
      if (px === 0 && py === 0) py = halfH;
      const scale = Math.min(halfW / Math.abs(px || 1e-9), halfH / Math.abs(py || 1e-9));
      px *= scale;
      py *= scale;
      nx = width / 2 + px;
      ny = height / 2 + py;
      const angle = Math.atan2(py, px);
      const marker = this.markers[i];
      marker.style.transform = `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px)`;
      (marker.firstElementChild as HTMLElement).style.transform = `rotate(${angle.toFixed(3)}rad)`;
      this.show(i, true);
    }
  }

  hide(): void {
    for (let i = 0; i < 3; i++) this.show(i, false);
  }

  dispose(): void {
    for (const marker of this.markers) marker.remove();
  }

  private show(i: number, on: boolean): void {
    if (this.shown[i] === on) return;
    this.shown[i] = on;
    this.markers[i].style.display = on ? 'flex' : 'none';
  }
}
