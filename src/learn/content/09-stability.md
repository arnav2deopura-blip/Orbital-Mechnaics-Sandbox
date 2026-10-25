# Stability of special solutions

Some exact solutions are known. Whether you can see them in practice depends on whether they are **stable**.

**Lagrange's equilateral triangle.** Three masses at the corners of an equilateral triangle, turning rigidly about their center of mass, are an exact solution for *any* masses. It is stable only if one mass dominates: the **Routh criterion** says stability needs

$$27\,(m_1m_2+m_2m_3+m_3m_1) < (m_1+m_2+m_3)^2.$$

With masses $(m,1,1)$ that means $m$ above about 50.5. The Diagnostics folder shows the Routh value live; below 1 is stable. Equal masses give 9, so the triangle is unstable: nudge it with the Perturb tool and it flies apart.

**Euler's collinear solution.** Three masses in a line, turning together, are periodic but unstable.

**Trojans.** A tiny body near the Lagrange point 60° ahead of Jupiter (L4) is stable, because Jupiter is light compared to the Sun. Start it exactly at L4 and nothing happens, since that is an exact solution. Start it a little away and it *librates* around L4 in a tadpole-shaped path.

**A moon around a planet.** A moon is stable if it stays well inside the planet's **Hill sphere**, whose radius is $R_H=a\,(m/3M)^{1/3}$. A circular orbit going the same way as the planet survives out to about 0.45 of $R_H$ in the simulation here, and is lost beyond about 0.5.

:::deeper
Linearizing the equations about Lagrange's solution gives a quartic in the growth rate whose roots are all imaginary (stable) exactly when the Routh inequality holds. For the restricted problem, the Trojan's stability needs the mass ratio $\mu<(1-\sqrt{23/27})/2\approx0.0385$; Jupiter's is about $9.5\times10^{-4}$.
:::

[Try it: Lagrange's triangle with a dominant mass (stable)](index.html#preset=lagrange&mass=100)

[Try it: Lagrange's triangle just below the stability limit (nudge it with the Perturb tool and watch it come apart slowly)](index.html#preset=lagrange&mass=45)

[Try it: a Trojan librating around L4](index.html#preset=trojan&offset=10&inclination=8)

[Try it: a moon beyond its stable distance](index.html#preset=star-planet-moon&fraction=0.5)
