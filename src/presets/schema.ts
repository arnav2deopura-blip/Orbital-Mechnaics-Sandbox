import type { IntegratorId } from '../sim/integrators/types';
import { createState } from '../sim/state';
import type { SystemState } from '../sim/types';

// Preset schema (plan §8.1). Tabulated bodies only for now: the `generator` and `params` of the
// parametric presets arrive with the preset list (M3).

export type PresetTag = 'stable' | 'periodic' | 'unstable' | 'chaotic' | 'hierarchical' | '3D' | 'validation';

export interface PresetBody {
  name: string;
  m: number;
  x: [number, number, number];
  v: [number, number, number];
}

export interface Preset {
  id: string;
  name: string;
  tags: PresetTag[];
  /** One-line teaching goal. */
  demonstrates: string;
  units: 'nbody' | 'astro';
  G: number;
  /** Exactly three. */
  bodies: PresetBody[];
  /** Known period, if any. Becomes T_char. */
  period?: number;
  recommended: {
    integrator: IntegratorId;
    dt?: number;
    epsTol?: number;
    /** Sim time units per real second. */
    speed: number;
    duration?: number;
  };
  /** Citation shown in the UI. */
  source: string;
  /** True only once the periodicity or behavior test of plan §10 passes. */
  verified: boolean;
}

/** The preset's initial conditions as a SystemState at t = 0. Not yet in the COM frame. */
export function presetState(preset: Preset): SystemState {
  if (preset.bodies.length !== 3) throw new RangeError(`Preset ${preset.id} needs exactly 3 bodies`);
  const s = createState(preset.G);
  preset.bodies.forEach((body, i) => {
    s.m[i] = body.m;
    s.x.set(body.x, 3 * i);
    s.v.set(body.v, 3 * i);
  });
  return s;
}
