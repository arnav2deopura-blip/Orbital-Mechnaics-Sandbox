import { findPreset } from '../presets';
import { instantiate } from '../presets/schema';
import type { ParamValues } from '../presets/schema';
import type { CameraMode, ViewSettings } from '../render/scene';
import type { PlaneMode } from '../render/frame';
import { shiftToComFrame } from '../sim/coords';
import type { IntegratorId } from '../sim/integrators/types';
import { createState } from '../sim/state';
import type { Controller } from './controller';

// A run as a link (plan §7.8): the preset and its parameters, the method and its settings, the
// speed, anything edited about the bodies (z included), and how it is viewed. The hash holds it as
// compact JSON in base64url, `#s=...`, so loading the link restores the run.
//
// For links written by hand (the Learn page's "Try it"), a plain form works too:
// `#preset=pythagorean&integrator=leapfrog&dt=0.01&speed=2`, where any key that is not one of
// the names below is a parameter of the preset (`#preset=lagrange&mass=40`).

const MAGIC = 's=';

/** The method as the panel names it: symplectic Euler is Euler with the reordered update. */
export type MethodChoice = IntegratorId | 'symplectic-euler';
const METHODS: MethodChoice[] = ['euler', 'symplectic-euler', 'leapfrog', 'rk4', 'wh', 'ias15'];
const CAMERA_MODES: CameraMode[] = ['free', 'com', 'corotating', 'body0', 'body1', 'body2'];
const PLANE_MODES: PlaneMode[] = ['xy', 'angular'];
const TRAIL_FRAMES: ViewSettings['trailFrame'][] = ['focus', 'world'];

const VIEW_FLAGS = [
  'showTrails',
  'showGrid',
  'showWalls',
  'showDropLines',
  'showShadows',
  'showAxes',
  'orthographic',
  'tintTrails',
  'showVelocity',
  'showAcceleration',
] as const;
/** The numeric view settings, with the range each may take. */
const VIEW_NUMBERS = { trailLength: [200, 20000], trailFade: [0, 6], bodyScale: [0.25, 8] } as const;

/** Edited initial conditions, in the COM frame at time t. */
export interface BodiesState {
  t: number;
  m: number[];
  x: number[];
  v: number[];
}

export interface ShareState {
  preset: string;
  params?: ParamValues;
  integrator?: MethodChoice;
  dt?: number;
  epsTol?: number;
  dtMin?: number;
  dtMax?: number;
  centralBody?: 0 | 1 | 2;
  speed?: number;
  direction?: 1 | -1;
  running?: boolean;
  G?: number;
  softening?: number;
  bodies?: BodiesState;
  view?: Partial<ViewSettings>;
  /** The camera's offset from what it looks at. */
  camera?: [number, number, number];
}

/** What applyState needs of the 3D view. SceneView provides it. */
export interface ShareView {
  settings: ViewSettings;
  camera: { position: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown } };
  setTrailLength(samples: number): void;
}

// ---- encoding -------------------------------------------------------------------------------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(text: string): string {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The hash (without the #) that restores `state`. */
export function encodeShare(state: ShareState): string {
  return MAGIC + toBase64Url(JSON.stringify(state));
}

/**
 * The state a hash describes, or null if it is empty, malformed, or names no preset. Anything
 * invalid inside it is dropped rather than trusted: a link is input from outside.
 */
export function decodeShare(hash: string): ShareState | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (text === '') return null;
  try {
    if (text.startsWith(MAGIC)) return sanitize(JSON.parse(fromBase64Url(text.slice(MAGIC.length))));
    return sanitize(parseLinkParams(text));
  } catch {
    return null;
  }
}

/** `preset=a&b=1&integrator=rk4` as an object; numbers become numbers, `true` and `false` booleans. */
function parseLinkParams(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const params: ParamValues = {};
  const top: Record<string, (v: string) => unknown> = {
    preset: (v) => v,
    integrator: (v) => v,
    focus: (v) => v,
    plane: (v) => v,
    dt: Number,
    epsTol: Number,
    dtMin: Number,
    dtMax: Number,
    central: Number,
    speed: Number,
    direction: Number,
    G: Number,
    softening: Number,
    running: (v) => v !== '0' && v !== 'false',
  };
  for (const pair of text.split('&')) {
    const [key, raw = ''] = pair.split('=');
    const value = decodeURIComponent(raw);
    if (key in top) out[key] = top[key](value);
    else if (key !== '' && value !== '' && Number.isFinite(Number(value))) params[key] = Number(value);
  }
  if (Object.keys(params).length > 0) out.params = params;
  if ('central' in out) out.centralBody = out.central;
  const view: Record<string, unknown> = {};
  if (out.focus !== undefined) view.cameraMode = out.focus;
  if (out.plane !== undefined) view.planeMode = out.plane;
  if (Object.keys(view).length > 0) out.view = view;
  return out;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;

/** Keeps only what is well-formed and in range. Null if there is no preset to start from. */
export function sanitize(raw: unknown): ShareState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.preset !== 'string' || r.preset === '') return null;
  const out: ShareState = { preset: r.preset };

  if (typeof r.params === 'object' && r.params !== null) {
    const params: ParamValues = {};
    for (const [key, value] of Object.entries(r.params)) if (finite(value)) params[key] = value;
    out.params = params;
  }
  if (typeof r.integrator === 'string' && METHODS.includes(r.integrator as MethodChoice)) out.integrator = r.integrator as MethodChoice;
  if (positive(r.dt)) out.dt = r.dt;
  if (positive(r.epsTol)) out.epsTol = r.epsTol;
  if (positive(r.dtMin)) out.dtMin = r.dtMin;
  if (positive(r.dtMax)) out.dtMax = r.dtMax;
  if (r.centralBody === 0 || r.centralBody === 1 || r.centralBody === 2) out.centralBody = r.centralBody;
  if (positive(r.speed)) out.speed = r.speed;
  if (r.direction === 1 || r.direction === -1) out.direction = r.direction;
  if (typeof r.running === 'boolean') out.running = r.running;
  if (positive(r.G)) out.G = r.G;
  if (finite(r.softening) && r.softening >= 0) out.softening = r.softening;

  const b = r.bodies as Partial<Record<keyof BodiesState, unknown>> | undefined;
  if (typeof b === 'object' && b !== null) {
    const triple = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every(finite);
    if (finite(b.t) && triple(b.m, 3) && triple(b.x, 9) && triple(b.v, 9) && b.m.every((m) => m >= 0)) {
      out.bodies = { t: b.t, m: [...b.m], x: [...b.x], v: [...b.v] };
    }
  }

  if (typeof r.view === 'object' && r.view !== null) {
    const v = r.view as Record<string, unknown>;
    const view: Partial<ViewSettings> = {};
    for (const key of VIEW_FLAGS) if (typeof v[key] === 'boolean') view[key] = v[key] as boolean;
    for (const [key, [lo, hi]] of Object.entries(VIEW_NUMBERS)) {
      const value = v[key];
      if (finite(value)) (view as Record<string, number>)[key] = Math.min(Math.max(value, lo), hi);
    }
    if (CAMERA_MODES.includes(v.cameraMode as CameraMode)) view.cameraMode = v.cameraMode as CameraMode;
    if (PLANE_MODES.includes(v.planeMode as PlaneMode)) view.planeMode = v.planeMode as PlaneMode;
    if (TRAIL_FRAMES.includes(v.trailFrame as ViewSettings['trailFrame'])) view.trailFrame = v.trailFrame as ViewSettings['trailFrame'];
    out.view = view;
  }
  if (Array.isArray(r.camera) && r.camera.length === 3 && r.camera.every(finite) && Math.hypot(...(r.camera as number[])) > 0) {
    out.camera = [r.camera[0], r.camera[1], r.camera[2]];
  }
  return out;
}

// ---- capture and apply ----------------------------------------------------------------------

/** The settings of a run, as they are now. Only what differs from the preset's own is included for the bodies, G and softening. */
export function captureState(controller: Controller, view: ShareView): ShareState {
  const { sim, loop, preset } = controller;
  const integrator = sim.integrator;
  const state: ShareState = {
    preset: preset.id,
    params: { ...controller.params },
    integrator: integrator.id === 'euler' && integrator.symplectic ? 'symplectic-euler' : integrator.id,
    dt: sim.params.dt,
    speed: loop.settings.speed,
    direction: sim.direction,
    running: loop.settings.running,
  };
  if (sim.params.epsTol !== undefined) state.epsTol = sim.params.epsTol;
  if (sim.params.dtMin !== undefined) state.dtMin = sim.params.dtMin;
  if (sim.params.dtMax !== undefined) state.dtMax = sim.params.dtMax;
  if (sim.params.centralBody !== undefined) state.centralBody = sim.params.centralBody;

  const baseline = sim.baselineSnapshot();
  if (baseline.G !== preset.G) state.G = baseline.G;
  if (baseline.eps2 !== 0) state.softening = Math.sqrt(baseline.eps2);
  // The bodies are shared only when they were edited: compare with what the preset makes.
  const made = instantiate(preset, controller.params).state;
  shiftToComFrame(made);
  let edited = baseline.t !== 0;
  for (let i = 0; i < 9 && !edited; i++) edited = Math.abs(baseline.x[i] - made.x[i]) > 1e-12 || Math.abs(baseline.v[i] - made.v[i]) > 1e-12;
  for (let i = 0; i < 3 && !edited; i++) edited = baseline.m[i] !== made.m[i];
  if (edited) {
    state.bodies = { t: baseline.t, m: Array.from(baseline.m), x: Array.from(baseline.x), v: Array.from(baseline.v) };
  }

  const s = view.settings;
  const shown: Partial<ViewSettings> = { cameraMode: s.cameraMode, planeMode: s.planeMode, trailFrame: s.trailFrame };
  for (const key of VIEW_FLAGS) shown[key] = s[key];
  for (const key of Object.keys(VIEW_NUMBERS)) (shown as Record<string, number>)[key] = (s as unknown as Record<string, number>)[key];
  state.view = shown;
  const p = view.camera.position;
  state.camera = [p.x, p.y, p.z];
  return state;
}

/**
 * Restores a run: loads the preset with its parameters, then the method, step, speed and view,
 * then any edited bodies. An unknown preset is ignored, and so is whatever does not apply to the
 * method (a central body for leapfrog). Returns whether the preset was found.
 */
export function applyState(controller: Controller, view: ShareView, state: ShareState): boolean {
  const preset = findPreset(state.preset);
  if (!preset) return false;
  controller.loadPreset(preset, { params: state.params });
  const { sim } = controller;

  if (state.dt !== undefined) controller.setDt(state.dt);
  if (state.epsTol !== undefined) sim.params.epsTol = state.epsTol;
  if (state.dtMin !== undefined) sim.params.dtMin = state.dtMin;
  if (state.dtMax !== undefined) sim.params.dtMax = state.dtMax;
  if (state.centralBody !== undefined) sim.params.centralBody = state.centralBody;
  if (state.integrator !== undefined) {
    const symplectic = state.integrator === 'symplectic-euler';
    const id = (symplectic ? 'euler' : state.integrator) as IntegratorId;
    if (id !== sim.integrator.id || symplectic !== sim.integrator.symplectic) controller.setIntegrator(id, symplectic);
  }
  if (state.G !== undefined) controller.setG(state.G);
  if (state.softening !== undefined) controller.setSoftening(state.softening);
  if (state.bodies) {
    const next = createState(sim.state.G, sim.state.eps2, sim.state.n);
    next.t = state.bodies.t;
    next.m.set(state.bodies.m);
    next.x.set(state.bodies.x);
    next.v.set(state.bodies.v);
    if (next.n === 2) {
      // Slot 2 does not exist in a pair, whatever a hand-written link puts there.
      next.m[2] = 0;
      next.x.fill(0, 6);
      next.v.fill(0, 6);
    }
    controller.edit(next, false);
  }
  if (state.speed !== undefined) controller.setSpeed(state.speed);
  if (state.direction !== undefined) controller.setDirection(state.direction);
  if (state.running === false) controller.pause();
  else controller.play();

  if (state.view) {
    const { trailLength, ...rest } = state.view;
    Object.assign(view.settings, rest);
    if (trailLength !== undefined) {
      view.settings.trailLength = trailLength;
      view.setTrailLength(trailLength);
    }
  }
  if (state.camera) view.camera.position.set(...state.camera);
  return true;
}

/** The full URL that opens the page with `state`. */
export function shareUrl(state: ShareState, base: string): string {
  return `${base.split('#')[0]}#${encodeShare(state)}`;
}
