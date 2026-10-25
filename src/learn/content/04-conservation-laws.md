# Conservation laws as a lie detector

The true motion conserves energy, momentum and angular momentum exactly. A simulation conserves them only approximately, and **how it fails to** tells you what kind of method you are looking at. The charts at the bottom show these errors over time.

- **Bounded oscillation**, going up and down but never growing: a symplectic method (leapfrog, Wisdom–Holman).
- **Steady drift**, growing roughly in a straight line: RK4. Accurate step by step, but the small errors all push the same way.
- **Rapid growth**: Euler, or any method at a step that is too big, or an encounter it could not resolve.
- **Slow growth like the square root of time**: IAS15, whose only error is the roundoff of the computer's arithmetic, which accumulates like a random walk.

Momentum and angular momentum are special. Because the force between two bodies is equal, opposite and along the line joining them, leapfrog conserves both to roundoff whatever the step. If those charts rise for leapfrog, something is broken.

Some starting states, like the figure-eight, have an angular momentum of exactly zero, so a *relative* error would divide by zero. The app measures angular momentum error against $\sum m|\mathbf r||\mathbf v|$ instead.

:::deeper
The energy error is $|E-E_0|/|E_0|$. When $E_0$ is nearly zero (a parabolic start) the app divides by $K+|U|$ instead. When softening $\varepsilon$ is on, the potential must be the softened one, $U=-\sum Gm_im_j/\sqrt{r_{ij}^2+\varepsilon^2}$, or the energy chart would show an error that is not there.
:::

[Try it: the figure-eight with RK4, drifting](index.html#preset=figure-eight&integrator=rk4&dt=0.05)

[Try it: the figure-eight with leapfrog, bounded](index.html#preset=figure-eight&integrator=leapfrog&dt=0.05)
