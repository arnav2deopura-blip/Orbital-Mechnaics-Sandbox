import type { IntegratorId } from '../sim/integrators/types';
import { createState } from '../sim/state';
import type { BodyCount, SystemState } from '../sim/types';

// Preset schema (plan §8.1). A preset is either tabulated (`bodies`) or parametric (`generator`
// with `params`, exposed as sliders).

export type PresetTag = 'stable' | 'periodic' | 'unstable' | 'chaotic' | 'hierarchical' | '3D' | 'validation' | 'unbound';

export interface PresetBody {
  name: string;
  m: number;
  x: [number, number, number];
  v: [number, number, number];
}

/** A slider a parametric preset exposes. */
export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Shown to the user as a tooltip. */
  hint?: string;
}

export type ParamValues = Record<string, number>;

/** What a generator makes: the bodies, and what it knows about running them. */
export interface Generated {
  bodies: PresetBody[];
  period?: number;
  /** A step size suited to these parameters, overriding the preset's recommended one. */
  dt?: number;
  /** How big the picture should be, overriding the preset's recommended camera size. */
  size?: number;
}

export type FocusBody = 'com' | 'body0' | 'body1' | 'body2';

export interface Preset {
  id: string;
  name: string;
  tags: PresetTag[];
  /** One-line teaching goal. */
  demonstrates: string;
  units: 'nbody' | 'astro';
  /** Two bodies, or three (the default). The menu shows the presets of the count that is chosen. */
  bodyCount?: BodyCount;
  G: number;
  /** Exactly `bodyCount` of them. */
  bodies?: PresetBody[];
  generator?: (params: ParamValues) => Generated;
  params?: ParamSpec[];
  /** Known period, if any. Becomes T_char. A generator's own period wins. */
  period?: number;
  recommended: {
    integrator: IntegratorId;
    dt?: number;
    epsTol?: number;
    /** Sim time units per real second. Default: one T_char every 8 s. */
    speed?: number;
    duration?: number;
    /** WH only: the body the others orbit (0 or 1 with two bodies). */
    centralBody?: 0 | 1 | 2;
    /** What the camera follows, and how big the picture should be (default: the size of the system). */
    camera?: { focus: FocusBody; size?: number };
  };
  /** Citation shown in the UI. */
  source: string;
  /** True only once the periodicity or behavior test of plan §10 passes. */
  verified: boolean;
  /** What that test checks, in a sentence, shown to the user when `verified`. */
  verifiedBy?: string;
}

/** A preset made concrete with a choice of parameters. */
export interface Instance {
  /** At t = 0 and in the preset's own frame: not yet shifted to the COM frame. */
  state: SystemState;
  period: number | undefined;
  dt: number | undefined;
  size: number | undefined;
  /** Every parameter of the preset, with its value. */
  params: ParamValues;
}

/** How many bodies the preset has. */
export function bodyCountOf(preset: Preset): BodyCount {
  return preset.bodyCount ?? 3;
}

/** The defaults of the preset's sliders, overlaid with `overrides`. */
export function resolveParams(preset: Preset, overrides: ParamValues = {}): ParamValues {
  const out: ParamValues = {};
  for (const spec of preset.params ?? []) out[spec.key] = overrides[spec.key] ?? spec.value;
  return out;
}

export function instantiate(preset: Preset, overrides: ParamValues = {}): Instance {
  const params = resolveParams(preset, overrides);
  let bodies = preset.bodies;
  let period = preset.period;
  let dt: number | undefined;
  let size: number | undefined;
  if (preset.generator) {
    const generated = preset.generator(params);
    bodies = generated.bodies;
    period = generated.period ?? period;
    dt = generated.dt;
    size = generated.size;
  }
  const count = bodyCountOf(preset);
  if (!bodies || bodies.length !== count) throw new RangeError(`Preset ${preset.id} needs exactly ${count} bodies`);
  const state = createState(preset.G, 0, count);
  bodies.forEach((body, i) => {
    state.m[i] = body.m;
    state.x.set(body.x, 3 * i);
    state.v.set(body.v, 3 * i);
  });
  return { state, period, dt, size, params };
}

/** The preset's initial conditions as a SystemState at t = 0. Not yet in the COM frame. */
export function presetState(preset: Preset, overrides: ParamValues = {}): SystemState {
  return instantiate(preset, overrides).state;
}
