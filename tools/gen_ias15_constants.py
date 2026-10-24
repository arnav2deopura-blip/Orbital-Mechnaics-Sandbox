#!/usr/bin/env python3
"""Generate the IAS15 Gauss-Radau constants (plan §4.5) into
src/sim/integrators/ias15_constants.ts, using mpmath at 60 digits.

Derived from the mathematics, not copied from any integrator's source. The step is
built on the left Gauss-Radau rule with N = 8 points on [0, 1]:

  nodes   h_0 = 0 and the roots of (P_7(x) + P_8(x)) / (1 + x) mapped to [0, 1]
          by h = (1 + x) / 2 (P_n is the Legendre polynomial). The rule integrates
          polynomials exactly through degree 2N - 2 = 14, which is what makes a
          step 15th order once the acceleration is integrated twice.

  basis   the acceleration over a step is a(h) = a0 + g_1 N_1(h) + ... + g_7 N_7(h) in
          the Newton basis N_k(h) = h (h - h_1) ... (h - h_{k-1}). A new acceleration at
          node n changes only g_n, which is why the corrector can be updated node by
          node. The b_k of the monomial form a(h) = a0 + sum b_k h^(k+1) are linear in g.

Emitted tables (1-based n, k, m; tri(n, k) = n (n - 1) / 2 + (k - 1)):
  IAS15_H   h_1 .. h_7
  IAS15_NP  N_k(h_n) for k <= n, at tri(n, k)
  IAS15_C   coefficient of h^m in N_k, m <= k, at tri(k, m)
  IAS15_D   D[i][j] (row-major 7 x 7, upper triangular) with g_(i+1) = sum_j D[i][j] b_j

Every table is checked in 60-digit arithmetic before it is written. Usage:

    python3 tools/gen_ias15_constants.py        # needs mpmath
"""

import random
import sys
from fractions import Fraction
from pathlib import Path

from mpmath import matrix, mp, mpf, polyroots

mp.dps = 60

N_POINTS = 8  # h_0 = 0 plus seven more nodes
M = N_POINTS - 1  # number of corrector nodes, and of b and g coefficients

# The tabulated Radau spacings for IAS15 (Everhart 1985; Rein & Spiegel 2015), transcribed by
# hand, kept only as a coarse cross-check of the derivation below. They agree with it to about
# 1e-26 and no better (the gap grows from 5e-31 at h_1 to 1.2e-26 at h_7), so the transcription
# or the printed table is slightly off past the 25th digit. The derived nodes pass Radau
# exactness to 1e-60 and are the authority. The tables are generated, never read from here.
PUBLISHED_H = [
    "0.0562625605369221464656521910318",
    "0.180240691736892364987579942780",
    "0.352624717113169637373907769648",
    "0.547153626330555383001448554766",
    "0.734210177215410531523210605558",
    "0.885320946839095768090359771030",
    "0.977520613561287501891174488626",
]

OUT = Path(__file__).resolve().parent.parent / "src" / "sim" / "integrators" / "ias15_constants.ts"


def tri(n: int, k: int) -> int:
    return n * (n - 1) // 2 + (k - 1)


def legendre(n: int) -> list[Fraction]:
    """Coefficients of P_n(x) in ascending powers, exact."""
    p_prev, p = [Fraction(1)], [Fraction(0), Fraction(1)]
    if n == 0:
        return p_prev
    for k in range(1, n):  # (k + 1) P_(k+1) = (2k + 1) x P_k - k P_(k-1)
        nxt = [Fraction(0)] * (k + 2)
        for i, c in enumerate(p):
            nxt[i + 1] += (2 * k + 1) * c
        for i, c in enumerate(p_prev):
            nxt[i] -= k * c
        p_prev, p = p, [c / (k + 1) for c in nxt]
    return p


def radau_nodes() -> list:
    """h_1 .. h_7: roots of (P_7 + P_8) / (1 + x), mapped from [-1, 1] to [0, 1]."""
    lo, hi = legendre(N_POINTS - 1), legendre(N_POINTS)
    q = [hi[i] + (lo[i] if i < len(lo) else 0) for i in range(len(hi))]  # ascending
    # Divide by (x + 1) exactly: P_7(-1) + P_8(-1) = -1 + 1 = 0.
    desc = q[::-1]
    quot = [desc[0]]
    for c in desc[1:-1]:
        quot.append(c - quot[-1])
    assert desc[-1] - quot[-1] == 0, "(P7 + P8) is not divisible by (x + 1)"
    roots = polyroots([mpf(c.numerator) / c.denominator for c in quot], maxsteps=500, extraprec=300)
    assert len(roots) == M and all(abs(r.imag) < mpf(10) ** -50 for r in roots)
    return sorted((1 + r.real) / 2 for r in roots)


def poly_mul_linear(poly: list, root) -> list:
    """poly(h) * (h - root), ascending coefficients."""
    out = [mpf(0)] * (len(poly) + 1)
    for i, c in enumerate(poly):
        out[i + 1] += c
        out[i] -= root * c
    return out


def poly_eval(poly: list, x):
    acc = mpf(0)
    for c in reversed(poly):
        acc = acc * x + c
    return acc


def check_quadrature(h: list) -> float:
    """The rule on h_0 = 0, h_1 .. h_7 must integrate h^p exactly for p <= 14 and not for p = 15."""
    nodes = [mpf(0)] + h
    vand = matrix(N_POINTS, N_POINTS)
    for p in range(N_POINTS):
        for j, hj in enumerate(nodes):
            vand[p, j] = hj**p
    w = mp.lu_solve(vand, matrix([mpf(1) / (p + 1) for p in range(N_POINTS)]))
    worst = max(abs(sum(w[j] * nodes[j] ** p for j in range(N_POINTS)) - mpf(1) / (p + 1)) for p in range(2 * N_POINTS - 1))
    miss = abs(sum(w[j] * nodes[j] ** (2 * N_POINTS - 1) for j in range(N_POINTS)) - mpf(1) / (2 * N_POINTS))
    assert worst < mpf(10) ** -50, f"not exact through degree {2 * N_POINTS - 2}: {worst}"
    assert miss > mpf(10) ** -12, "exact beyond degree 14, so this is not a Radau rule"
    assert all(wj > 0 for wj in w), "Radau weights must be positive"
    return float(worst)


def main() -> None:
    h = radau_nodes()
    assert all(0 < a < b < 1 for a, b in zip(h, h[1:])) and 0 < h[0]

    # The authority: Radau exactness at 60 digits. Then the coarse cross-check against the
    # tabulated spacings: agreement to 24 digits, and the very same doubles.
    quad_err = check_quadrature(h)
    gap = max(abs(a - mpf(b)) for a, b in zip(h, PUBLISHED_H))
    assert gap < mpf(10) ** -24, f"derived nodes disagree with the published spacings: {gap}"
    assert all(float(a) == float(mpf(b)) for a, b in zip(h, PUBLISHED_H)), "doubles differ from the published ones"

    # Newton basis N_k(h) = h (h - h_1) ... (h - h_(k-1)), as ascending coefficients.
    nodes = [mpf(0)] + h
    basis = [[mpf(1)]]
    for k in range(1, M + 1):
        basis.append(poly_mul_linear(basis[-1], nodes[k - 1]))
    for k in range(1, M + 1):  # N_k vanishes at h_0 .. h_(k-1)
        assert all(abs(poly_eval(basis[k], nodes[j])) < mpf(10) ** -55 for j in range(k))

    np_tab = [None] * (M * (M + 1) // 2)
    c_tab = [None] * (M * (M + 1) // 2)
    for n in range(1, M + 1):
        for k in range(1, n + 1):
            np_tab[tri(n, k)] = poly_eval(basis[k], nodes[n])
    for k in range(1, M + 1):
        for m in range(1, k + 1):
            c_tab[tri(k, m)] = basis[k][m]
    assert all(c_tab[tri(k, k)] == 1 for k in range(1, M + 1)), "N_k is monic, so b_(k-1) gains g_k exactly"

    # b_j = sum_(i >= j) U[j][i] g_i, with U[j][i] the coefficient of h^(j+1) in N_(i+1); D = U^-1.
    u = matrix(M, M)
    for j in range(M):
        for i in range(j, M):
            u[j, i] = c_tab[tri(i + 1, j + 1)]
    d = u**-1
    ident_err = max(abs((u * d)[i, j] - (1 if i == j else 0)) for i in range(M) for j in range(M))
    assert ident_err < mpf(10) ** -50

    # End to end: a random degree-7 acceleration polynomial through the same recursion the
    # integrator runs, node by node. It must give back exactly the b we started from.
    rng = random.Random(15)
    a0 = mpf(rng.uniform(-1, 1))
    b_true = [mpf(rng.uniform(-1, 1)) for _ in range(M)]
    a_at = lambda x: a0 + sum(b_true[k] * x ** (k + 1) for k in range(M))  # noqa: E731
    g = [mpf(0)] * (M + 1)
    for n in range(1, M + 1):
        rhs = a_at(nodes[n]) - a0 - sum(g[k] * np_tab[tri(n, k)] for k in range(1, n))
        g[n] = rhs / np_tab[tri(n, n)]
    b_rec = [sum(c_tab[tri(k, j + 1)] * g[k] for k in range(j + 1, M + 1)) for j in range(M)]
    round_trip = max(abs(b_rec[j] - b_true[j]) for j in range(M))
    g_back = [sum(d[i, j] * b_true[j] for j in range(i, M)) for i in range(M)]
    g_err = max(abs(g_back[i] - g[i + 1]) for i in range(M))
    assert round_trip < mpf(10) ** -50 and g_err < mpf(10) ** -50

    print(f"nodes vs published: {float(gap):.1e}   quadrature (degree <= 14): {quad_err:.1e}", file=sys.stderr)
    print(f"U D = I: {float(ident_err):.1e}   b round trip: {float(round_trip):.1e}   g from b: {float(g_err):.1e}", file=sys.stderr)

    OUT.write_text(render(h, np_tab, c_tab, d))
    print(f"wrote {OUT}", file=sys.stderr)


def fmt(values: list, per_line: int = 4) -> str:
    nums = [repr(float(v)) for v in values]
    lines = ["  " + ", ".join(nums[i : i + per_line]) + "," for i in range(0, len(nums), per_line)]
    return "\n".join(lines)


def render(h: list, np_tab: list, c_tab: list, d) -> str:
    d_flat = [d[i, j] for i in range(M) for j in range(M)]
    spacing = "\n".join(f" *   h{i + 1} = {mp.nstr(x, 31)}" for i, x in enumerate(h))
    return f"""// Generated by tools/gen_ias15_constants.py. Do not edit by hand. Plan §4.5.
//
// Left Gauss-Radau constants for the 15th-order IAS15 step, derived at 60 digits and checked
// there (Radau exactness through degree 14, table inverses, a polynomial round trip). See the
// generator for the derivation. Indices below are 1-based in the comments, 0-based in the
// arrays. tri(n, k) = n (n - 1) / 2 + (k - 1) for 1 <= k <= n <= 7.

/**
 * Radau spacings h_1 .. h_7 on [0, 1]. h_0 = 0 is implicit.
{spacing}
 */
export const IAS15_H = Float64Array.of(
{fmt(h)}
);

/** N_k(h_n) = h_n (h_n - h_1) ... (h_n - h_(k-1)) for k <= n, at index tri(n, k). */
export const IAS15_NP = Float64Array.of(
{fmt(np_tab)}
);

/** Coefficient of h^m in N_k(h) = h (h - h_1) ... (h - h_(k-1)), for m <= k, at index tri(k, m). */
export const IAS15_C = Float64Array.of(
{fmt(c_tab)}
);

/** Row-major 7 x 7, upper triangular: g_(i+1) = sum over j >= i of D[7 i + j] b_j. */
export const IAS15_D = Float64Array.of(
{fmt(d_flat)}
);
"""


if __name__ == "__main__":
    main()
