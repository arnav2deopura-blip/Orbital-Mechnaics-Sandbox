// Universal-variable Kepler drift (plan §4.4), after Curtis, Orbital Mechanics for
// Engineering Students, ch. 3. One code path covers elliptic, parabolic and hyperbolic orbits.

const TWO_PI = 2 * Math.PI;
/**
 * Inside |z| < 1 the Stumpff functions use a Taylor series. Outside it the closed forms
 * lose about 6 eps / |z| to cancellation, which is under 1e-15 from there outward.
 */
const SERIES_BELOW = 1;
const SERIES_TERMS = 10;
const MAX_ITER = 100;
/** Stop when the Newton correction is below this fraction of chi. It is quadratic, so the error left is roundoff. */
const TOL = 1e-9;

/** C(z) = (1 - cos sqrt z) / z, continued analytically to z < 0 as (cosh sqrt -z - 1) / -z. */
export function stumpffC(z: number): number {
  if (z > -SERIES_BELOW && z < SERIES_BELOW) {
    // sum_k (-z)^k / (2k + 2)!
    let term = 0.5;
    let sum = 0.5;
    for (let k = 0; k < SERIES_TERMS; k++) {
      term *= -z / ((2 * k + 3) * (2 * k + 4));
      sum += term;
    }
    return sum;
  }
  if (z > 0) return (1 - Math.cos(Math.sqrt(z))) / z;
  return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
}

/** S(z) = (sqrt z - sin sqrt z) / z^(3/2), continued analytically to z < 0. */
export function stumpffS(z: number): number {
  if (z > -SERIES_BELOW && z < SERIES_BELOW) {
    // sum_k (-z)^k / (2k + 3)!
    let term = 1 / 6;
    let sum = 1 / 6;
    for (let k = 0; k < SERIES_TERMS; k++) {
      term *= -z / ((2 * k + 4) * (2 * k + 5));
      sum += term;
    }
    return sum;
  }
  if (z > 0) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * z);
  }
  const s = Math.sqrt(-z);
  return (Math.sinh(s) - s) / (s * -z);
}

/**
 * Advances one body on a Kepler orbit about a fixed center, in place (the exact solution
 * of H = v^2/2 - mu/r). Position and velocity are the 3 entries at offset o of pos and vel.
 * Returns false if the root solve did not converge; the entries then hold the best estimate.
 *
 * Solves the universal Kepler equation F(chi) = 0 for the universal anomaly chi:
 *   F = (r0 vr0 / sqrt mu) chi^2 C(z) + (1 - alpha r0) chi^3 S(z) + r0 chi - sqrt mu dt,  z = alpha chi^2
 * F' = r(chi) > 0, so F is strictly increasing with a single root. Newton steps are kept
 * inside a bracket and fall back to bisection when they stop converging fast, so a bad
 * guess cannot send it astray (hyperbolic and near-parabolic orbits included). Then, with
 * the Lagrange coefficients:
 *   r = f r0 + g v0,  v = fdot r0 + gdot v0
 *
 * A negative dt runs the same solve on the reversed velocity and flips the result, since
 * Kepler motion is time-reversible. Whole periods of a bound orbit are dropped first.
 * Allocation rule: scalars only. mu must be > 0 and the body must not sit at the center.
 */
export function keplerDrift(
  mu: number,
  dt: number,
  pos: Float64Array,
  vel: Float64Array,
  o: number,
): boolean {
  if (dt === 0) return true;
  const sgn = dt < 0 ? -1 : 1;
  let tau = sgn * dt;

  const px = pos[o];
  const py = pos[o + 1];
  const pz = pos[o + 2];
  const ux = sgn * vel[o];
  const uy = sgn * vel[o + 1];
  const uz = sgn * vel[o + 2];

  const r0 = Math.sqrt(px * px + py * py + pz * pz);
  const sqmu = Math.sqrt(mu);
  const alpha = 2 / r0 - (ux * ux + uy * uy + uz * uz) / mu; // 1 / semi-major axis
  const rv = (px * ux + py * uy + pz * uz) / sqmu; // r0 vr0 / sqrt mu

  if (alpha > 0) {
    const period = TWO_PI / (sqmu * alpha * Math.sqrt(alpha));
    if (tau >= period) tau -= Math.floor(tau / period) * period;
    if (tau === 0) return true;
  }

  const sqmuTau = sqmu * tau;
  const kk = 1 - alpha * r0;
  // First-order rate of chi, exact at any point of an ellipse. Bound orbits cannot exceed one revolution.
  let chi = sqmuTau / r0;
  if (alpha > 0) chi = Math.min(chi, TWO_PI / Math.sqrt(alpha));

  let lo = 0;
  let hi = Infinity;
  let lastStep = Infinity;
  let converged = false;
  for (let it = 0; it < MAX_ITER; it++) {
    const chi2 = chi * chi;
    const psi = alpha * chi2;
    const c = stumpffC(psi);
    const s = stumpffS(psi);
    const F = rv * chi2 * c + kk * chi2 * chi * s + r0 * chi - sqmuTau;
    const Fp = chi2 * c + rv * chi * (1 - psi * s) + r0 * (1 - psi * c); // = r(chi)

    if (F < 0) lo = chi;
    else hi = chi; // an overflowed or NaN F lands here too, which bisects it back into range

    const d = F / Fp;
    const next = chi - d;
    if (F === 0 || Math.abs(d) <= TOL * chi) {
      if (next > lo && next < hi) chi = next;
      converged = true;
      break;
    }
    // Take the Newton step only if it stays in the bracket and at least halves the last step.
    // Where F grows exponentially (hyperbolic orbits, long steps) Newton alone shrinks chi by
    // a fixed amount per iteration and would crawl, so otherwise bisect (or double, while unbracketed).
    if (next > lo && next < hi && 2 * Math.abs(d) <= lastStep) {
      lastStep = Math.abs(d);
      chi = next;
    } else {
      const bisected = hi === Infinity ? 2 * chi : 0.5 * (lo + hi);
      lastStep = Math.abs(bisected - chi);
      chi = bisected;
    }
  }

  const chi2 = chi * chi;
  const psi = alpha * chi2;
  const c = stumpffC(psi);
  const s = stumpffS(psi);
  const chi3 = chi2 * chi;
  const f = 1 - (chi2 * c) / r0;
  const g = tau - (chi3 * s) / sqmu;
  const x = f * px + g * ux;
  const y = f * py + g * uy;
  const z = f * pz + g * uz;
  const r = Math.sqrt(x * x + y * y + z * z);
  const fdot = (sqmu / (r * r0)) * (alpha * chi3 * s - chi);
  const gdot = 1 - (chi2 * c) / r;

  pos[o] = x;
  pos[o + 1] = y;
  pos[o + 2] = z;
  vel[o] = sgn * (fdot * px + gdot * ux);
  vel[o + 1] = sgn * (fdot * py + gdot * uy);
  vel[o + 2] = sgn * (fdot * pz + gdot * uz);
  return converged;
}
