# Chaos

A system is **chaotic** when nearby starting points drift apart exponentially. Start two copies of the Pythagorean problem a billionth apart, and for a while you cannot tell them apart. Then the bodies pass close to each other, the difference is stretched, and within a few dozen time units the two histories have nothing in common.

The **Compare** folder runs a **ghost twin**: the same system with one body nudged by a tiny amount, drawn as a faint copy over the original. The divergence chart shows the distance between them. On a log axis, exponential growth is a straight line, and its slope is the **Lyapunov exponent**. The reciprocal is the *Lyapunov time*: how long until you lose a factor $e$ of predictability.

A *stable* system does the opposite: the twin stays close, and the divergence grows at most linearly. The figure-eight is like that.

**The sandbox checks for you.** When you load a three-body system, a probe running in the background follows two copies of it that start a hundred-millionth of the system's size apart, and times how fast they pull away from each other. If they separate by a factor of $e$ in fewer than about three periods, a notice says the run is chaotic; in fewer than one, extremely chaotic. It also says how long the path on screen can be trusted: about the Lyapunov time times $\ln(0.1/\varepsilon)$, where $\varepsilon$ is the error the method makes (never less than rounding). Past that point you are watching one possible path, not a prediction, even though the energy is still conserved. *Show me* starts a ghost twin so you can watch the gap open.

The probe says nothing about two bodies, which are never chaotic. And "no sign of chaos" means none showed up in the first 48 periods, not a proof: a slow instability can look calm for longer than the probe watches.

There is a subtlety. An orbit can be **periodic** and still **unstable**. Butterfly I closes up exactly after one period, but any error, even roundoff, grows by about 70% each period, so after some tens of periods it falls apart. The published initial conditions for such orbits need many more digits than the five usually printed; the ones in this app are refined so they close to about 1e-11.

:::deeper
For two nearby states separated by $\delta(0)$, chaos means $\delta(t)\approx\delta(0)e^{\lambda t}$ with $\lambda>0$ the largest Lyapunov exponent. For the three-body problem the exponent depends strongly on the start, and encounters give the bursts of growth you see on the divergence chart. A regular orbit has $\lambda=0$ and $\delta(t)$ grows only linearly, from a slight difference in period.
:::

[Try it: the Pythagorean problem; then start a ghost twin](index.html#preset=pythagorean&speed=2)

[Try it: Butterfly I, periodic but unstable](index.html#preset=suvakov-butterfly-1)
