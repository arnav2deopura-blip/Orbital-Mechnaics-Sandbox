# What is the three-body problem?

Two bodies that attract each other move on perfect ellipses (or parabolas, or hyperbolas). Kepler and Newton solved that completely: write down a formula, put in a time, get a position. Add a **third** body and the formula disappears.

Each body is pulled by the other two:

$$\ddot{\mathbf r}_i = G\sum_{j\neq i} m_j\,\frac{\mathbf r_j-\mathbf r_i}{|\mathbf r_j-\mathbf r_i|^3}$$

In the late 1800s Bruns and Poincaré showed that the known conserved quantities are not enough to solve it in closed form. Poincaré also noticed the deeper problem: tiny differences in the starting point can grow into completely different futures. So we do not look for a formula. We **simulate**: take small steps in time and add them up, which is the subject of the next section.

Three bodies do still obey a few exact rules, and these matter for checking a simulation. There are ten conserved quantities: the energy (1), the total momentum (3), the motion of the center of mass (3) and the total angular momentum (3).

:::deeper
The ten integrals are $E=\sum \tfrac12 m_i v_i^2-\sum_{i<j} G m_i m_j/r_{ij}$, $\mathbf P=\sum m_i\mathbf v_i$, $\mathbf R(t)=\mathbf R_0+\mathbf P t/M$ and $\mathbf L=\sum m_i\,\mathbf r_i\times\mathbf v_i$. They come from the symmetries of the force: time translation, space translation, Galilean boosts and rotation. For three bodies they are not enough: the system has 18 numbers of state, and 10 integrals leave a chaotic remainder.
:::

[Try it: the figure-eight, a rare orbit that is exactly periodic](index.html#preset=figure-eight)

[Try it: the Pythagorean problem, a long chaotic dance that ends in an ejection](index.html#preset=pythagorean&speed=2)

## Two bodies, as a control

The **Bodies** switch at the top of the simulator takes the third body away. What is left is the one case that does have a formula, so it is the best test there is: every method can be checked against the exact orbit. The [next chapter](learn.html#two-bodies-versus-three) explains why a pair can be solved and a triple cannot, and what changes in the simulator when you switch.
