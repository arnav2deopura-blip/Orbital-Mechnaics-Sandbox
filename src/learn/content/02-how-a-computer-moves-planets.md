# How a computer "moves" planets

A computer cannot follow a body continuously. It freezes time, works out the pull on each body, moves them a little, and repeats. The little move is a **time step** of size $dt$, and the recipe for the move is an **integrator**.

Think of crossing a river on stepping-stones. Each stone is one step. Small steps stay close to the true path; big steps cut corners. The skill is in how well you can guess where the next stone should go.

The simplest recipe is Euler's: use the pull *now* to change the velocity, and the velocity *now* to change the position. It is easy, and in this app you can see how wrong it goes: an orbit that should close on itself spirals outward.

Better integrators look at the pull in more than one place, or choose their steps cleverly. The five here are Euler, leapfrog, RK4, Wisdom–Holman and IAS15. Each has its own card below.

:::deeper
All five solve the same first-order system for the state $(\mathbf x,\mathbf v)$: $\dot{\mathbf x}=\mathbf v$ and $\dot{\mathbf v}=\mathbf a(\mathbf x)$. They differ in how they approximate the integral of $\mathbf a$ over one step. The acceleration $\mathbf a$ depends only on positions, which is what makes leapfrog and Wisdom–Holman possible.
:::

[Try it: Euler on a Kepler orbit, spiraling outward](index.html#preset=kepler-orbit&integrator=euler&dt=0.005&speed=1)
