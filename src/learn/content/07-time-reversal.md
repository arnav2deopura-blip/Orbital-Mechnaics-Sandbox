# Time reversal and roundoff

The laws of motion do not care which way time runs. Run a simulation, flip the direction, and a perfect integrator would retrace its path back to the start. The **Direction** control and the **Return to start** button do exactly that.

- **Leapfrog and Wisdom–Holman** retrace their path to roundoff: the step is symmetric in time.
- **RK4** retraces approximately, with an error of the size of its error going forward.
- **Euler** visibly fails: the error it made on the way out does not cancel on the way back.
- **IAS15** does not retrace exactly, because the step sizes it picks going forward are not the ones it would pick going back.

Even leapfrog fails after a long time in a chaotic system, because the tiny roundoff error in each step grows exponentially. Only arithmetic with *integers* can reverse exactly: Rein and Tamayo's JANUS integrator does this.

:::deeper
A method is time-reversible if applying a step of size $dt$ and then one of size $-dt$ returns the starting state exactly. Leapfrog has this property in exact arithmetic; floating-point addition is not associative, so on a computer it holds to about $10^{-16}$ relative. In a system with a Lyapunov exponent $\lambda$, that roundoff grows as $e^{\lambda t}$, so the time after which reversal fails is about $\lambda^{-1}\ln(1/10^{-16})$.
:::

[Try it: leapfrog on a Kepler orbit; run it, then press Return to start](index.html#preset=kepler&integrator=leapfrog&dt=0.01&speed=2)
