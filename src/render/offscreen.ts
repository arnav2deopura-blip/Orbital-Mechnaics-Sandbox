import * as THREE from 'three';
import { BODY_COLORS } from './bodies';

// Arrows at the edge of the view pointing at bodies that are off screen, so a body that has been
// thrown out is not simply gone. Three DOM elements over the canvas, moved each frame while a
// body is off screen.

/** How far in from the edge the arrows sit, in CSS pixels. */
const INSET = 22;

export class OffscreenMarkers {
  private readonly markers: HTMLDivElement[];
  private readonly shown = [false, false, false];
  private readonly point = new THREE.Vector3();

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
  update(x: Float64Array, o: Float64Array, camera: THREE.Camera, width: number, height: number): void {
    const p = this.point;
    for (let i = 0; i < 3; i++) {
      p.set(x[3 * i] - o[0], x[3 * i + 1] - o[1], x[3 * i + 2] - o[2]).project(camera);
      // project() mirrors points behind the camera through the center: flip them back so the arrow points the right way.
      const behind = p.z > 1;
      let nx = behind ? -p.x : p.x;
      let ny = behind ? -p.y : p.y;
      const visible = !behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
      if (visible) {
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
