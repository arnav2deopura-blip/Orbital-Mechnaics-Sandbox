import { characteristicSpeed, createDiagnostics, measure, systemSize } from '../sim/diagnostics';
import type { SystemState } from '../sim/types';

// "Try this preset instead": the preset whose setup is closest to the user's own values, read
// from the masses (one dominant, or all alike), the distances (a tight pair or not), how fast
// the bodies move, and whether the system is flat. A pointer to a system that works and shows
// what the user seems to be after, not a fit.

export interface Suggestion {
  presetId: string;
  /** Why this one, in a sentence. */
  why: string;
}

/** One body outweighs the other two together by this much: a star with planets. */
const DOMINANT = 20;
/** The heaviest is within this factor of the lightest: similar masses. */
const SIMILAR = 3;
/** A pair closer than this fraction of the next distance is a tight pair. */
const TIGHT = 0.35;

/** Two bodies: read the orbit they are on (its eccentricity, and whether it is bound at all). */
function suggestPair(s: SystemState): Suggestion {
  const mu = s.G * (s.m[0] + s.m[1]);
  const r = [0, 1, 2].map((c) => s.x[3 + c] - s.x[c]);
  const v = [0, 1, 2].map((c) => s.v[3 + c] - s.v[c]);
  const distance = Math.hypot(r[0], r[1], r[2]);
  if (!(mu > 0) || !(distance > 0)) {
    return { presetId: 'kepler-orbit', why: 'With no mass or no separation there is no orbit. The Kepler orbit is the plain two-body problem.' };
  }
  const h = Math.hypot(r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]);
  const energy = 0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) - mu / distance;
  if (energy >= 0) {
    return { presetId: 'hyperbolic-flyby', why: 'The pair moves too fast to be bound: a flyby, the one two-body motion that never repeats.' };
  }
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
  if (e > 0.9) {
    return { presetId: 'near-radial', why: 'A very eccentric orbit: the bodies plunge almost together and swing apart again, which is where an adaptive step pays off.' };
  }
  const heavy = Math.max(s.m[0], s.m[1]);
  const light = Math.min(s.m[0], s.m[1]);
  if (e < 0.05 && light > 0 && heavy <= SIMILAR * light) {
    return { presetId: 'circular-binary', why: 'Two similar masses on a circle: the simplest closed orbit, and the cleanest test of an integrator.' };
  }
  return { presetId: 'kepler-orbit', why: 'A bound pair on an ellipse: the Kepler problem, solved exactly, so every integrator can be checked against it.' };
}

export function suggestPreset(s: SystemState): Suggestion {
  if (s.n === 2) return suggestPair(s);
  const order = [0, 1, 2].sort((a, b) => s.m[b] - s.m[a]);
  const [a, b, c] = order;
  const [heavy, mid, light] = order.map((i) => s.m[i]);
  const d = createDiagnostics();
  measure(s, d);
  const size = systemSize(s);
  const speed = characteristicSpeed(s);
  let flat = true;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(s.x[3 * i + 2] - d.com[2]) > 0.05 * size || Math.abs(s.v[3 * i + 2]) > 0.05 * speed) flat = false;
  }
  const sep = (i: number, j: number): number =>
    Math.hypot(s.x[3 * j] - s.x[3 * i], s.x[3 * j + 1] - s.x[3 * i + 1], s.x[3 * j + 2] - s.x[3 * i + 2]);
  const distances = [sep(a, b), sep(a, c), sep(b, c)].sort((p, q) => p - q);
  const tightPair = distances[0] < TIGHT * distances[1];

  if (!(heavy > 0)) {
    return { presetId: 'figure-eight', why: 'With no mass nothing holds the bodies together. The figure-eight is the classic system of three equal masses.' };
  }
  if (heavy > DOMINANT * (mid + light)) {
    if (sep(b, c) < TIGHT * Math.min(sep(a, b), sep(a, c)) && mid > 0) {
      return { presetId: 'star-planet-moon', why: 'One heavy body with the other two close together: a star, a planet and its moon.' };
    }
    if (light < 1e-3 * mid) {
      return { presetId: 'trojan', why: 'A heavy star, a planet and a body of almost no mass: the Sun, Jupiter and a Trojan asteroid.' };
    }
    return { presetId: 'lagrange', why: 'One dominant mass with two lighter ones: the Lagrange triangle, which a dominant mass keeps stable.' };
  }
  if (light > 0 && heavy <= SIMILAR * light) {
    if (d.kinetic < 0.05 * -d.potential) {
      return { presetId: 'pythagorean', why: 'Similar masses starting almost at rest: exactly the Pythagorean problem, a famous chaotic case.' };
    }
    if (tightPair && !flat) {
      return { presetId: 'zlk', why: 'A tight pair with a distant, tilted companion: the Kozai triple, where the tilt and the eccentricity trade places.' };
    }
    return { presetId: 'figure-eight', why: 'Three similar masses in motion: the figure-eight is the best-known orbit of equal masses that stays together.' };
  }
  if (tightPair) {
    return flat
      ? { presetId: 'star-planet-moon', why: 'A tight pair with a third body farther out: a hierarchical system, like a star, a planet and its moon.' }
      : { presetId: 'zlk', why: 'A tight pair with a distant, tilted companion: the Kozai triple.' };
  }
  return { presetId: 'lagrange', why: 'Unequal masses at similar distances: the Lagrange triangle shows when such a system can stay together.' };
}
