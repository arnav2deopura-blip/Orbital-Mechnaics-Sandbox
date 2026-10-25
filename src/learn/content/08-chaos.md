# Chaos

A system is **chaotic** when nearby starting points drift apart exponentially. Start two copies of the Pythagorean problem a billionth apart, and for a while you cannot tell them apart. Then the bodies pass close to each other, the difference is stretched, and within a few dozen time units the two histories have nothing in common.

The **Compare** folder runs a **ghost twin**: the same system with one body nudged by a tiny amount, drawn as a faint copy over the original. The divergence chart shows the distance between them. On a log axis, exponential growth is a straight line, and its slope is the **Lyapunov exponent**. The reciprocal is the *Lyapunov time*: how long until you lose a factor $e$ of predictability.

A *stable* system does the opposite: the twin stays close, and the divergence grows at most linearly. The figure-eight is like that.

There is a subtlety. An orbit can be **periodic** and still **unstable**. Butterfly I closes up exactly after one period, but any error, even roundoff, grows by about 70% each period, so after some tens of periods it falls apart. The published initial conditions for such orbits need many more digits than the five usually printed; the ones in this app are refined so they close to about 1e-11.

:::deeper
For two nearby states separated by $\delta(0)$, chaos means $\delta(t)\approx\delta(0)e^{\lambda t}$ with $\lambda>0$ the largest Lyapunov exponent. For the three-body problem the exponent depends strongly on the start, and encounters give the bursts of growth you see on the divergence chart. A regular orbit has $\lambda=0$ and $\delta(t)$ grows only linearly, from a slight difference in period.
:::

[Try it: the Pythagorean problem; then start a ghost twin](index.html#preset=pythagorean&speed=2)

[Try it: Butterfly I, periodic but unstable](index.html#preset=suvakov-butterfly-1)
