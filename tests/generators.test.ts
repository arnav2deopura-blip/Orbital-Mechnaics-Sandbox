import { describe, expect, it } from 'vitest';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import {
  eulerCollinear,
  fromJacobi,
  inclinedTriple,
  circularBinary,
  hyperbolicFlyby,
  kepler,
  keplerOrbit,
  lagrange,
  lagrangeBodies,
  pericenterState,
  routhRatio,
  sandbox,
  sandboxPair,
  starPlanetMoon,
  tiltBodies,
  trojan,
} from '../src/presets/generators';
import { PRESETS } from '../src/presets';
import { instantiate, resolveParams } from '../src/presets/schema';
import type { Generated, ParamValues, Preset } from '../src/presets/schema';
import { characteristicTime, energyError } from '../src/sim/diagnostics';
import { computeAccel } from '../src/sim/forces';
import { Simulation } from '../src/sim/simulation';
import { createState } from '../src/sim/state';
import type { SystemState } from '../src/sim/types';
import { angularMomentum, energy } from './helpers';

function stateOf(g: Generated, G = 1): SystemState {
  const s = createState(G);
  g.bodies.forEach((b, i) => {
    s.m[i] = b.m;
    s.x.set(b.x, 3 * i);
    s.v.set(b.v, 3 * i);
  });
  return s;
}

const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Eccentricity of bodies 0 and 1's relative orbit, from the eccentricity vector. */
function eccentricity(s: SystemState, mu: number): number {
  const r = [0, 1, 2].map((c) => s.x[3 + c] - s.x[c]);
  const v = [0, 1, 2].map((c) => s.v[3 + c] - s.v[c]);
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const vxh = [v[1] * h[2] - v[2] * h[1], v[2] * h[0] - v[0] * h[2], v[0] * h[1] - v[1] * h[0]];
  const rn = Math.hypot(...r);
  return Math.hypot(...[0, 1, 2].map((c) => vxh[c] / mu - r[c] / rn));
}

describe('tiltBodies', () => {
  it('turns the system rigidly: distances, speeds, energy and |L| are unchanged', () => {
    const before = lagrange({ mass: 5, tilt: 0 });
    const after = lagrange({ mass: 5, tilt: 37 });
    const a = stateOf(before);
    const b = stateOf(after);
    expect(energy(b)).toBeCloseTo(energy(a), 13);
    expect(Math.hypot(...angularMomentum(b))).toBeCloseTo(Math.hypot(...angularMomentum(a)), 13);
    expect(b.x[2]).not.toBe(0); // it left the xy plane
  });

  it('turns the plane of motion: the angular momentum follows the rotation', () => {
    const s = stateOf(lagrange({ mass: 5, tilt: 90 }));
    const L = angularMomentum(s);
    expect(Math.abs(L[2])).toBeLessThan(1e-12);
    expect(Math.abs(L[1])).toBeGreaterThan(1); // -y for a quarter turn about x
  });

  it('does not change names or masses', () => {
    const bodies = tiltBodies(FIGURE_EIGHT.bodies!, 20);
    expect(bodies.map((b) => b.name)).toEqual(FIGURE_EIGHT.bodies!.map((b) => b.name));
    expect(bodies.map((b) => b.m)).toEqual([1, 1, 1]);
  });
});

describe('pericenterState', () => {
  it.each([0, 0.3, 0.9])('has the energy of an orbit of semi-major axis a (vis-viva), e = %s', (e) => {
    const { r, v } = pericenterState(2.5, 1.7, e, 0.4);
    expect(0.5 * dot(v, v) - 2.5 / Math.hypot(...r)).toBeCloseTo(-2.5 / (2 * 1.7), 13);
    expect(Math.hypot(...r)).toBeCloseTo(1.7 * (1 - e), 13);
    expect(Math.abs(dot(r, v))).toBeLessThan(1e-13); // at pericenter, v is perpendicular to r
  });
});

describe('fromJacobi', () => {
  it('gives a COM at rest at the origin, and the Jacobi separations back', () => {
    const inner = { r: [1, 0.5, 0.2] as [number, number, number], v: [0.1, 0.9, -0.3] as [number, number, number] };
    const outer = { r: [5, -2, 1] as [number, number, number], v: [0.2, 0.3, 0.4] as [number, number, number] };
    const m: [number, number, number] = [2, 0.5, 3];
    const { x, v } = fromJacobi(m, inner, outer);
    const M = 5.5;
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(m[0] * x[0][c] + m[1] * x[1][c] + m[2] * x[2][c]) / M).toBeLessThan(1e-14);
      expect(Math.abs(m[0] * v[0][c] + m[1] * v[1][c] + m[2] * v[2][c]) / M).toBeLessThan(1e-14);
      expect(x[1][c] - x[0][c]).toBeCloseTo(inner.r[c], 14);
      expect(v[1][c] - v[0][c]).toBeCloseTo(inner.v[c], 14);
    }
  });
});

describe('Lagrange, Euler and Trojan solutions are exact rigid rotations', () => {
  /** a_i = -omega^2 (x_i - COM): the force on every body is the centripetal one. */
  function expectRigidRotation(g: Generated, G: number, omega: number): void {
    const s = stateOf(g, G);
    const a = new Float64Array(9);
    computeAccel(s, s.x, a);
    const M = s.m[0] + s.m[1] + s.m[2];
    const com = [0, 1, 2].map((c) => (s.m[0] * s.x[c] + s.m[1] * s.x[3 + c] + s.m[2] * s.x[6 + c]) / M);
    for (let i = 0; i < 3; i++) {
      for (let c = 0; c < 3; c++) {
        const expected = -omega * omega * (s.x[3 * i + c] - com[c]);
        expect(Math.abs(a[3 * i + c] - expected)).toBeLessThan(1e-12 * Math.max(1, omega * omega * 6));
      }
    }
  }

  it('Lagrange, for any masses', () => {
    for (const mass of [1, 7, 100]) {
      const g = lagrange({ mass, tilt: 0 });
      expectRigidRotation(g, 1, Math.sqrt((mass + 2) / 8));
    }
  });

  it('Lagrange, with a massless third body', () => {
    const { bodies, omega } = lagrangeBodies([1, 0.001, 0], 5.2, 4 * Math.PI ** 2, ['a', 'b', 'c']);
    expectRigidRotation({ bodies }, 4 * Math.PI ** 2, omega);
  });

  it('has equal sides', () => {
    const s = stateOf(lagrange({ mass: 3, tilt: 25 }));
    const side = (i: number, j: number): number =>
      Math.hypot(s.x[3 * j] - s.x[3 * i], s.x[3 * j + 1] - s.x[3 * i + 1], s.x[3 * j + 2] - s.x[3 * i + 2]);
    expect(side(0, 1)).toBeCloseTo(2, 13);
    expect(side(1, 2)).toBeCloseTo(2, 13);
    expect(side(0, 2)).toBeCloseTo(2, 13);
  });

  it('Euler collinear, equal masses', () => {
    const g = eulerCollinear({ tilt: 0 });
    expectRigidRotation(g, 1, Math.sqrt(5 / 4));
    expect(g.period).toBeCloseTo((2 * Math.PI) / Math.sqrt(5 / 4), 14);
  });

  it('Trojan at L4 (offset 0, no inclination), in AU, solar masses and years', () => {
    const g = trojan({ offset: 0, inclination: 0 });
    const omega = (2 * Math.PI) / g.period!;
    expectRigidRotation(g, 4 * Math.PI ** 2, omega);
    expect(g.period).toBeGreaterThan(11.8);
    expect(g.period).toBeLessThan(11.9);
    const s = stateOf(g, 4 * Math.PI ** 2);
    const d = (i: number, j: number): number => Math.hypot(s.x[3 * j] - s.x[3 * i], s.x[3 * j + 1] - s.x[3 * i + 1]);
    expect(d(0, 1)).toBeCloseTo(5.203, 12);
    expect(d(0, 2)).toBeCloseTo(5.203, 12);
    expect(d(1, 2)).toBeCloseTo(5.203, 12);
  });
});

describe('Routh criterion', () => {
  it('is 9 for equal masses and crosses 1 near a mass ratio of 50.5', () => {
    expect(routhRatio(1, 1, 1)).toBe(9);
    expect(routhRatio(50, 1, 1)).toBeGreaterThan(1);
    expect(routhRatio(51, 1, 1)).toBeLessThan(1);
    expect(routhRatio(0, 0, 0)).toBe(0);
  });

  it('is far below 1 for the Sun-Jupiter-Trojan masses', () => {
    expect(routhRatio(1, 9.5e-4, 0)).toBeCloseTo(27 * 9.5e-4 / 1.00095 ** 2, 12);
    expect(routhRatio(1, 9.5e-4, 0)).toBeLessThan(0.03);
  });
});

describe('kepler', () => {
  it('puts the pair on an orbit with a = 1 and the requested eccentricity, with the test particle massless', () => {
    for (const e of [0, 0.5, 0.9]) {
      const g = kepler({ e, massRatio: 0.3, inclination: 0 });
      const s = stateOf(g);
      expect(g.bodies[2].m).toBe(0);
      const mu = 1.3;
      expect(eccentricity(s, mu)).toBeCloseTo(e, 12);
      const r = Math.hypot(s.x[3] - s.x[0], s.x[4] - s.x[1], s.x[5] - s.x[2]);
      expect(r).toBeCloseTo(1 - e, 13);
      expect(g.period).toBeCloseTo(2 * Math.PI / Math.sqrt(mu), 13);
    }
  });

  it('inclines the test particle orbit to the pair, by the requested angle', () => {
    for (const inc of [0, 30, 90]) {
      const s = stateOf(kepler({ e: 0.5, massRatio: 0.3, inclination: inc }));
      const r = [s.x[6], s.x[7], s.x[8]];
      const v = [s.v[6], s.v[7], s.v[8]];
      const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
      const angle = (Math.acos(h[2] / Math.hypot(...h)) * 180) / Math.PI;
      expect(angle).toBeCloseTo(inc, 10);
    }
  });

  it('keeps the pair in the xy plane and sends the test particle out of it', () => {
    const g = kepler({ e: 0.5, massRatio: 0.3, inclination: 40 });
    const sim = new Simulation(stateOf(g), { integrator: 'ias15', params: { dt: g.period! / 100 } });
    let maxZ = 0;
    for (let k = 1; k <= 40; k++) {
      sim.advanceTo((k * 3 * g.period!) / 20, Infinity);
      maxZ = Math.max(maxZ, Math.abs(sim.state.x[8]));
      expect(Math.abs(sim.state.x[2])).toBeLessThan(1e-12);
      expect(Math.abs(sim.state.x[5])).toBeLessThan(1e-12);
    }
    expect(maxZ).toBeGreaterThan(1);
  });
});

describe('starPlanetMoon', () => {
  const G = 4 * Math.PI ** 2;
  const hill = Math.cbrt(3.0e-6 / 3);

  it('puts the planet at 1 AU from the star and the moon at the requested fraction of the Hill radius', () => {
    const g = starPlanetMoon({ fraction: 0.3, inclination: 0 });
    const s = stateOf(g, G);
    const d = (i: number, j: number): number => Math.hypot(s.x[3 * j] - s.x[3 * i], s.x[3 * j + 1] - s.x[3 * i + 1], s.x[3 * j + 2] - s.x[3 * i + 2]);
    // The orbit is a = 1 AU about the planet-moon barycenter, so the planet itself is a hair off 1 AU.
    expect(d(0, 1)).toBeCloseTo(1, 3);
    expect(d(1, 2) / hill).toBeCloseTo(0.3, 12);
    expect(g.bodies.map((b) => b.name)).toEqual(['Star', 'Planet', 'Moon']);
    expect(g.dt).toBeCloseTo(g.period! / 40, 15);
  });

  it("tilts the moon's orbit out of the planet's by the inclination", () => {
    for (const inc of [0, 20, 90, 180]) {
      const s = stateOf(starPlanetMoon({ fraction: 0.3, inclination: inc }), G);
      const r = [0, 1, 2].map((c) => s.x[6 + c] - s.x[3 + c]);
      const v = [0, 1, 2].map((c) => s.v[6 + c] - s.v[3 + c]);
      const hz = r[0] * v[1] - r[1] * v[0];
      const h = Math.hypot(r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], hz);
      expect((Math.acos(hz / h) * 180) / Math.PI).toBeCloseTo(inc, 8);
    }
  });

  it('runs under Wisdom-Holman with the planet as the central body, conserving energy and keeping the moon at 0.3 R_H', () => {
    const g = starPlanetMoon({ fraction: 0.3, inclination: 0 });
    const sim = new Simulation(stateOf(g, G), { integrator: 'wh', params: { dt: g.dt!, centralBody: 1 } });
    let max = 0;
    for (let y = 0.05; y <= 3; y += 0.05) {
      sim.advanceTo(y, Infinity);
      const r = Math.hypot(sim.state.x[6] - sim.state.x[3], sim.state.x[7] - sim.state.x[4], sim.state.x[8] - sim.state.x[5]);
      max = Math.max(max, r / hill);
    }
    expect(max).toBeLessThan(0.33);
    expect(energyError(sim.refreshDiagnostics(), sim.reference)).toBeLessThan(1e-8);
  });

  it('loses a moon placed far beyond the stable range, and keeps one well inside it', () => {
    const maxSeparation = (fraction: number, years: number): number => {
      const g = starPlanetMoon({ fraction, inclination: 0 });
      const sim = new Simulation(stateOf(g, G), { integrator: 'wh', params: { dt: g.dt!, centralBody: 1 } });
      let max = 0;
      for (let y = 0.1; y <= years; y += 0.1) {
        sim.advanceTo(y, Infinity);
        max = Math.max(max, Math.hypot(sim.state.x[6] - sim.state.x[3], sim.state.x[7] - sim.state.x[4], sim.state.x[8] - sim.state.x[5]) / hill);
      }
      return max;
    };
    expect(maxSeparation(0.4, 20)).toBeLessThan(0.5);
    expect(maxSeparation(0.55, 20)).toBeGreaterThan(2);
  });
});

describe('trojan libration', () => {
  it('stays near L4 for 300 years, librating in angle and oscillating in z, with WH', () => {
    const G = 4 * Math.PI ** 2;
    const g = trojan({ offset: 10, inclination: 8 });
    const sim = new Simulation(stateOf(g, G), { integrator: 'wh', params: { dt: 0.05, centralBody: 0 } });
    let low = Infinity;
    let high = -Infinity;
    let maxZ = 0;
    for (let yr = 1; yr <= 300; yr++) {
      sim.advanceTo(yr, Infinity);
      const { x } = sim.state;
      const jx = x[3] - x[0];
      const jy = x[4] - x[1];
      const tx = x[6] - x[0];
      const ty = x[7] - x[1];
      const angle = (Math.atan2(jx * ty - jy * tx, jx * tx + jy * ty) * 180) / Math.PI;
      low = Math.min(low, angle);
      high = Math.max(high, angle);
      maxZ = Math.max(maxZ, Math.abs(x[8]));
    }
    expect(low).toBeGreaterThan(20);
    expect(high).toBeLessThan(100);
    expect(high - low).toBeGreaterThan(10); // it does move
    expect(maxZ).toBeGreaterThan(0.3);
    expect(energyError(sim.refreshDiagnostics(), sim.reference)).toBeLessThan(1e-9);
  });
});

describe('inclinedTriple (von Zeipel-Lidov-Kozai)', () => {
  const eccentricityRange = (inclination: number, until: number): [number, number] => {
    const g = inclinedTriple({ inclination });
    const sim = new Simulation(stateOf(g), { integrator: 'ias15', params: { dt: g.period! / 100 } });
    let low = Infinity;
    let high = 0;
    for (let t = g.period!; t <= until; t += g.period!) {
      sim.advanceTo(t, Infinity);
      const e = eccentricity(sim.state, 1.01);
      low = Math.min(low, e);
      high = Math.max(high, e);
    }
    return [low, high];
  };

  it('cycles the inner eccentricity from 0.1 up to the quadrupole limit sqrt(1 - 5/3 cos^2 i) at i = 65 degrees', () => {
    const [low, high] = eccentricityRange(65, 1500);
    const limit = Math.sqrt(1 - (5 / 3) * Math.cos((65 * Math.PI) / 180) ** 2);
    expect(low).toBeLessThan(0.2);
    expect(high).toBeGreaterThan(0.9 * limit);
    expect(high).toBeLessThan(1.05 * limit);
  });

  it('does nothing of the kind below the critical angle (i = 20 degrees)', () => {
    const [, high] = eccentricityRange(20, 1500);
    expect(high).toBeLessThan(0.25);
  });
});

describe('sandbox', () => {
  it('lifts body 1 and lowers the others so the COM stays at z = 0', () => {
    const g = sandbox({ lift: 0.6 });
    expect(g.bodies.map((b) => b.x[2])).toEqual([0.6, -0.3, -0.3]);
  });
});

describe('two-body generators', () => {
  const stateN2 = (g: Generated): SystemState => {
    const s = createState(1, 0, 2);
    g.bodies.forEach((b, i) => {
      s.m[i] = b.m;
      s.x.set(b.x, 3 * i);
      s.v.set(b.v, 3 * i);
    });
    return s;
  };

  it('the Kepler orbit is in the COM frame with energy -G m0 m1 / 2a and the right angular momentum', () => {
    const e = 0.4;
    const q = 0.3;
    const g = keplerOrbit({ e, massRatio: q, tilt: 0 });
    const s = stateOf({ bodies: [...g.bodies, { name: 'x', m: 0, x: [0, 0, 0], v: [0, 0, 0] }] });
    expect(Math.hypot(...[0, 1, 2].map((c) => s.m[0] * s.x[c] + s.m[1] * s.x[3 + c]))).toBeLessThan(1e-15);
    expect(Math.hypot(...[0, 1, 2].map((c) => s.m[0] * s.v[c] + s.m[1] * s.v[3 + c]))).toBeLessThan(1e-15);
    expect(energy(s)).toBeCloseTo(-q / 2, 13);
    expect(angularMomentum(s)[2]).toBeCloseTo((q / (1 + q)) * Math.sqrt((1 + q) * (1 - e * e)), 13);
    expect(g.period).toBeCloseTo(2 * Math.PI / Math.sqrt(1 + q), 13);
  });

  it('starting at the apocenter puts the bodies a (1 + e) apart, moving at the slowest speed', () => {
    const g = keplerOrbit({ e: 0.99, massRatio: 0.5, tilt: 0, from: 'apocenter' });
    const [a, b] = g.bodies;
    expect(Math.hypot(b.x[0] - a.x[0], b.x[1] - a.x[1])).toBeCloseTo(1.99, 13);
    const vRel = Math.hypot(b.v[0] - a.v[0], b.v[1] - a.v[1]);
    expect(vRel).toBeCloseTo(Math.sqrt((1.5 * 0.01) / 1.99), 13);
  });

  it('the circular binary has a constant separation of 1 and a closed form step', () => {
    const g = circularBinary({ massRatio: 1, tilt: 0 });
    const [a, b] = g.bodies;
    expect(Math.hypot(b.x[0] - a.x[0], b.x[1] - a.x[1])).toBeCloseTo(1, 14);
    const sim = new Simulation(stateN2(g), { integrator: 'ias15', params: { dt: g.period! / 100 } });
    for (let k = 1; k <= 10; k++) {
      sim.advanceTo((k * g.period!) / 10, Infinity);
      const s = sim.state;
      expect(Math.hypot(s.x[3] - s.x[0], s.x[4] - s.x[1], s.x[5] - s.x[2])).toBeCloseTo(1, 9);
    }
  });

  it('the flyby is unbound, comes in from 15 pericenter distances, and passes at exactly the pericenter distance', () => {
    const e = 1.6;
    const q = 0.5;
    const g = hyperbolicFlyby({ e, massRatio: q, tilt: 0 });
    const s = stateN2(g);
    const mu = 1 + q;
    const sep = (x: Float64Array): number => Math.hypot(x[3] - x[0], x[4] - x[1], x[5] - x[2]);
    expect(sep(s.x)).toBeCloseTo(15, 12);
    // Specific orbital energy mu (e - 1) / (2 rp) > 0 for rp = 1: v_inf^2 / 2 = mu / (2 a), a = rp / (e - 1).
    const vrel2 = (s.v[3] - s.v[0]) ** 2 + (s.v[4] - s.v[1]) ** 2 + (s.v[5] - s.v[2]) ** 2;
    expect(0.5 * vrel2 - mu / 15).toBeCloseTo((mu * (e - 1)) / 2, 12);
    // Coming in: the separation shrinks at first.
    const radialRate = (s.x[3] - s.x[0]) * (s.v[3] - s.v[0]) + (s.x[4] - s.x[1]) * (s.v[4] - s.v[1]);
    expect(radialRate).toBeLessThan(0);

    // Sample the pass in order and fit a parabola to the three samples around the minimum.
    const sim = new Simulation(s, { integrator: 'ias15', params: { dt: g.period! / 200, epsTol: 1e-11 } });
    const drawn = sim.baselineSnapshot();
    const h = 0.01;
    const seps: number[] = [];
    for (let t = 0; t <= 40; t += h) {
      sim.advanceTo(t, Infinity);
      sim.stateAt(t, drawn);
      seps.push(sep(drawn.x));
    }
    const i = seps.indexOf(Math.min(...seps));
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(seps.length - 1);
    const [fm, f0, fp] = [seps[i - 1], seps[i], seps[i + 1]];
    const minimum = f0 - (fp - fm) ** 2 / (8 * (fp - 2 * f0 + fm));
    expect(minimum).toBeCloseTo(1, 5);
    expect(seps[seps.length - 1]).toBeGreaterThan(seps[0]); // out the other side, and still going
    expect(energy(sim.state)).toBeCloseTo(energy(s), 9);
  });

  it('the sandbox pair is bound below sqrt 2 and unbound above, and circular at speed 1', () => {
    const energyOf = (speed: number): number => energy(stateOf({ bodies: [...sandboxPair({ speed, tilt: 0 }).bodies, { name: 'x', m: 0, x: [0, 0, 0], v: [0, 0, 0] }] }));
    expect(energyOf(1.3)).toBeLessThan(0);
    expect(energyOf(1.5)).toBeGreaterThan(0);
    const g = sandboxPair({ speed: 1, tilt: 0 });
    const sim = new Simulation(stateN2(g), { integrator: 'ias15', params: { dt: g.period! / 100 } });
    sim.advanceTo(g.period! / 3, Infinity);
    expect(Math.hypot(sim.state.x[3] - sim.state.x[0], sim.state.x[4] - sim.state.x[1])).toBeCloseTo(2, 8);
  });

  it('every 2-body preset has two bodies and a zeroed slot 2', () => {
    for (const preset of PRESETS.filter((p) => p.bodyCount === 2)) {
      const { state } = instantiate(preset);
      expect(state.n, preset.id).toBe(2);
      expect([state.m[2], ...state.x.subarray(6), ...state.v.subarray(6)], preset.id).toEqual([0, 0, 0, 0, 0, 0, 0]);
    }
  });
});

describe('the preset list', () => {
  it('has unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  const extremes = (preset: Preset): ParamValues[] => {
    const specs = preset.params ?? [];
    return [Object.fromEntries(specs.map((s) => [s.key, s.min])), Object.fromEntries(specs.map((s) => [s.key, s.max])), {}];
  };

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s: instantiates finitely at the default, minimum and maximum of every slider', (_id, preset) => {
    for (const overrides of extremes(preset)) {
      const { state, period } = instantiate(preset, overrides);
      expect([...state.m, ...state.x, ...state.v].every(Number.isFinite)).toBe(true);
      expect(state.G).toBe(preset.G);
      expect(characteristicTime(state)).toBeGreaterThan(0);
      if (period !== undefined) expect(period).toBeGreaterThan(0);
    }
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s: has defaults inside its slider ranges', (_id, preset) => {
    for (const spec of preset.params ?? []) {
      expect(spec.value).toBeGreaterThanOrEqual(spec.min);
      expect(spec.value).toBeLessThanOrEqual(spec.max);
      expect(spec.max).toBeGreaterThan(spec.min);
    }
    expect(Object.keys(resolveParams(preset))).toEqual((preset.params ?? []).map((s) => s.key));
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s: runs with its recommended settings', (_id, preset) => {
    const { state, period, dt } = instantiate(preset);
    const T = period ?? characteristicTime(state);
    const rec = preset.recommended;
    const sim = new Simulation(state, {
      integrator: rec.integrator,
      params: {
        dt: dt ?? rec.dt ?? T / (rec.integrator === 'ias15' ? 100 : 1000),
        centralBody: rec.centralBody,
      },
    });
    sim.advanceTo(0.5 * T, Infinity);
    expect(sim.failure).toBeNull();
    expect(energyError(sim.refreshDiagnostics(), sim.reference)).toBeLessThan(1e-3);
  });

  it('has a preset with real z in its default motion (the 3D tag is honest)', () => {
    for (const preset of PRESETS.filter((p) => p.tags.includes('3D'))) {
      const { state, period } = instantiate(preset);
      const sim = new Simulation(state, {
        integrator: 'ias15',
        params: { dt: (period ?? characteristicTime(state)) / 100 },
      });
      sim.advanceTo(period ?? characteristicTime(state), Infinity);
      const zs = [sim.state.x[2], sim.state.x[5], sim.state.x[8]].slice(0, sim.state.n);
      expect(Math.max(...zs.map(Math.abs))).toBeGreaterThan(1e-6);
    }
  });
});

describe('trojan inclination', () => {
  const G = 4 * Math.PI ** 2;
  /** Semi-major axis of the Trojan about the Sun, from vis-viva. */
  const semiMajor = (inclination: number): { a: number; r: number; speed: number } => {
    const s = stateOf(trojan({ offset: 10, inclination }), G);
    const r = Math.hypot(s.x[6] - s.x[0], s.x[7] - s.x[1], s.x[8] - s.x[2]);
    const v2 = (s.v[6] - s.v[0]) ** 2 + (s.v[7] - s.v[1]) ** 2 + (s.v[8] - s.v[2]) ** 2;
    return { a: 1 / (2 / r - v2 / (G * s.m[0])), r, speed: Math.sqrt(v2) };
  };

  it('turns the velocity out of the plane, so the orbit stays the same size at every inclination', () => {
    const flat = semiMajor(0);
    for (const inclination of [5, 8, 15, 30, 60, 90]) {
      const tilted = semiMajor(inclination);
      expect(tilted.speed).toBeCloseTo(flat.speed, 9);
      expect(tilted.a).toBeCloseTo(flat.a, 9);
    }
  });

  it('puts sin(i) of the speed, relative to the Sun, out of the plane and cos(i) in it', () => {
    const relative = (inclination: number): number[] => {
      const s = stateOf(trojan({ offset: 10, inclination }), G);
      return [s.v[6] - s.v[0], s.v[7] - s.v[1], s.v[8] - s.v[2]];
    };
    const flat = relative(0);
    const tilted = relative(30);
    const inPlane = Math.hypot(flat[0], flat[1]);
    expect(Math.hypot(tilted[0], tilted[1])).toBeCloseTo(inPlane * Math.cos(Math.PI / 6), 9);
    expect(tilted[2]).toBeCloseTo(inPlane * Math.sin(Math.PI / 6), 9);
  });
});

describe('resolveParams keeps a preset in the range of its sliders', () => {
  const everyParam = PRESETS.flatMap((preset) => (preset.params ?? []).map((spec) => ({ preset, spec })));

  it('pulls an override back to the slider range, and ignores one that is not a number', () => {
    for (const { preset, spec } of everyParam) {
      const span = spec.max - spec.min;
      const get = (value: number): number => resolveParams(preset, { [spec.key]: value })[spec.key];
      expect(get(spec.max + span), `${preset.id}.${spec.key} above`).toBe(spec.max);
      expect(get(spec.min - span), `${preset.id}.${spec.key} below`).toBe(spec.min);
      expect(get(1e308), `${preset.id}.${spec.key} huge`).toBe(spec.max);
      expect(get(-1e308), `${preset.id}.${spec.key} hugely negative`).toBe(spec.min);
      for (const bad of [NaN, Infinity, -Infinity]) expect(get(bad), `${preset.id}.${spec.key} ${bad}`).toBe(spec.value);
      const inside = spec.min + 0.5 * span;
      expect(get(inside)).toBe(inside);
    }
  });

  it('never makes a state with a non-finite number, whatever the override', () => {
    for (const { preset, spec } of everyParam) {
      const span = spec.max - spec.min;
      for (const value of [spec.min - span, spec.max + span, 0, -1, 1e6, 1e308, -1e308, NaN]) {
        const state = instantiate(preset, { [spec.key]: value }).state;
        expect([...state.m, ...state.x, ...state.v].every(Number.isFinite), `${preset.id}.${spec.key}=${value}`).toBe(true);
      }
    }
  });
});
