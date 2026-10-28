import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { arrowTarget } from '../src/render/offscreen';

/** A camera at (0, -10, 0) looking along +y with z up: +x is to the right. */
function camera(far = 1e5): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(45, 1, 0.1, far);
  c.position.set(0, -10, 0);
  c.up.set(0, 0, 1);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
}

const target = (c: THREE.Camera, x: number, y: number, z: number) => arrowTarget(new THREE.Vector3(x, y, z), c, new THREE.Vector3());

describe('arrowTarget', () => {
  it('has no arrow for a body in view', () => {
    expect(target(camera(), 0.5, 0, 0.5).visible).toBe(true);
  });

  it('points toward a body that is off to the side', () => {
    const right = target(camera(), 40, 0, 0);
    expect(right.visible).toBe(false);
    expect(right.x).toBeGreaterThan(1);
    const left = target(camera(), -40, 0, 0);
    expect(left.x).toBeLessThan(-1);
    const above = target(camera(), 0, 0, 40);
    expect(above.y).toBeGreaterThan(1);
  });

  it('points the right way for a body thrown out beyond the far plane, where the depth leaves the clip range but x and y are fine', () => {
    // Far to the right and 200,000 away in front of the camera: past a far plane of 100,000.
    const out = target(camera(), 3e5, 2e5, 0);
    expect(out.visible).toBe(false);
    expect(out.x).toBeGreaterThan(0);
    const outLeft = target(camera(), -3e5, 2e5, 0);
    expect(outLeft.x).toBeLessThan(0);
  });

  it('is not visible past the far plane even straight ahead, and points to the middle', () => {
    const ahead = target(camera(), 0, 2e5, 0);
    expect(ahead.visible).toBe(false);
    expect(Math.abs(ahead.x)).toBeLessThan(1e-6);
  });

  it('turns a body behind the camera back the right way, toward its side', () => {
    const behindRight = target(camera(), 5, -30, 0);
    expect(behindRight.visible).toBe(false);
    expect(behindRight.x).toBeGreaterThan(0);
    const behindLeft = target(camera(), -5, -30, 0);
    expect(behindLeft.x).toBeLessThan(0);
  });

  it('has an arrow for a body inside the near plane, which is cut off, instead of calling it visible', () => {
    const c = camera();
    const close = target(c, 0, -10 + 0.05, 0); // 0.05 in front of the camera, nearer than the 0.1 near plane
    expect(close.visible).toBe(false);
  });

  it('does not flip anything for an orthographic camera, which does not mirror what is behind it', () => {
    const c = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    c.position.set(0, -10, 0);
    c.up.set(0, 0, 1);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    c.updateProjectionMatrix();
    const out = target(c, 40, 0, 0);
    expect(out.visible).toBe(false);
    expect(out.x).toBeGreaterThan(1);
  });
});
