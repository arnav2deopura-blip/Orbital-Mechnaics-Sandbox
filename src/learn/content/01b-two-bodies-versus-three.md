# Two bodies, and what the third changes

Two bodies are the one gravitational problem that is completely solved. Add a third and the solution is gone. This chapter is about why, and about what that difference looks like in the simulator. The **Bodies** switch at the top of the simulator flips between the two.

## Two bodies are really one

Two bodies pulling on each other look like a tangle: each one moves because of the other. But the tangle comes apart. The **center of mass** between them just drifts in a straight line at a constant speed, so you can ride along with it and forget it. What is left is a single number to track: the arrow from one body to the other, which moves exactly like *one* body circling a fixed center, with the pair's total mass doing the pulling.

That one-body problem is the one Newton solved. Its orbits are the **conic sections**: an ellipse if the pair is bound, a parabola if it only just escapes, a hyperbola if it flies past and never returns. Each of the two bodies traces its own ellipse around the center of mass, the heavier one on the smaller path, and both take the same time to go round.

Three old rules of Kepler fall out of this, and the simulator uses all three:

- **The orbit is an ellipse** (or one of the other conics), and it never changes shape.
- **Equal areas in equal times.** The pair sweeps out area at a constant rate, which is the conservation of angular momentum seen from the side. It is why the bodies hurry through the close part of an orbit and dawdle through the far part.
- **The period depends on the size.** The square of the period is proportional to the cube of the orbit's size and falls as the total mass grows. This is also how the simulator picks its basic unit of time, the characteristic time $T_{char}$.

:::deeper
Put $\mathbf r=\mathbf r_2-\mathbf r_1$ and $M=m_1+m_2$. The two equations of motion combine into $\ddot{\mathbf r}=-GM\,\mathbf r/|\mathbf r|^3$, and the center of mass moves as $\mathbf R(t)=\mathbf R_0+\mathbf V t$. Equivalently, one particle of the *reduced mass* $\mu=m_1m_2/M$ moves in the field of a fixed mass $M$. The conserved energy per reduced mass is $\varepsilon=\tfrac12|\dot{\mathbf r}|^2-GM/|\mathbf r|$: negative for an ellipse, zero for a parabola, positive for a hyperbola. For an ellipse of semi-major axis $a=-GM/(2\varepsilon)$ the period is $T=2\pi\sqrt{a^3/(GM)}$, which is Kepler's third law, and the orbit is $|\mathbf r|=p/(1+e\cos\theta)$ with $p=h^2/(GM)$, where $\mathbf h=\mathbf r\times\dot{\mathbf r}$ is the angular momentum per reduced mass. Its constancy is the area law.
:::

[Try it: two bodies on an exact Kepler orbit](index.html#preset=kepler-orbit)

[Try it: a circular binary, with the same separation at every moment](index.html#preset=circular-binary)

[Try it: a hyperbolic flyby, the one two-body orbit that does not close](index.html#preset=hyperbolic-flyby)

## Why two can be solved and three cannot

Count the numbers. Each body needs three for its position and three for its velocity, so a pair has 12 numbers of state and a triple has 18. The center of mass takes care of 6 of them in either case. That leaves 6 for a pair and 12 for a triple.

For a pair, the conserved quantities are enough to nail down almost everything. The energy, the angular momentum and one more, the **Laplace-Runge-Lenz vector** (an arrow fixed along the long axis of the ellipse, pointing at the closest point), fix the orbit's size, shape and tilt. Only one thing is left open: *where on the orbit the bodies are at a given moment*. A single equation, Kepler's equation, answers that. So there is a formula: put in a time, get a position.

For a triple, the energy and the angular momentum leave eight of the twelve numbers unaccounted for, and there is no extra conserved quantity to fix them. Bruns and Poincaré showed that no such formula-friendly quantity exists. The remaining motion is free to be complicated, and for most starting states it is chaotic.

:::deeper
A pair's relative motion has six phase-space dimensions and five independent integrals: $E$, the three components of $\mathbf L$, and the Laplace-Runge-Lenz vector $\mathbf A=\dot{\mathbf r}\times\mathbf h-GM\,\hat{\mathbf r}$, which obey the relations $\mathbf A\cdot\mathbf h=0$ and $|\mathbf A|^2=G^2M^2+2\varepsilon h^2$ (so seven quantities give five independent ones). This is called *maximally superintegrable*, and it is why every bound orbit closes. The three-body relative motion has twelve dimensions and only the four integrals $E$ and $\mathbf L$. Sundman found in 1912 a convergent series for the three-body problem (when the angular momentum is not zero), but it converges so slowly that it is useless for computing anything.
:::

## Side by side

| | Two bodies | Three bodies |
|---|---|---|
| Numbers of state (after the center of mass) | 6 | 12 |
| A formula for the motion | Yes: Kepler's equation | No |
| Shape of the orbit | Always a conic section, closed if bound | Usually not closed; a few special orbits repeat |
| Nearby starting states | Drift apart only slowly, in proportion to time | Often pull apart exponentially: chaos |
| What happens in the end | Bound forever, or one flyby and gone | One body can be thrown out while the other two stay tied |
| What a negative total energy means | The pair stays together forever | Not all three can escape, but one still can |
| How the simulator judges a method | Against the exact orbit | Against the conservation laws, a ghost twin and a chaos probe |

The rows about the ending and about negative energy are worth a second look. In two bodies, "bound" is a promise. In three it is only a statement about the *total*: the energy can be handed from one body to the others, and the **Pythagorean problem** ends exactly that way, with the lightest body flung away and the other two left in a tight orbit. This is also why the simulator's warnings talk about a body "escaping" rather than just checking the energy.

[Try it: the figure-eight, a rare orbit that is exactly periodic](index.html#preset=figure-eight)

[Try it: the Pythagorean problem, where one body is thrown out](index.html#preset=pythagorean&speed=2)

## What the simulator does differently with two bodies

Switching to two bodies is not the same as setting the third mass to zero. The third body is removed completely, and a number of things change with it:

- **The exact orbit is known**, so a chart called *Error against the exact Kepler solution* appears by itself. For any method you can see precisely how far it has strayed from the truth, not just how far it has broken a conservation law. In a three-body run it appears only when one of the bodies has no mass, which leaves the other two on an exact Kepler orbit.
- **Nothing here is chaotic**, so the chaos probe stays off for two bodies and the Live Numbers say so.
- **The Routh ratio goes away.** It is a rule for when a triangle of three bodies is stable, and a pair has no such question.
- **Wisdom-Holman is exact for a pair.** It follows each orbit as an exact Kepler motion and adds the pull between the bodies as a small correction. With two bodies there is nothing to correct, so the method has no error left but roundoff.
- **The methods show their pure faults.** On a circular binary Euler spirals outward and leapfrog keeps the circle, with no chaos to blur it. A symplectic method such as leapfrog keeps the *size* and *shape* of an eccentric orbit almost exactly, and its error appears instead as a slow turning of the ellipse and a small drift in *when* the bodies arrive.
- **The warnings talk about "the pair"** and judge an escape by the two bodies leaving each other.

[Try it: Euler on a circular binary, spiraling outward](index.html#preset=circular-binary&integrator=euler&dt=0.01&speed=1)

[Try it: leapfrog on a circular binary, which keeps the circle](index.html#preset=circular-binary&integrator=leapfrog&dt=0.05)

[Try it: a near-radial plunge, where a fixed step struggles at the close pass](index.html#preset=near-radial)

[Try it: two bodies of unequal mass, free to explore](index.html#preset=sandbox-2)

## The middle ground

Between two bodies and a true three-body problem are two cases that are almost solvable, and the simulator has both.

- **A third body with no mass** (a *test particle*). It feels the other two but does not pull on them, so the pair stays on its exact Kepler orbit and the test particle moves in the pair's changing field. It is the *restricted* three-body problem, and it is the cleanest way to see what a third body does without it disturbing the first two.
- **A pair with a small disturbance.** In a star with a planet and a moon, or a star with two planets far apart, each pair is nearly a Kepler orbit and the third body adds only a small kick. This is exactly the case Wisdom-Holman is built for: it solves the Keplerian part exactly and spends its effort only on the disturbance.

The three-body problem becomes genuinely hard when none of these shortcuts apply: three masses of a similar size, close together, with nothing small about the pull between any of them.

[Try it: a test particle around a Kepler pair](index.html#preset=kepler)

[Try it: a moon around a planet around a star, mostly Kepler](index.html#preset=star-planet-moon)
