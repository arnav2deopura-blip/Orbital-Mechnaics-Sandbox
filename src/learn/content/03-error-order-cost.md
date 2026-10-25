# Error, order and cost

An integrator's error has two kinds. The **local error** is the mistake made in a single step. The **global error** is what you see at the end, after all the steps have added up. If a method has **order** $p$, halving $dt$ makes the global error about $2^p$ times smaller.

| Method | Order | Force evaluations per step |
|---|---|---|
| Euler | 1 | 1 |
| Leapfrog | 2 | 1 |
| RK4 | 4 | 4 |
| Wisdom–Holman | 2 (times a small factor) | 1, plus two Kepler solves |
| IAS15 | 15 | about 20, varies |

A high order is not free. The honest measure of **cost** is the number of force evaluations, because that is where the time goes. RK4 takes four per step, so to compare it fairly with leapfrog you give it a step four times as long. The *Compare* folder has an "equalize cost" switch that does exactly that.

:::deeper
A method of order $p$ has a local error of $O(dt^{p+1})$. Over a fixed time $T$ there are $T/dt$ steps, so the global error is $O(dt^p)$. This only holds while $dt$ is small enough for the error expansion to be valid: with steps near the orbital period, every method fails. The batch tool in this app measures the slope of error against step size on a log-log plot, and it should read 1, 2 and 4 for Euler, leapfrog and RK4.
:::

[Try it: leapfrog and RK4 on the same orbit at the same step](index.html#preset=kepler&integrator=leapfrog&dt=0.05)
