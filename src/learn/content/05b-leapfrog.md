# Leapfrog

## Idea

Kick the velocity by half a step, drift the position by a whole step, then kick the velocity by the other half. The pull at the end of one step is reused at the start of the next.

## Analogy

Two dancers who take turns: one moves while the other stands still, then they swap, and the pattern repeats.

## Strengths and weaknesses

Second order, **symplectic** and **time-reversible**. Its energy error oscillates and does not grow, even over a very long run, and it conserves momentum and angular momentum to roundoff. Its weakness is accuracy per step and close encounters: with a fixed step, a close pass is badly resolved.

## Cost

One force evaluation per step (after the first), because the pull at the end of a step is cached for the next.

## When to use it

Long runs where the *kind* of error matters more than its size, and anything that needs reversing.

:::deeper
Kick-drift-kick: $\mathbf v\leftarrow\mathbf v+\tfrac12\mathbf a(\mathbf x)\,dt$; $\mathbf x\leftarrow\mathbf x+\mathbf v\,dt$; $\mathbf v\leftarrow\mathbf v+\tfrac12\mathbf a(\mathbf x)\,dt$. It is the exact flow of a slightly different Hamiltonian, the *shadow Hamiltonian*, so the energy it conserves differs from the true one by $O(dt^2)$ and stays that close.
:::

[Try it: leapfrog on the figure-eight](index.html#preset=figure-eight&integrator=leapfrog)
