# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Students and teachers meeting numerical integration and the gravitational few-body problem, at a laptop or in a classroom, with a teacher's explanation or on their own. The job: see what each integration method gets right and wrong on a real system, and trust that what they see is correct. (Inferred from the README and the project's place in an education-dashboards portfolio; not interviewed.)

## Product Purpose
An in-browser sandbox for two- and three-body gravity and the methods used to follow it (Euler, symplectic Euler, leapfrog, RK4, Wisdom-Holman, IAS15). It shows conservation laws, order of accuracy, cost, reversibility and chaos, with a Learn page that explains each idea in plain language and links back into the simulator in a prepared state.

## Positioning
The numerics are checked, not decorative: presets are marked verified only when a test has run them, the energy and momentum diagnostics are computed from true integrator states, and a pair can be compared with the exact Kepler solution. The interface is a scientific instrument, and the math is never traded for looks.

## Capabilities and Constraints
- Two bodies (exactly solvable, the control case) or three (chaotic), chosen with the Bodies switch; the whole interface follows the count.
- Five numerical methods, 3D with a height for every body, a nudged twin or second method for comparison, batch convergence sweeps and a Lyapunov estimate.
- All physics is Float64 and DOM-free in `src/sim`; the renderer only reads snapshots. No server: a static site.
- Module names are Title Case ("Bodies & Physics"); their descriptions are sentence case.

## Brand Commitments
Name: Orbital Mechanics Sandbox. The look was set by the user's brief for this redesign: asymmetric editorial layout, structural typography, a limited palette with one strict accent, 1px rules instead of cards, and none of: floating cards, glassmorphism, heavy shadows, purple or blue neon gradients, gradient text, centered hero sections, 3-column icon grids, generic footers, floating decorative shapes. The palette is dark graphite (the user chose "dark instrument").

## Evidence on Hand
The test suite (golden REBOUND reference numbers, preset verification, per-method order checks) and the Learn page content in `src/learn/content`. No testimonials, users or benchmarks exist; none should be invented.

## Product Principles
1. Correctness first: a pretty wrong picture is worse than none.
2. Show where each method fails, plainly, and say why in the words of the Learn page.
3. A warning names the problem and offers the fix.
4. The same controls work for two bodies and three; the interface never shows a body that is not there.
5. Dense and exact in the controls, quiet around the plate.

## Accessibility & Inclusion
Body colors are chosen to stay distinguishable under protan, deutan and tritan vision; tone is never carried by color alone (a title and a square). Text meets 4.5:1 on its ground. All controls work from the keyboard; motion is limited to state changes and respects `prefers-reduced-motion`.
