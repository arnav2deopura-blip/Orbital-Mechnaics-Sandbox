import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SystemState } from '../sim/types';
import { Bodies, BODY_COLORS } from './bodies';
import { DropLines } from './dropLines';
import { PlaneFrame, snapDirection, updatePlaneFrame } from './frame';
import type { PlaneMode, SnapView } from './frame';
import { AxesGizmo } from './gizmo';
import { GridPlane } from './gridPlane';
import { Trail } from './trails';
import { VectorArrows } from './vectors';

export type CameraMode = 'free' | 'com' | 'body0' | 'body1' | 'body2';

/** What the view panel edits. SceneView reads it every frame. */
export interface ViewSettings {
  cameraMode: CameraMode;
  showTrails: boolean;
  /** Samples kept per body. Apply a change with SceneView.setTrailLength(). */
  trailLength: number;
  /** Fade exponent: a trail's alpha is (1 - age)^trailFade. */
  trailFade: number;
  /**
   * 'focus': trails are drawn relative to what the camera follows, so with a body in focus the
   * others trace their orbits about it (a moon circles its planet, not a long wave along the
   * planet's orbit). 'world': in the fixed frame. Free orbit always uses the world.
   */
  trailFrame: 'focus' | 'world';
  /** The floor grid, on the reference plane. */
  showGrid: boolean;
  /** Two more grids standing on the floor, behind the system as seen from the camera: a plot box. */
  showWalls: boolean;
  /** The reference plane: z = 0, or the plane perpendicular to the angular momentum. */
  planeMode: PlaneMode;
  /** A line from each body down to the plane, and a dot where it lands. */
  showDropLines: boolean;
  /** Each trail flattened onto the plane. */
  showShadows: boolean;
  /** The x, y, z indicator in the corner. */
  showAxes: boolean;
  /** Arrows from each body along its velocity and its acceleration, with logarithmic lengths. */
  showVelocity: boolean;
  showAcceleration: boolean;
  /** Multiplies the displayed body radius. */
  bodyScale: number;
}

export function defaultSettings(): ViewSettings {
  return {
    cameraMode: 'com',
    showTrails: true,
    trailLength: 4000,
    trailFade: 1.5,
    trailFrame: 'focus',
    showGrid: true,
    showWalls: false,
    planeMode: 'xy',
    showDropLines: true,
    showShadows: true,
    showAxes: true,
    showVelocity: false,
    showAcceleration: false,
    bodyScale: 1,
  };
}

/** Smallest displayed body radius, in CSS pixels. */
const MIN_BODY_PIXELS = 3;
/** Displayed radius of the heaviest body, as a fraction of the system size. */
const BODY_RADIUS_FRACTION = 0.02;
/** A trail point is kept once the body has moved this fraction of the view distance. */
const TRAIL_DETAIL = 0.003;
/**
 * A trail is re-anchored once its anchor is this many view distances from the focus. A Float32
 * vertex is good to ~6e-8 of its distance from the anchor, so 2000 keeps the error near 1e-4
 * of the view distance, about a tenth of a pixel.
 */
const REBASE_DISTANCE = 2000;
const MAX_FRAME_SECONDS = 0.1;
const NO_OFFSET = new Float64Array(3);
/** How far the floor grid reaches from its center, and how far out and wide the walls are, in grid cells. */
const FLOOR_CELLS = 16;
const WALL_OFFSET_CELLS = 6;
const WALL_CELLS = 10;

/**
 * The Float64 world point that sits at the render origin (plan §7.6). Everything handed to the
 * GPU is world minus this, subtracted in doubles first, so it stays small however far from the
 * world origin the system is and Float32 rounding cannot make it jitter.
 */
export class FloatingOrigin {
  readonly world = new Float64Array(3);
  private readonly focus = new Float64Array(3);

  /** Moves the origin onto the focus of the camera mode. In free mode it stays put. */
  follow(mode: CameraMode, x: Float64Array, m: Float64Array): void {
    if (focusPoint(mode, x, m, this.focus)) this.world.set(this.focus);
  }

  /** Folds a render-space offset into the origin: the point at that offset becomes the origin. */
  absorb(dx: number, dy: number, dz: number): void {
    this.world[0] += dx;
    this.world[1] += dy;
    this.world[2] += dz;
  }
}

/**
 * Writes the world point a camera mode looks at into out, in Float64, and returns true. Free
 * mode has none (the user pans) and returns false.
 */
export function focusPoint(mode: CameraMode, x: Float64Array, m: Float64Array, out: Float64Array): boolean {
  if (mode === 'free') return false;
  if (mode === 'com') {
    const total = m[0] + m[1] + m[2];
    for (let c = 0; c < 3; c++) {
      out[c] = total > 0 ? (m[0] * x[c] + m[1] * x[3 + c] + m[2] * x[6 + c]) / total : (x[c] + x[3 + c] + x[6 + c]) / 3;
    }
    return true;
  }
  const body = mode === 'body0' ? 0 : mode === 'body1' ? 1 : 2;
  out[0] = x[3 * body];
  out[1] = x[3 * body + 1];
  out[2] = x[3 * body + 2];
  return true;
}

/**
 * The 3D view: renderer, orbit camera, bodies, trails and the render loop (plan §7.6, §7.7).
 *
 * The camera always orbits the render origin. A followed focus is put at the origin by moving
 * the floating origin, and free-mode panning is folded into it the same way, so camera and
 * scene numbers stay small. The state shown is read-only; the caller owns the simulation.
 * Nothing here allocates per frame.
 */
export class SceneView {
  readonly settings: ViewSettings = defaultSettings();
  /** Updated about four times a second. */
  readonly stats = { fps: 0, frameMs: 0, renderMs: 0 };
  readonly origin = new FloatingOrigin();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly host: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly bodies = new Bodies();
  private readonly trails: Trail[];
  private readonly floor = new GridPlane(0x5b7db8, 1);
  /** The wall perpendicular to e1, and the one perpendicular to e2. */
  private readonly walls = [new GridPlane(0x466694, 0.75), new GridPlane(0x466694, 0.75)];
  private readonly dropLines = new DropLines();
  private readonly arrows = new VectorArrows();
  private readonly gizmo: AxesGizmo;
  private readonly light = new THREE.DirectionalLight(0xffffff, 2.2);
  private readonly resizeObserver: ResizeObserver;
  private readonly frame3d = new PlaneFrame();
  private readonly scratch = new Float64Array(3);
  /** Where trail samples are measured from: the focus when trails follow it, else the world origin. */
  private readonly trailOrigin = new Float64Array(3);
  private trailedMode: CameraMode | null = null;
  private trailedFrame: ViewSettings['trailFrame'] | null = null;

  private height = 1;
  private needsResize = true;
  private systemScale = 1;
  private clipDistance = 0;

  private frame: ((dtSeconds: number) => SystemState) | null = null;
  private rafId = 0;
  private lastTime = 0;
  private statFrames = 0;
  private statStart = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);
    this.scene.background = new THREE.Color(0x05060a);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.up.set(0, 0, 1); // the orbital plane is xy
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1e-9;
    this.controls.maxDistance = 1e12;

    this.trails = BODY_COLORS.map((color) => new Trail(this.settings.trailLength, color));
    this.scene.add(this.floor.mesh, ...this.walls.map((wall) => wall.mesh), this.bodies.group, this.dropLines.group, this.arrows.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.3), this.light);
    for (const trail of this.trails) this.scene.add(trail.line, trail.shadow);
    this.gizmo = new AxesGizmo(host);

    this.resizeObserver = new ResizeObserver(() => {
      this.needsResize = true;
    });
    this.resizeObserver.observe(host);
    this.setSystemScale(1);
  }

  /** Sizes the bodies and frames the camera for a system about `size` across. */
  setSystemScale(size: number): void {
    this.systemScale = size;
    this.camera.position.set(0, -2.4 * size, 1.6 * size);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** Stores a trail sample for each body. Call after each simulation step (or every few). */
  recordSample(s: SystemState): void {
    const o = this.trailOrigin;
    if (!this.trailsFollowFocus(s)) o.fill(0);
    for (let i = 0; i < 3; i++) this.trails[i].push(s.x[3 * i] - o[0], s.x[3 * i + 1] - o[1], s.x[3 * i + 2] - o[2]);
  }

  clearTrails(): void {
    for (const trail of this.trails) trail.clear();
  }

  /** Applies settings.trailLength, keeping the newest samples that fit. */
  setTrailLength(samples: number): void {
    this.settings.trailLength = samples;
    for (const trail of this.trails) trail.resize(samples);
  }

  setCameraMode(mode: CameraMode): void {
    this.settings.cameraMode = mode;
  }

  /** Moves the camera to look at the focus from a standard direction relative to the reference plane, keeping its distance. */
  snapCamera(view: SnapView): void {
    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target);
    snapDirection(view, this.frame3d, this.scratch);
    this.camera.position.set(
      target.x + this.scratch[0] * distance,
      target.y + this.scratch[1] * distance,
      target.z + this.scratch[2] * distance,
    );
    this.controls.update();
  }

  /** Draws the system: the floating origin, then bodies, trails and grid relative to it. */
  renderState(s: SystemState): void {
    const t0 = performance.now();
    if (this.needsResize) this.resize();
    const settings = this.settings;
    const mode = settings.cameraMode;
    const o = this.origin.world;

    // Put the focus at the render origin, and keep the camera orbiting it.
    this.origin.follow(mode, s.x, s.m);
    // Trails recorded in one frame make no sense in another: start them over when it changes.
    if (mode !== this.trailedMode || settings.trailFrame !== this.trailedFrame) {
      this.trailedMode = mode;
      this.trailedFrame = settings.trailFrame;
      this.clearTrails();
    }
    this.controls.enablePan = mode === 'free';
    this.controls.update();
    if (mode === 'free') {
      const target = this.controls.target;
      this.origin.absorb(target.x, target.y, target.z);
      this.camera.position.sub(target);
      target.set(0, 0, 0);
    }

    const d = this.camera.position.length();
    if (Math.abs(d - this.clipDistance) > 0.02 * this.clipDistance) {
      this.clipDistance = d;
      this.camera.near = d * 1e-3;
      this.camera.far = d * 1e4;
      this.camera.updateProjectionMatrix();
    }

    const frame = this.frame3d;
    updatePlaneFrame(settings.planeMode, s.x, s.v, s.m, frame);
    const planeD = frame.offsetFrom(o);
    this.light.position.set(-0.5, 0.8, 1).applyQuaternion(this.camera.quaternion);

    const worldPerPixel = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * d) / this.height;
    this.bodies.update(
      s.x,
      s.m,
      o,
      settings.bodyScale * BODY_RADIUS_FRACTION * this.systemScale,
      MIN_BODY_PIXELS * worldPerPixel,
    );

    // Trails that follow the focus are stored relative to it, so they are drawn relative to the render origin.
    const toFocus = this.trailsFollowFocus(s);
    const to = toFocus ? NO_OFFSET : o;
    const tip = this.trailOrigin;
    if (!toFocus) tip.fill(0);
    for (let i = 0; i < 3; i++) {
      const trail = this.trails[i];
      trail.line.visible = settings.showTrails;
      trail.shadow.visible = settings.showTrails && settings.showShadows;
      if (!settings.showTrails) continue;
      trail.minStep = TRAIL_DETAIL * d;
      trail.fade = settings.trailFade;
      trail.rebaseIfFar(to[0], to[1], to[2], REBASE_DISTANCE * d);
      trail.place(to[0], to[1], to[2]);
      trail.setPlane(frame.n[0], frame.n[1], frame.n[2], planeD);
      trail.setTip(s.x[3 * i] - tip[0], s.x[3 * i + 1] - tip[1], s.x[3 * i + 2] - tip[2]);
      trail.flush();
    }

    this.updateGrids(d);
    this.dropLines.visible = settings.showDropLines;
    if (settings.showDropLines) this.dropLines.update(s.x, o, frame, this.renderer.getPixelRatio());
    this.arrows.update(s, o, d, settings.showVelocity, settings.showAcceleration);
    this.renderer.render(this.scene, this.camera);
    this.gizmo.render(this.renderer, this.camera, frame, settings.showAxes);
    this.stats.renderMs = performance.now() - t0;
  }

  /**
   * Starts the render loop. Each frame calls `frame` with the elapsed seconds (clamped, so a
   * hidden tab cannot cause a catch-up burst) to advance the simulation, and draws the state it
   * returns.
   */
  start(frame: (dtSeconds: number) => SystemState): void {
    if (this.frame) return;
    this.frame = frame;
    this.lastTime = performance.now();
    this.statStart = this.lastTime;
    this.statFrames = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.frame = null;
    cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    for (const trail of this.trails) trail.dispose();
    this.bodies.dispose();
    this.floor.dispose();
    for (const wall of this.walls) wall.dispose();
    this.dropLines.dispose();
    this.arrows.dispose();
    this.gizmo.dispose();
    this.light.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** One allocation, made once: the requestAnimationFrame callback. */
  private readonly loop = (now: number): void => {
    if (!this.frame) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0), MAX_FRAME_SECONDS);
    this.lastTime = now;
    this.renderState(this.frame(dt));

    this.statFrames++;
    const elapsed = now - this.statStart;
    if (elapsed >= 250) {
      this.stats.fps = (this.statFrames * 1000) / elapsed;
      this.stats.frameMs = elapsed / this.statFrames;
      this.statFrames = 0;
      this.statStart = now;
    }
  };

  /** True, with the focus in trailOrigin, when trails are stored relative to what the camera follows. */
  private trailsFollowFocus(s: SystemState): boolean {
    return this.settings.trailFrame === 'focus' && focusPoint(this.settings.cameraMode, s.x, s.m, this.trailOrigin);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.height = h;
    this.needsResize = false;
  }

  /**
   * The floor on the reference plane, and the two walls. Cells are powers of ten, and the lines
   * are fixed in world space: the shader is handed where the quad is in world coordinates, so
   * they stay put as the focus moves.
   */
  private updateGrids(d: number): void {
    const { showGrid, showWalls } = this.settings;
    this.floor.visible = showGrid;
    for (const wall of this.walls) wall.visible = showWalls;
    if (!showGrid && !showWalls) return;

    const cell = Math.pow(10, Math.round(Math.log10(d / 5)));
    const { e1, e2, n } = this.frame3d;
    const o = this.origin.world;
    const center = this.scratch;

    if (showGrid) {
      // Centered on the point of the plane nearest the render origin.
      const s = this.frame3d.offsetFrom(o);
      center[0] = s * n[0];
      center[1] = s * n[1];
      center[2] = s * n[2];
      this.floor.place(e1, e2, n, center, o, cell, FLOOR_CELLS * cell);
    }
    if (showWalls) {
      const cam = this.camera.position;
      for (let k = 0; k < 2; k++) {
        const along = k === 0 ? e1 : e2; // the wall's normal
        const across = k === 0 ? e2 : e1;
        // On the far side of the focus from the camera, on a world grid line.
        const side = along[0] * cam.x + along[1] * cam.y + along[2] * cam.z > 0 ? -1 : 1;
        const world = along[0] * o[0] + along[1] * o[1] + along[2] * o[2];
        const offset = Math.round((world + side * WALL_OFFSET_CELLS * cell) / cell) * cell - world;
        center[0] = offset * along[0];
        center[1] = offset * along[1];
        center[2] = offset * along[2];
        this.walls[k].place(across, n, along, center, o, cell, WALL_CELLS * cell);
      }
    }
  }
}
