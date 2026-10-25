import suvakov from './data/suvakov.json';
import { FIGURE_EIGHT } from './figureEight';
import {
  circularBinary,
  eulerCollinear,
  hyperbolicFlyby,
  inclinedTriple,
  kepler,
  keplerOrbit,
  lagrange,
  sandbox,
  sandboxPair,
  starPlanetMoon,
  suvakovBodies,
  trojan,
} from './generators';
import type { SuvakovOrbit } from './generators';
import { bodyCountOf } from './schema';
import type { ParamSpec, Preset } from './schema';
import type { BodyCount } from '../sim/types';

// The preset list (plan §8.2), in the order the menu shows it.

const tilt = (hint = 'Turns the whole system about the x axis. Nothing physical changes: only the plane of the motion is tilted in the view.'): ParamSpec => ({
  key: 'tilt',
  label: 'tilt (deg)',
  min: 0,
  max: 90,
  step: 1,
  value: 0,
  hint,
});

export const KEPLER: Preset = {
  id: 'kepler',
  name: 'Kepler pair + test particle',
  tags: ['validation', 'periodic', '3D'],
  demonstrates: 'Checking an integrator against the exact solution, with a massless third body on an inclined orbit.',
  units: 'nbody',
  G: 1,
  params: [
    { key: 'e', label: 'eccentricity', min: 0, max: 0.95, step: 0.01, value: 0.5 },
    { key: 'massRatio', label: 'mass ratio', min: 0.01, max: 1, step: 0.01, value: 0.3, hint: 'Mass of the secondary over the primary.' },
    {
      key: 'inclination',
      label: 'inclination (deg)',
      min: 0,
      max: 90,
      step: 1,
      value: 30,
      hint: "The tilt of the test particle's orbit to the pair's. The pair stays in the xy plane; the test particle moves in z.",
    },
  ],
  generator: (p) => kepler({ e: p.e, massRatio: p.massRatio, inclination: p.inclination }),
  recommended: { integrator: 'ias15' },
  source: 'Exact two-body solution (Kepler); the third body is massless, so it cannot disturb the pair.',
  verified: true,
  verifiedBy: 'the massive pair returns to its start after one period to better than 1e-9, and follows the exact Kepler solution',
};

export const LAGRANGE: Preset = {
  id: 'lagrange',
  name: 'Lagrange equilateral',
  tags: ['periodic', 'stable', 'unstable'],
  demonstrates: 'The Routh criterion: the triangle is stable when one mass dominates, and falls apart for comparable masses.',
  units: 'nbody',
  G: 1,
  params: [
    {
      key: 'mass',
      label: 'mass of body 1',
      min: 1,
      max: 200,
      step: 0.5,
      value: 100,
      hint: 'The other two have mass 1. The triangle is stable above about 50.5. Nudge it from the Perturb folder to see.',
    },
    tilt(),
  ],
  generator: (p) => lagrange({ mass: p.mass, tilt: p.tilt }),
  recommended: { integrator: 'leapfrog' },
  source: "Lagrange's equilateral solution; its stability is given by the Routh criterion.",
  verified: true,
  verifiedBy: 'the triangle is an exact rigid rotation that returns to its start after one period',
};

export const EULER_COLLINEAR: Preset = {
  id: 'euler',
  name: 'Euler collinear',
  tags: ['periodic', 'unstable'],
  demonstrates: 'A periodic orbit that is unstable: a small nudge makes it break up.',
  units: 'nbody',
  G: 1,
  params: [tilt()],
  generator: (p) => eulerCollinear({ tilt: p.tilt }),
  recommended: { integrator: 'ias15' },
  source: "Euler's collinear solution.",
  verified: true,
  verifiedBy: 'the three bodies in a line are an exact rigid rotation that returns to its start after one period',
};

export const TROJAN: Preset = {
  id: 'trojan',
  name: 'Sun-Jupiter-Trojan',
  tags: ['stable', 'hierarchical', '3D'],
  demonstrates: 'A Trojan librating around the L4 point, with Wisdom-Holman on its home ground.',
  units: 'astro',
  G: 4 * Math.PI ** 2,
  params: [
    { key: 'offset', label: 'offset (deg)', min: -40, max: 40, step: 1, value: 10, hint: 'How far from L4, along Jupiter\'s orbit, the Trojan starts.' },
    { key: 'inclination', label: 'inclination (deg)', min: 0, max: 30, step: 1, value: 8, hint: 'Out-of-plane speed of the Trojan: it then oscillates in z.' },
  ],
  generator: (p) => trojan({ offset: p.offset, inclination: p.inclination }),
  recommended: { integrator: 'wh', dt: 0.05, speed: 1, centralBody: 0 },
  source: "Lagrange's equilateral solution, with the Sun-Jupiter mass ratio and distance (9.548e-4, 5.203 AU).",
  verified: true,
  verifiedBy: 'under Wisdom-Holman the Trojan librates around L4 for 300 years, within 20 to 100 degrees of the Sun-Jupiter line',
};

export const STAR_PLANET_MOON: Preset = {
  id: 'star-planet-moon',
  name: 'Star-planet-moon',
  tags: ['hierarchical', 'stable', '3D'],
  demonstrates: 'A hierarchical system: Wisdom-Holman against leapfrog, and a moon that becomes unstable far from its planet.',
  units: 'astro',
  G: 4 * Math.PI ** 2,
  params: [
    {
      key: 'fraction',
      label: 'moon distance',
      min: 0.1,
      max: 0.55,
      step: 0.01,
      value: 0.3,
      hint: "The moon's orbit in units of the planet's Hill radius. A circular prograde moon survives up to about 0.45 and is lost beyond about 0.5.",
    },
    { key: 'inclination', label: 'moon incl. (deg)', min: 0, max: 180, step: 1, value: 20, hint: "Tilt of the moon's orbit to the planet's. 180 is retrograde." },
  ],
  generator: (p) => starPlanetMoon({ fraction: p.fraction, inclination: p.inclination }),
  // The planet (or the moon) has to be WH's central body, which makes the star the outer one.
  recommended: { integrator: 'wh', speed: 0.25, centralBody: 1, camera: { focus: 'body1' } },
  source: 'Hill radius R_H = a (m / 3M)^(1/3). Masses of the Earth and Moon.',
  verified: true,
  verifiedBy: 'the moon stays bound at 0.3 of the Hill radius for 20 years, and is lost at 0.55',
};

export const PYTHAGOREAN: Preset = {
  id: 'pythagorean',
  name: 'Pythagorean (Burrau)',
  tags: ['chaotic', 'validation'],
  demonstrates: 'Chaos and close encounters: fixed-step methods fail where IAS15 survives, ending with one body ejected.',
  units: 'nbody',
  G: 1,
  // Masses 3, 4, 5 at rest on the corners of a 3-4-5 triangle, each opposite the side of its own length.
  bodies: [
    { name: 'Mass 3', m: 3, x: [1, 3, 0], v: [0, 0, 0] },
    { name: 'Mass 4', m: 4, x: [-2, -1, 0], v: [0, 0, 0] },
    { name: 'Mass 5', m: 5, x: [1, -1, 0], v: [0, 0, 0] },
  ],
  recommended: { integrator: 'ias15', speed: 2 },
  source: 'Szebehely & Peters 1967, AJ 72.',
  verified: true,
  verifiedBy: 'IAS15 resolves the close encounters (energy kept to 1e-8) and by t = 80 the lightest body is ejected, leaving a bound 4-5 binary',
};

export const INCLINED_TRIPLE: Preset = {
  id: 'zlk',
  name: 'Inclined triple (Kozai)',
  tags: ['hierarchical', 'chaotic', '3D'],
  demonstrates: "The von Zeipel-Lidov-Kozai effect: a distant star trades the inner orbit's tilt for eccentricity.",
  units: 'nbody',
  G: 1,
  params: [
    {
      key: 'inclination',
      label: 'mutual incl. (deg)',
      min: 0,
      max: 90,
      step: 1,
      value: 65,
      hint: 'Angle between the inner and outer orbital planes. Eccentricity only cycles above about 39.2 degrees.',
    },
  ],
  generator: (p) => inclinedTriple({ inclination: p.inclination }),
  // One cycle takes about 1100 time units: about 11 s at this speed.
  recommended: { integrator: 'ias15', speed: 100 },
  source: 'The von Zeipel-Lidov-Kozai effect; see Ito & Ohtsuka, arXiv:1911.03984, for its history.',
  verified: true,
  verifiedBy: 'at 65 degrees the inner eccentricity cycles from 0.1 up to the quadrupole limit, and at 20 degrees it does not',
};

export const SANDBOX: Preset = {
  id: 'sandbox',
  name: 'Sandbox',
  tags: ['unstable', '3D'],
  demonstrates: 'Free experimentation: three equal masses, lifted out of the plane. Edit anything.',
  units: 'nbody',
  G: 1,
  params: [{ key: 'lift', label: 'lift', min: 0, max: 1.5, step: 0.05, value: 0.5, hint: 'Height of body 1 above the plane; the others sit half as far below.' }],
  generator: (p) => sandbox({ lift: p.lift }),
  recommended: { integrator: 'ias15' },
  source: 'Lagrange equilateral configuration, lifted.',
  verified: false, // it makes no claim to check: it is a place to experiment
};

/**
 * The Šuvakov-Dmitrašinović orbits (plan §8.4). Their published initial conditions have 5
 * digits, which is not enough to stay periodic for long, so these are refined to 1e-11 closure
 * (see data/suvakov.json). The linearly stable ones stay on the orbit for many periods; the
 * unstable ones look periodic, then fall apart, which is the lesson of Butterfly I.
 */
const SUVAKOV: Preset[] = (suvakov.orbits as (SuvakovOrbit & { published: unknown })[]).map((orbit) => ({
  id: `suvakov-${orbit.id}`,
  name: `${orbit.name}${orbit.stable ? '' : ' (unstable)'}`,
  tags: ['periodic', orbit.stable ? 'stable' : 'unstable'],
  demonstrates: orbit.stable
    ? `A periodic orbit of three equal masses (class ${orbit.label}) that stays on its curve: linearly stable.`
    : `A periodic orbit of three equal masses (class ${orbit.label}) that is unstable: it looks periodic, then falls apart after tens of periods, from roundoff alone.`,
  units: 'nbody',
  G: 1,
  bodies: suvakovBodies(orbit.p1, orbit.p2),
  period: orbit.period,
  // One period every 4 s; the unstable ones take about 40 periods to fall apart, so every second.
  recommended: { integrator: 'ias15', speed: orbit.stable ? orbit.period / 4 : orbit.period },
  source:
    'Šuvakov & Dmitrašinović, Phys. Rev. Lett. 110, 114301 (2013), arXiv:1303.0181. Initial conditions refined from their published 5-digit values; ' +
    'see also Li & Liao, arXiv:1312.6796, on why 5 digits are not enough.',
  verified: true,
  verifiedBy: orbit.stable
    ? 'returns to its start after one period to better than 1e-8, and stays within 1e-8 of the orbit for 10 periods'
    : 'returns to its start after one period to better than 1e-8, and then drifts away from the orbit over many periods',
}));

// ---- two bodies -----------------------------------------------------------------------------
// The exactly solvable case: nothing here is chaotic, and every run has a closed form to be
// judged against. They share the 3-body machinery (state.n = 2), so every method and module works.

const PAIR_MASS_RATIO: ParamSpec = {
  key: 'massRatio',
  label: 'mass ratio',
  min: 0.01,
  max: 1,
  step: 0.01,
  value: 0.3,
  hint: 'Mass of the secondary over the primary.',
};

export const KEPLER_ORBIT: Preset = {
  id: 'kepler-orbit',
  name: 'Kepler orbit',
  bodyCount: 2,
  tags: ['validation', 'periodic'],
  demonstrates: 'The one gravitational problem with an exact answer: two bodies on an ellipse. Check any integrator against it.',
  units: 'nbody',
  G: 1,
  params: [{ key: 'e', label: 'eccentricity', min: 0, max: 0.95, step: 0.01, value: 0.5 }, PAIR_MASS_RATIO, tilt()],
  generator: (p) => keplerOrbit({ e: p.e, massRatio: p.massRatio, tilt: p.tilt }),
  recommended: { integrator: 'ias15' },
  source: 'Exact two-body solution (Kepler).',
  verified: true,
  verifiedBy: 'returns to its start after one period to better than 1e-9, and follows the exact Kepler solution',
};

export const CIRCULAR_BINARY: Preset = {
  id: 'circular-binary',
  name: 'Circular binary',
  bodyCount: 2,
  tags: ['validation', 'periodic', 'stable'],
  demonstrates: 'Two masses on a circle, the simplest closed orbit. Euler spirals outward; leapfrog stays on it.',
  units: 'nbody',
  G: 1,
  params: [{ ...PAIR_MASS_RATIO, value: 1, min: 0.05 }, tilt()],
  generator: (p) => circularBinary({ massRatio: p.massRatio, tilt: p.tilt }),
  recommended: { integrator: 'leapfrog' },
  source: 'Exact two-body solution with e = 0.',
  verified: true,
  verifiedBy: 'returns to its start after one period to better than 1e-9, and keeps a constant separation',
};

export const NEAR_RADIAL: Preset = {
  id: 'near-radial',
  name: 'Near-radial plunge',
  bodyCount: 2,
  tags: ['validation', 'periodic'],
  demonstrates: 'A very eccentric orbit: slow at the far point, then a violent pass at pericenter. A fixed step that suits the first fails the second; IAS15 adapts.',
  units: 'nbody',
  G: 1,
  params: [{ key: 'e', label: 'eccentricity', min: 0.9, max: 0.999, step: 0.001, value: 0.99, hint: 'Pericenter is a (1 - e): at 0.99 the bodies pass 100 times closer than they start.' }, PAIR_MASS_RATIO, tilt()],
  generator: (p) => keplerOrbit({ e: p.e, massRatio: p.massRatio, tilt: p.tilt, from: 'apocenter' }),
  recommended: { integrator: 'ias15' },
  source: 'Exact two-body solution (Kepler), started at the far point.',
  verified: true,
  verifiedBy: 'returns to its start after one period, through a pericenter pass 100 times closer than the start',
};

export const HYPERBOLIC_FLYBY: Preset = {
  id: 'hyperbolic-flyby',
  name: 'Hyperbolic flyby',
  bodyCount: 2,
  tags: ['validation', 'unbound'],
  demonstrates: 'Two bodies that pass once and never meet again: the one two-body orbit that is not closed. The bend of the path is set by the eccentricity.',
  units: 'nbody',
  G: 1,
  params: [{ key: 'e', label: 'eccentricity', min: 1.05, max: 6, step: 0.01, value: 2, hint: 'Above 1 the orbit is open. Closer to 1 the pass bends more; larger is a gentle deflection.' }, PAIR_MASS_RATIO, tilt()],
  generator: (p) => hyperbolicFlyby({ e: p.e, massRatio: p.massRatio, tilt: p.tilt }),
  recommended: { integrator: 'ias15' },
  source: 'Exact two-body solution (Kepler), the unbound branch.',
  verified: true,
  verifiedBy: 'the closest approach is the analytic pericenter distance, and the energy is that of the hyperbola',
};

export const SANDBOX_PAIR: Preset = {
  id: 'sandbox-2',
  name: 'Sandbox (2 bodies)',
  bodyCount: 2,
  tags: ['3D'],
  demonstrates: 'Two bodies to experiment with: change the speed to make a circle, an ellipse or an escape. Edit anything.',
  units: 'nbody',
  G: 1,
  params: [{ key: 'speed', label: 'speed', min: 0.2, max: 1.6, step: 0.01, value: 0.8, hint: 'Sideways speed as a fraction of a circular orbit’s. Below 1 starts at the far point; sqrt 2 (1.41) and above is not bound.' }, { ...tilt(), value: 25 }],
  generator: (p) => sandboxPair({ speed: p.speed, tilt: p.tilt }),
  recommended: { integrator: 'ias15' },
  source: 'Two masses (1 and 0.4) at distance 2.',
  verified: false, // it makes no claim to check: it is a place to experiment
};

export const PRESETS: readonly Preset[] = [
  KEPLER,
  FIGURE_EIGHT,
  LAGRANGE,
  EULER_COLLINEAR,
  TROJAN,
  STAR_PLANET_MOON,
  PYTHAGOREAN,
  INCLINED_TRIPLE,
  ...SUVAKOV,
  SANDBOX,
  KEPLER_ORBIT,
  CIRCULAR_BINARY,
  NEAR_RADIAL,
  HYPERBOLIC_FLYBY,
  SANDBOX_PAIR,
];

/** The presets with this many bodies, in menu order. */
export function presetsFor(count: BodyCount): Preset[] {
  return PRESETS.filter((preset) => bodyCountOf(preset) === count);
}

/** Where switching to this many bodies starts, when there is no earlier choice to go back to. */
export const DEFAULT_PRESET_ID: Record<BodyCount, string> = { 2: 'kepler-orbit', 3: 'figure-eight' };

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
