# Glossary

**Adaptive.** An integrator that chooses its own step size as it goes (IAS15).

**Angular momentum.** $\mathbf L=\sum m\,\mathbf r\times\mathbf v$. Conserved. Its direction defines the natural plane of the system.

**Chaos.** Exponential sensitivity to the starting state.

**Center of mass (COM).** The mass-weighted average position. The app shifts every system to the frame where it is at rest at the origin.

**Close encounter.** Two bodies passing very near each other, where forces are huge and fixed steps fail.

**Energy error.** $|E-E_0|/|E_0|$: how far the energy has strayed from its starting value.

**Force evaluation.** One computation of the pull on all three bodies; the honest unit of cost.

**Hill radius.** $a(m/3M)^{1/3}$: the size of the region around a planet where its own gravity wins over the star's.

**Integrator.** A recipe for taking one time step.

**Jacobi coordinates.** Positions measured relative to the center of mass of the bodies already counted: the natural coordinates for Wisdom–Holman.

**Kepler problem.** Two bodies attracting each other, the one gravitational problem with an exact solution: the orbit is a conic section and a formula gives the position at any time.

**Kepler's laws.** The orbit is an ellipse (or another conic section), equal areas are swept in equal times, and the square of the period is proportional to the cube of the orbit's size.

**Laplace-Runge-Lenz vector.** An extra conserved arrow of the two-body problem, along the long axis of the orbit and pointing at its closest point. It is why bound two-body orbits close, and it has no counterpart for three bodies.

**Lyapunov time.** The time for nearby states to separate by a factor $e$ in a chaotic system.

**Order.** A method of order $p$ has a global error that shrinks like $dt^p$.

**Periodic orbit.** A solution that returns exactly to its starting state after a period.

**Predictability horizon.** How long a computed path can be trusted in a chaotic system: roughly the Lyapunov time times $\ln(0.1/\varepsilon)$, for an error of relative size $\varepsilon$. After it the path is one of many equally valid ones.

**Reduced mass.** $\mu=m_1m_2/(m_1+m_2)$: the mass of the single imaginary body that moves like the separation of a pair.

**Softening.** Replacing $r^2$ by $r^2+\varepsilon^2$ in the force so that close encounters are gentler.

**Symplectic.** Preserving phase-space volume: the property that keeps the energy error bounded.

**Time step.** The size $dt$ of one move of the simulation.

**Trojan.** A body sharing a planet's orbit, 60° ahead or behind it.
