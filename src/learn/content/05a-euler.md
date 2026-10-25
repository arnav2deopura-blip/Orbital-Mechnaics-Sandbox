# Euler

## Idea

Use the pull now to change the velocity, and the velocity now to change the position. One force evaluation per step.

## Analogy

Walking while looking only at your feet: you steer by where you are, never by where you are going.

## Strengths and weaknesses

Easy to write and to understand. It is only first order, and it is not symplectic, so energy grows every step and orbits spiral outward. Swapping two lines (update the velocity first, then move with the *new* velocity) gives the **symplectic Euler** variant, whose energy error stays bounded: one reordered line, a different method.

## Cost

One force evaluation per step, the cheapest there is.

## When to use it

To show how an integrator fails, and (as symplectic Euler) to show that reordering one line makes it behave.

:::deeper
Explicit Euler is $\mathbf x\leftarrow\mathbf x+\mathbf v\,dt$, $\mathbf v\leftarrow\mathbf v+\mathbf a(\mathbf x)\,dt$ with the old values on the right. Symplectic Euler is $\mathbf v\leftarrow\mathbf v+\mathbf a(\mathbf x)\,dt$, $\mathbf x\leftarrow\mathbf x+\mathbf v\,dt$ with the *new* velocity. The first multiplies the phase-space area by $1+O(dt^2)$ every step, which is the growth in energy; the second preserves it exactly.
:::

[Try it: explicit Euler on a Kepler orbit](index.html#preset=kepler-orbit&integrator=euler&dt=0.005&speed=1)

[Try it: symplectic Euler on the same orbit](index.html#preset=kepler-orbit&integrator=symplectic-euler&dt=0.005&speed=1)
