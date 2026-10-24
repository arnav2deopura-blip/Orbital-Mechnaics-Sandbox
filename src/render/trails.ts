import * as THREE from 'three';

// Vertex age comes from gl_VertexID and two uniforms, so fading never rewrites an attribute.
//
// With SHADOW defined the same vertices are flattened onto the reference plane (the trail's
// shadow, a depth cue for z). The vertices are relative to the line's anchor, so uBase, the
// anchor in render space, brings them to render space first, where the plane is n.p = uPlaneD.
const VERTEX_SHADER = /* glsl */ `
  uniform float uStart;
  uniform float uCount;
  #ifdef SHADOW
  uniform vec3 uBase;
  uniform vec3 uNormal;
  uniform float uPlaneD;
  #endif
  varying float vAge;
  void main() {
    // 0 at the newest vertex of the drawn window, 1 at the oldest.
    float newest = uStart + uCount - 1.0;
    vAge = clamp((newest - float(gl_VertexID)) / max(uCount - 1.0, 1.0), 0.0, 1.0);
    #ifdef SHADOW
    vec3 r = position + uBase;
    r -= uNormal * (dot(uNormal, r) - uPlaneD);
    gl_Position = projectionMatrix * viewMatrix * vec4(r, 1.0);
    #else
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #endif
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFade;
  uniform float uAlpha;
  varying float vAge;
  void main() {
    gl_FragColor = vec4(uColor, uAlpha * pow(1.0 - vAge, uFade));
    #include <colorspace_fragment>
  }
`;

/** A shadow is this much fainter than the trail it is cast by. */
const SHADOW_ALPHA = 0.3;

/** A pending upload span of the position attribute, in floats. Reused every frame. */
interface UpdateRange {
  start: number;
  count: number;
}

/** Pending samples (two copies each, at most two segments) plus the live tip. */
const MAX_RANGES = 5;

/**
 * One body's trail: a ring buffer of the last `capacity` samples drawn as a fading line strip
 * (plan §7.7).
 *
 * Double write. The buffer holds 2N vertices and every sample is written at slot i and slot
 * i + N. Whatever the head position, the newest N samples are then one contiguous run of
 * vertices, drawn with a single setDrawRange(start, count), and a new sample touches just two
 * small spans of the GPU buffer. Nothing is allocated per sample or per frame.
 *
 * Floating origin. Vertices are Float32, so they are stored relative to `anchor`, a Float64
 * world point, and the line object is placed at anchor - origin in Float64 (see place()). Only
 * small numbers ever reach the GPU, however far from the world origin the orbit is. If the
 * view's focus drifts far from the anchor, rebaseIfFar() re-anchors the stored vertices.
 *
 * Shadow. A second line over the same vertices, flattened onto the reference plane by its
 * vertex shader (setPlane()). It costs a draw call and no extra memory or uploads.
 *
 * Live tip. setTip() writes the interpolated body position into the first vertex past the
 * stored run, which the next stored sample overwrites anyway, so the line always reaches the
 * body without a stored point per frame.
 */
export class Trail {
  readonly line: THREE.Line;
  /** The same trail projected onto the reference plane. Hidden by setting shadow.visible = false. */
  readonly shadow: THREE.Line;
  /** World point (Float64) the vertices are relative to. Set by the first sample. */
  readonly anchor = new Float64Array(3);
  /** A sample closer than this to the last stored one is skipped. */
  minStep = 0;

  private capacity: number;
  private positions: Float32Array;
  private attribute: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly shadowMaterial: THREE.ShaderMaterial;

  /** Slot the next sample goes to. */
  private head = 0;
  /** Samples stored, up to capacity. */
  private count = 0;
  private readonly last = new Float64Array(3);
  private readonly tip = new Float64Array(3);
  private tipSet = false;

  /** Samples written since the last flush: the first slot and how many (it wraps). */
  private pendFrom = 0;
  private pendCount = 0;
  /** The whole buffer must be re-uploaded (new buffer, rebase, resize). */
  private dirtyAll = true;
  private readonly ranges: UpdateRange[] = Array.from({ length: MAX_RANGES }, () => ({ start: 0, count: 0 }));
  private rangeCount = 0;

  constructor(capacity: number, color: THREE.ColorRepresentation) {
    this.capacity = Math.max(2, Math.floor(capacity));
    this.positions = new Float32Array(6 * this.capacity);
    this.attribute = new THREE.BufferAttribute(this.positions, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.attribute);
    geometry.setDrawRange(0, 0);
    const uniforms = (alpha: number): Record<string, THREE.IUniform> => ({
      uColor: { value: new THREE.Color(color) },
      uStart: { value: 0 },
      uCount: { value: 0 },
      uFade: { value: 1.5 },
      uAlpha: { value: alpha },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: uniforms(1),
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.shadowMaterial = new THREE.ShaderMaterial({
      defines: { SHADOW: '' },
      uniforms: {
        ...uniforms(SHADOW_ALPHA),
        uBase: { value: new THREE.Vector3() },
        uNormal: { value: new THREE.Vector3(0, 0, 1) },
        uPlaneD: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.line = new THREE.Line(geometry, this.material);
    this.shadow = new THREE.Line(geometry, this.shadowMaterial);
    for (const line of [this.line, this.shadow]) line.frustumCulled = false; // the bounding sphere would be computed from stale vertices
  }

  /** Samples currently stored. */
  get length(): number {
    return this.count;
  }

  get size(): number {
    return this.capacity;
  }

  /** How quickly the trail fades toward its oldest end: alpha = (1 - age)^fade. */
  set fade(value: number) {
    this.material.uniforms.uFade.value = value;
    this.shadowMaterial.uniforms.uFade.value = value;
  }

  /**
   * Stores a world-space sample, unless it is within minStep of the last stored one.
   * Returns whether it was stored.
   */
  push(x: number, y: number, z: number): boolean {
    if (this.count === 0) {
      this.anchor[0] = x;
      this.anchor[1] = y;
      this.anchor[2] = z;
    } else {
      const dx = x - this.last[0];
      const dy = y - this.last[1];
      const dz = z - this.last[2];
      if (dx * dx + dy * dy + dz * dz < this.minStep * this.minStep) return false;
    }
    const n = this.capacity;
    this.writeVertex(this.head, x, y, z);
    this.writeVertex(this.head + n, x, y, z);
    this.last[0] = x;
    this.last[1] = y;
    this.last[2] = z;

    if (this.pendCount === 0) this.pendFrom = this.head;
    this.pendCount++;
    if (this.pendCount >= n) this.dirtyAll = true;
    this.head = this.head + 1 === n ? 0 : this.head + 1;
    if (this.count < n) this.count++;
    return true;
  }

  /** The body's current position, drawn as the end of the line at the next flush(). */
  setTip(x: number, y: number, z: number): void {
    this.tip[0] = x;
    this.tip[1] = y;
    this.tip[2] = z;
    this.tipSet = true;
  }

  /**
   * Publishes everything since the last flush: the draw window, the fade uniforms and the
   * spans of the position attribute that changed. Call once per frame, before rendering.
   */
  flush(): void {
    const n = this.capacity;
    const full = this.count === n;
    const attribute = this.attribute;
    attribute.updateRanges.length = 0; // the renderer clears this after an upload, but it may not have run
    this.rangeCount = 0;

    const everything = this.dirtyAll;
    if (!everything && this.pendCount > 0) {
      const firstLen = Math.min(this.pendCount, n - this.pendFrom);
      this.addRange(this.pendFrom, firstLen);
      this.addRange(this.pendFrom + n, firstLen);
      const wrapped = this.pendCount - firstLen;
      if (wrapped > 0) {
        this.addRange(0, wrapped);
        this.addRange(n, wrapped);
      }
    }

    let drawn = this.count;
    if (this.tipSet && this.count > 0) {
      // The first vertex past the run: the slot the next sample will overwrite.
      const slot = full ? this.head + n : this.head;
      this.writeVertex(slot, this.tip[0], this.tip[1], this.tip[2]);
      if (!everything) this.addRange(slot, 1);
      drawn++;
    }
    const start = full ? this.head : 0;
    const count = drawn < 2 ? 0 : drawn;
    this.line.geometry.setDrawRange(start, count);
    for (const material of [this.material, this.shadowMaterial]) {
      material.uniforms.uStart.value = start;
      material.uniforms.uCount.value = count;
    }

    if (everything || this.rangeCount > 0) attribute.needsUpdate = true;
    this.dirtyAll = false;
    this.pendCount = 0;
    this.tipSet = false;
  }

  /** Puts the line at anchor - origin, subtracted in Float64 (the floating origin). */
  place(originX: number, originY: number, originZ: number): void {
    this.line.position.set(this.anchor[0] - originX, this.anchor[1] - originY, this.anchor[2] - originZ);
    (this.shadowMaterial.uniforms.uBase.value as THREE.Vector3).copy(this.line.position);
  }

  /**
   * The reference plane for the shadow, in render space: unit normal n and the plane n.p = d.
   * Call after place(); the shadow follows the same vertices as the line.
   */
  setPlane(nx: number, ny: number, nz: number, d: number): void {
    (this.shadowMaterial.uniforms.uNormal.value as THREE.Vector3).set(nx, ny, nz);
    this.shadowMaterial.uniforms.uPlaneD.value = d;
  }

  /**
   * Re-anchors the stored vertices at the given world point if it is further than maxDistance
   * from the current anchor. Returns whether it did. One pass over the buffer, rare.
   */
  rebaseIfFar(x: number, y: number, z: number, maxDistance: number): boolean {
    if (this.count === 0) return false;
    const dx = x - this.anchor[0];
    const dy = y - this.anchor[1];
    const dz = z - this.anchor[2];
    if (dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance) return false;
    // p_new = world - new anchor = p_old + (old anchor - new anchor)
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      p[i] -= dx;
      p[i + 1] -= dy;
      p[i + 2] -= dz;
    }
    this.anchor[0] = x;
    this.anchor[1] = y;
    this.anchor[2] = z;
    this.dirtyAll = true;
    return true;
  }

  /** Forgets all samples. */
  clear(): void {
    this.head = 0;
    this.count = 0;
    this.pendCount = 0;
    this.tipSet = false;
    this.dirtyAll = true;
  }

  /** Changes the capacity, keeping the newest samples that fit. Allocates, so not for every frame. */
  resize(capacity: number): void {
    const next = Math.max(2, Math.floor(capacity));
    if (next === this.capacity) return;
    const oldN = this.capacity;
    const old = this.positions;
    const keep = Math.min(this.count, next);
    const fresh = new Float32Array(6 * next);
    for (let i = 0; i < keep; i++) {
      // i counts from the oldest kept sample; the newest sample is at head - 1.
      const slot = (((this.head - keep + i) % oldN) + oldN) % oldN;
      for (let c = 0; c < 3; c++) {
        fresh[3 * i + c] = old[3 * slot + c];
        fresh[3 * (i + next) + c] = old[3 * slot + c];
      }
    }
    this.capacity = next;
    this.positions = fresh;
    this.attribute = new THREE.BufferAttribute(fresh, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.attribute);
    this.line.geometry.dispose();
    this.line.geometry = geometry;
    this.shadow.geometry = geometry;
    this.head = keep === next ? 0 : keep;
    this.count = keep;
    this.pendCount = 0;
    this.dirtyAll = true;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.material.dispose();
    this.shadowMaterial.dispose();
  }

  /** Slot s of the 2N-vertex buffer, relative to the anchor. The Float64 subtraction happens here. */
  private writeVertex(slot: number, x: number, y: number, z: number): void {
    const i = 3 * slot;
    this.positions[i] = x - this.anchor[0];
    this.positions[i + 1] = y - this.anchor[1];
    this.positions[i + 2] = z - this.anchor[2];
  }

  /** Marks `vertices` vertices from slot `slot` for upload, using a preallocated range object. */
  private addRange(slot: number, vertices: number): void {
    const range = this.ranges[this.rangeCount++];
    range.start = 3 * slot;
    range.count = 3 * vertices;
    this.attribute.updateRanges.push(range);
  }
}
