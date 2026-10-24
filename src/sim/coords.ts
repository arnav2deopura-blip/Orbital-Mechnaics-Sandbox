// Jacobi <-> inertial transforms (plan §4.4). The COM shift of plan §3.2 is not here yet.
//
// Jacobi coordinates for three bodies ordered (central, inner companion, outer), with
// eta1 = m0 + m1 and M = m0 + m1 + m2:
//
//   j[0..2] = COM             = (m0 q0 + m1 q1 + m2 q2) / M
//   j[3..5] = q1 - q0                      (inner body about the central one)
//   j[6..8] = q2 - (m0 q0 + m1 q1) / eta1  (outer body about the inner pair's COM)
//
// m is in the same body order as q and j, and needs eta1 > 0. The map is linear, so one
// function converts positions, velocities and accelerations alike. For accelerations of a
// pairwise force, j[0..2] = sum m a / M is zero up to roundoff.
//
// Both functions allocate nothing, and the output may be the same array as the input:
// each component's three entries are all read before any of them is written.

/** Inertial -> Jacobi. */
export function inertialToJacobi(m: Float64Array, q: Float64Array, j: Float64Array): void {
  const m0 = m[0];
  const m1 = m[1];
  const m2 = m[2];
  const eta1 = m0 + m1;
  const M = eta1 + m2;
  for (let c = 0; c < 3; c++) {
    const q0 = q[c];
    const q1 = q[3 + c];
    const q2 = q[6 + c];
    const pair = m0 * q0 + m1 * q1;
    j[c] = (pair + m2 * q2) / M;
    j[3 + c] = q1 - q0;
    j[6 + c] = q2 - pair / eta1;
  }
}

/** Jacobi -> inertial. The inverse of inertialToJacobi, using the COM entry j[0..2] as given. */
export function jacobiToInertial(m: Float64Array, j: Float64Array, q: Float64Array): void {
  const m0 = m[0];
  const m1 = m[1];
  const m2 = m[2];
  const eta1 = m0 + m1;
  const M = eta1 + m2;
  const outerShare = m2 / M;
  const w0 = m0 / eta1;
  const w1 = m1 / eta1;
  for (let c = 0; c < 3; c++) {
    const r1 = j[3 + c];
    const r2 = j[6 + c];
    const pairCom = j[c] - outerShare * r2; // COM of bodies 0 and 1
    q[c] = pairCom - w1 * r1;
    q[3 + c] = pairCom + w0 * r1;
    q[6 + c] = pairCom + r2;
  }
}
