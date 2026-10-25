import { jacobiToInertial } from '../sim/coords';
import type { Generated, PresetBody } from './schema';

// Parametric initial conditions (plan §8.3). Pure functions of their parameters; every angle
// is in degrees at the interface, as the sliders show them.

type Vec = [number, number, number];

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** Turns v about the x axis by `angle` radians. */
function rotateX(v: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}

/**
 * Rotates a whole system about the x axis. Nothing physical changes: it only turns the plane of
 * the motion, so the plane's tilt in the 3D view is visible without any change to the dynamics.
 */
export function tiltBodies(bodies: PresetBody[], degrees: number): PresetBody[] {
  const angle = rad(degrees);
  return bodies.map((b) => ({ ...b, x: rotateX(b.x, angle), v: rotateX(b.v, angle) }));
}

/** Position and velocity at pericenter of an orbit in the xy plane, counterclockwise, with pericenter at angle w. */
export function pericenterState(mu: number, a: number, e: number, w: number): { r: Vec; v: Vec } {
  const rp = a * (1 - e);
  const vp = Math.sqrt((mu * (1 + e)) / rp);
  return { r: [rp * Math.cos(w), rp * Math.sin(w), 0], v: [-vp * Math.sin(w), vp * Math.cos(w), 0] };
}

/**
 * Three bodies in the COM frame from two Jacobi vectors: `inner` is body 1 relative to body 0, and
 * `outer` is body 2 relative to the COM of bodies 0 and 1. The result is in the order of `masses`.
 */
export function fromJacobi(masses: Vec, inner: { r: Vec; v: Vec }, outer: { r: Vec; v: Vec }): { x: Vec[]; v: Vec[] } {
  const m = Float64Array.from(masses);
  const jr = Float64Array.of(0, 0, 0, ...inner.r, ...outer.r);
  const jv = Float64Array.of(0, 0, 0, ...inner.v, ...outer.v);
  const q = new Float64Array(9);
  const u = new Float64Array(9);
  jacobiToInertial(m, jr, q);
  jacobiToInertial(m, jv, u);
  const pick = (a: Float64Array, i: number): Vec => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];
  return { x: [0, 1, 2].map((i) => pick(q, i)), v: [0, 1, 2].map((i) => pick(u, i)) };
}

/**
 * The equilateral solution of Lagrange: three masses at the corners of an equilateral triangle
 * of side a, turning rigidly about their COM at omega^2 = G M / a^3. Exact for any masses,
 * including a massless third body. Returns the bodies in the COM frame and omega.
 */
export function lagrangeBodies(masses: Vec, side: number, G: number, names: [string, string, string]): { bodies: PresetBody[]; omega: number } {
  const M = masses[0] + masses[1] + masses[2];
  const corners: Vec[] = [
    [0, 0, 0],
    [side, 0, 0],
    [side / 2, (side * Math.sqrt(3)) / 2, 0],
  ];
  const com = [0, 1, 2].map((c) => (masses[0] * corners[0][c] + masses[1] * corners[1][c] + masses[2] * corners[2][c]) / M);
  const omega = Math.sqrt((G * M) / side ** 3);
  const bodies = corners.map((p, i): PresetBody => {
    const x = p[0] - com[0];
    const y = p[1] - com[1];
    return { name: names[i], m: masses[i], x: [x, y, 0], v: [-omega * y, omega * x, 0] };
  });
  return { bodies, omega };
}

/**
 * The Routh criterion for Lagrange's equilateral solution: it is linearly stable iff
 * 27 (m1 m2 + m2 m3 + m3 m1) / (m1 + m2 + m3)^2 < 1 (plan §7.1). Returns that ratio.
 */
export function routhRatio(m0: number, m1: number, m2: number): number {
  const M = m0 + m1 + m2;
  return M > 0 ? (27 * (m0 * m1 + m1 * m2 + m2 * m0)) / (M * M) : 0;
}

// ---- presets --------------------------------------------------------------------------------

/**
 * Two bodies on a Kepler orbit (a = 1, G = 1, started at pericenter), and a massless third body
 * on a circular orbit of radius 4 about them whose plane is inclined to the pair's by
 * `inclination`. The pair is exactly Keplerian, so it has a closed-form solution to compare with,
 * and the test particle is the one that moves in z.
 */
export function kepler(p: { e: number; massRatio: number; inclination: number }): Generated {
  const mu = 1 + p.massRatio;
  const inner = pericenterState(mu, 1, p.e, 0);
  const radius = 4;
  const speed = Math.sqrt(mu / radius);
  const i = rad(p.inclination);
  const outer = { r: [radius, 0, 0] as Vec, v: [0, speed * Math.cos(i), speed * Math.sin(i)] as Vec };
  const { x, v } = fromJacobi([1, p.massRatio, 0], inner, outer);
  const names = ['Primary', 'Secondary', 'Test particle'];
  return {
    bodies: [1, p.massRatio, 0].map((m, k) => ({ name: names[k], m, x: x[k], v: v[k] })),
    period: 2 * Math.PI * Math.sqrt(1 / mu),
  };
}

// ---- two bodies --------------------------------------------------------------------------------
//
// With two bodies there is nothing to integrate: the Kepler problem is solved exactly, so every
// system here has a closed form to check against (see sim/analytic.ts). All are in the COM frame
// with G = 1, a pair's relative orbit being the one-body problem with mu = G (m0 + m1).

/** Apocenter state of an orbit in the xy plane, counterclockwise: the slowest, farthest point. */
function apocenterState(mu: number, a: number, e: number): { r: Vec; v: Vec } {
  const ra = a * (1 + e);
  return { r: [ra, 0, 0], v: [0, Math.sqrt((mu * (1 - e)) / ra), 0] };
}

/** The two bodies of a relative orbit `rel` (body 1 relative to body 0), in the COM frame. */
function pairBodies(masses: [number, number], rel: { r: Vec; v: Vec }, names: [string, string]): PresetBody[] {
  const M = masses[0] + masses[1];
  const scale = (v: Vec, w: number): Vec => [w * v[0], w * v[1], w * v[2]];
  return [0, 1].map((i) => {
    const w = i === 0 ? -masses[1] / M : masses[0] / M;
    return { name: names[i], m: masses[i], x: scale(rel.r, w), v: scale(rel.v, w) };
  });
}

/**
 * Two bodies on a Kepler orbit with semi-major axis 1, started at pericenter (or at apocenter, for
 * the plunging orbit, which is calm there and fast at the end). The pair is exactly Keplerian.
 * `tilt` turns the plane of the orbit about the x axis, so its tilt shows in the 3D view.
 */
export function keplerOrbit(p: { e: number; massRatio: number; tilt: number; from?: 'pericenter' | 'apocenter' }): Generated {
  const mu = 1 + p.massRatio;
  const rel = p.from === 'apocenter' ? apocenterState(mu, 1, p.e) : pericenterState(mu, 1, p.e, 0);
  const bodies = pairBodies([1, p.massRatio], rel, ['Primary', 'Secondary']);
  return { bodies: tiltBodies(bodies, p.tilt), period: 2 * Math.PI * Math.sqrt(1 / mu) };
}

/** Two masses on a circle of radius 1 (relative), the simplest closed orbit: a step of T/400 suits a second-order method. */
export function circularBinary(p: { massRatio: number; tilt: number }): Generated {
  const mu = 1 + p.massRatio;
  const period = 2 * Math.PI * Math.sqrt(1 / mu);
  const bodies = pairBodies([1, p.massRatio], pericenterState(mu, 1, 0, 0), ['Body 1', 'Body 2']);
  return { bodies: tiltBodies(bodies, p.tilt), period, dt: period / 400 };
}

/** Distance from which the flyby starts, in pericenter distances. */
const FLYBY_START = 15;

/**
 * An unbound pass: a hyperbola with pericenter distance 1 and eccentricity e > 1, started
 * FLYBY_START pericenter distances out on the way in. "Period" here is the time scale of the
 * pericenter pass, 2 pi sqrt(rp^3 / mu), which is what T_char and the charts measure time in.
 */
export function hyperbolicFlyby(p: { e: number; massRatio: number; tilt: number }): Generated {
  const mu = 1 + p.massRatio;
  const rp = 1;
  const semiLatus = rp * (1 + p.e); // p = a (e^2 - 1) = rp (1 + e)
  const r = FLYBY_START * rp;
  const f = -Math.acos((semiLatus / r - 1) / p.e); // on the way in
  const k = Math.sqrt(mu / semiLatus);
  const rel = { r: [r * Math.cos(f), r * Math.sin(f), 0] as Vec, v: [-k * Math.sin(f), k * (p.e + Math.cos(f)), 0] as Vec };
  const bodies = pairBodies([1, p.massRatio], rel, ['Primary', 'Secondary']);
  const period = 2 * Math.PI * Math.sqrt((rp * rp * rp) / mu);
  return { bodies: tiltBodies(bodies, p.tilt), period, dt: period / 200, size: 2.2 * r };
}

/**
 * Two bodies to experiment with: masses 1 and 0.4 a distance 2 apart, moving sideways at `speed`
 * times the speed of a circular orbit. Below 1 the orbit is an ellipse started at its far point,
 * above 1 an ellipse started at its near point, and from sqrt 2 up it is not bound.
 */
export function sandboxPair(p: { speed: number; tilt: number }): Generated {
  const masses: [number, number] = [1, 0.4];
  const mu = masses[0] + masses[1];
  const r = 2;
  const rel = { r: [r, 0, 0] as Vec, v: [0, p.speed * Math.sqrt(mu / r), 0] as Vec };
  return { bodies: tiltBodies(pairBodies(masses, rel, ['Body 1', 'Body 2']), p.tilt), period: 2 * Math.PI * Math.sqrt((r * r * r) / mu) };
}

/** Lagrange's equilateral solution with masses (mass, 1, 1), the whole system tilted by `tilt`. */
export function lagrange(p: { mass: number; tilt: number }): Generated {
  const { bodies, omega } = lagrangeBodies([p.mass, 1, 1], 2, 1, ['Body 1', 'Body 2', 'Body 3']);
  return { bodies: tiltBodies(bodies, p.tilt), period: (2 * Math.PI) / omega };
}

/** Euler's collinear solution for three unit masses at -a, 0, a with a = 1: periodic but unstable. */
export function eulerCollinear(p: { tilt: number }): Generated {
  const omega = Math.sqrt(5 / 4); // the outer body feels G m / a^2 + G m / (2a)^2
  const bodies: PresetBody[] = [
    { name: 'Body 1', m: 1, x: [-1, 0, 0], v: [0, -omega, 0] },
    { name: 'Body 2', m: 1, x: [0, 0, 0], v: [0, 0, 0] },
    { name: 'Body 3', m: 1, x: [1, 0, 0], v: [0, omega, 0] },
  ];
  return { bodies: tiltBodies(bodies, p.tilt), period: (2 * Math.PI) / omega };
}

/** Jupiter's mass in solar masses (1 / 1047.35) and the semi-major axis of its orbit in AU. */
const JUPITER_MASS = 9.548e-4;
const JUPITER_A = 5.203;

/**
 * The Sun, Jupiter and a massless Trojan near the L4 point, in AU, solar masses and years
 * (G = 4 pi^2). Exactly at L4 the triangle is an exact rigid rotation and nothing happens, so the
 * Trojan starts `offset` degrees away along Jupiter's orbit, with the velocity the rigid rotation
 * would give there, and `inclination` degrees of out-of-plane speed: it then librates in the
 * tadpole orbit around L4 and oscillates in z.
 */
export function trojan(p: { offset: number; inclination: number }): Generated {
  const G = 4 * Math.PI ** 2;
  const { bodies, omega } = lagrangeBodies([1, JUPITER_MASS, 0], JUPITER_A, G, ['Sun', 'Jupiter', 'Trojan']);
  const [sun, jupiter, test] = bodies;
  // Turn the Trojan about the Sun by `offset`, keeping its distance from the Sun.
  const angle = rad(p.offset);
  const rx = test.x[0] - sun.x[0];
  const ry = test.x[1] - sun.x[1];
  const x = sun.x[0] + rx * Math.cos(angle) - ry * Math.sin(angle);
  const y = sun.x[1] + rx * Math.sin(angle) + ry * Math.cos(angle);
  const trojanBody: PresetBody = {
    ...test,
    x: [x, y, 0],
    v: [-omega * y, omega * x, omega * JUPITER_A * Math.tan(rad(p.inclination))],
  };
  return { bodies: [sun, jupiter, trojanBody], period: (2 * Math.PI) / omega };
}

/** An Earth-like planet and moon, in solar units. Masses in solar masses, a_planet in AU. */
const PLANET_MASS = 3.0e-6;
const MOON_MASS = 3.7e-8;
const PLANET_A = 1;

/**
 * A star, a planet on a circular orbit, and a moon on a circular orbit about the planet at
 * `fraction` of the planet's Hill radius R_H = a (m_p / 3 M)^(1/3), inclined to the planet's
 * orbit by `inclination`. Built in Jacobi coordinates ordered (planet, moon, star), so the
 * moon's motion is Keplerian about the planet and the planet-moon pair's about the star.
 * dt is 1/40 of the moon's period; size frames the moon's orbit.
 */
export function starPlanetMoon(p: { fraction: number; inclination: number }): Generated {
  const G = 4 * Math.PI ** 2;
  const hill = PLANET_A * Math.cbrt(PLANET_MASS / 3);
  const moonA = p.fraction * hill;
  const muMoon = G * (PLANET_MASS + MOON_MASS);
  const muStar = G * (1 + PLANET_MASS + MOON_MASS);
  const i = rad(p.inclination);

  const moon = pericenterState(muMoon, moonA, 0, 0);
  const star = { r: [-PLANET_A, 0, 0] as Vec, v: [0, -Math.sqrt(muStar / PLANET_A), 0] as Vec };
  const { x, v } = fromJacobi(
    [PLANET_MASS, MOON_MASS, 1],
    { r: rotateX(moon.r, i), v: rotateX(moon.v, i) },
    star,
  );
  // Computed in the order (planet, moon, star); the presets list (star, planet, moon).
  const bodies: PresetBody[] = [
    { name: 'Star', m: 1, x: x[2], v: v[2] },
    { name: 'Planet', m: PLANET_MASS, x: x[0], v: v[0] },
    { name: 'Moon', m: MOON_MASS, x: x[1], v: v[1] },
  ];
  const moonPeriod = 2 * Math.PI * Math.sqrt(moonA ** 3 / muMoon);
  return { bodies, period: moonPeriod, dt: moonPeriod / 40, size: 6 * moonA };
}

/**
 * An inner binary (a = 1, e = 0.1, masses 1 and 0.01) and a distant outer star (mass 1, circular,
 * radius 6) whose orbit is inclined by `inclination`. Above about 39.2 degrees the von Zeipel-
 * Lidov-Kozai effect trades the inner orbit's inclination for eccentricity over many orbits. The
 * inner pericenter starts perpendicular to the line of nodes (omega = 90 degrees), where the
 * exchange is strongest.
 */
export function inclinedTriple(p: { inclination: number }): Generated {
  const mInner = 1.01;
  const mTotal = 2.01;
  const inner = pericenterState(mInner, 1, 0.1, Math.PI / 2);
  const radius = 6;
  const speed = Math.sqrt(mTotal / radius);
  const i = rad(p.inclination);
  const outer = { r: [radius, 0, 0] as Vec, v: [0, speed * Math.cos(i), speed * Math.sin(i)] as Vec };
  const { x, v } = fromJacobi([1, 0.01, 1], inner, outer);
  const names = ['Primary', 'Companion', 'Perturber'];
  return {
    bodies: [1, 0.01, 1].map((m, k) => ({ name: names[k], m, x: x[k], v: v[k] })),
    period: 2 * Math.PI * Math.sqrt(1 / mInner),
  };
}

/**
 * A free-form starting point: three unit masses on Lagrange's equilateral solution, with body 1
 * lifted by `lift` and the other two lowered by half of it, so the motion is 3D from the start.
 * (The lift is not part of the exact solution, which is unstable for equal masses anyway.)
 */
export function sandbox(p: { lift: number }): Generated {
  const { bodies, omega } = lagrangeBodies([1, 1, 1], 2, 1, ['Body 1', 'Body 2', 'Body 3']);
  const lifts = [p.lift, -p.lift / 2, -p.lift / 2];
  return {
    bodies: bodies.map((b, i) => ({ ...b, x: [b.x[0], b.x[1], lifts[i]] })),
    period: (2 * Math.PI) / omega,
  };
}

// ---- Šuvakov-Dmitrašinović orbits -------------------------------------------------------------

/** One orbit of src/presets/data/suvakov.json. */
export interface SuvakovOrbit {
  id: string;
  name: string;
  label: string;
  stable: boolean;
  p1: number;
  p2: number;
  period: number;
}

/** The bodies of a Šuvakov-Dmitrašinović orbit: x1 = -x2 = (-1, 0), x3 = 0, v1 = v2 = (p1, p2), v3 = -2 (p1, p2), G = m = 1. */
export function suvakovBodies(p1: number, p2: number): PresetBody[] {
  return [
    { name: 'Body 1', m: 1, x: [-1, 0, 0], v: [p1, p2, 0] },
    { name: 'Body 2', m: 1, x: [1, 0, 0], v: [p1, p2, 0] },
    { name: 'Body 3', m: 1, x: [0, 0, 0], v: [-2 * p1, -2 * p2, 0] },
  ];
}
