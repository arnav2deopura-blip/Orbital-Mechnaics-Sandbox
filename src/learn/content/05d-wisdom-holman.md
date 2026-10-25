# Wisdom–Holman

## Idea

Let Kepler do the heavy lifting. Treat each body's orbit around the dominant mass as an *exact* Kepler orbit, and add the pull between the bodies as a small kick.

## Analogy

Following a river by its known course, and correcting only for the gusts of wind.

## Strengths and weaknesses

Symplectic and second order, with an error proportional to the *size of the perturbation*, so it is superb when one mass dominates (a star with planets). For comparable masses, like the figure-eight, the pull between the bodies is not small, the advantage disappears, and a close pass breaks it. It cannot use softening, because the Kepler part is exactly Newtonian.

## Cost

One force evaluation and two Kepler solves per step.

## When to use it

Hierarchical systems: a star, planet and moon, or a Sun-Jupiter-Trojan. Choose the central body well: for a moon, make the planet central.

:::deeper
In Jacobi coordinates each relative coordinate moves on a Kepler orbit with $\mu_i=G\eta_i$, where $\eta_1=m_0+m_1$ and $\eta_2$ is the total mass. A step is drift ($dt/2$, exact Kepler motion), kick ($dt$, the interaction part of the force) and drift again. A common rule of thumb is to keep $dt$ below about a twentieth of the shortest orbital period; the presets here use about a fortieth.
:::

[Try it: a star, planet and moon](index.html#preset=star-planet-moon)

[Try it: a Trojan librating around L4](index.html#preset=trojan)
