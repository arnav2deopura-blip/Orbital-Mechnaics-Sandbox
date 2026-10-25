# Symplectic, simply

Imagine all the possible states of a system as points in a space whose axes are positions and velocities. A set of nearby starting points forms a small cloud in that space. The true motion stretches and twists the cloud, but it never changes its **volume**.

A **symplectic** integrator is one that keeps that property too. It does not follow the true motion exactly, but it follows the exact motion of a *slightly different* system, called the **shadow Hamiltonian**. That nearby system has its own conserved energy, which is the true energy plus a small wobble. So the energy you measure wobbles and never drifts away.

That is why symplectic methods are used to follow the planets for millions of years. A method with a smaller error per step but no symplectic property (RK4) would slowly drift away.

Symplectic does not mean accurate. It means the error has a *shape*. Take a step that is too large and a symplectic method is still wrong, but wrong in a way that stays bounded.

:::deeper
A map $(\mathbf q,\mathbf p)\mapsto(\mathbf q',\mathbf p')$ is symplectic if its Jacobian $J$ satisfies $J^{T}\Omega J=\Omega$ with $\Omega=\begin{pmatrix}0&I\\-I&0\end{pmatrix}$. Backward error analysis shows a symplectic integrator of order $p$ is the exact flow of $\tilde H=H+dt^{p}H_p+\dots$, so $H$ itself oscillates by $O(dt^p)$ for exponentially long times. Symplectic Euler and leapfrog are the first two examples; each is a composition of exact flows of the kinetic and potential parts of $H$.
:::

[Try it: symplectic Euler, bounded where explicit Euler is not](index.html#preset=figure-eight&integrator=symplectic-euler&dt=0.002)
