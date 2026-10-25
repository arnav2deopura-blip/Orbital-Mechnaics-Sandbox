# Three dimensions, and the plane the motion lives in

Every orbit in this app is simulated in three dimensions, with a $z$ for each body. Most famous orbits, like the figure-eight, look flat because they *are* flat: every body starts with $z=0$ and no velocity in $z$. The force between two bodies points along the line joining them, so if all the bodies start in one plane and move in it, nothing ever pushes them out. They stay in the plane forever.

Give one body any height or any vertical speed and that is no longer true. Use the **Bodies** folder to edit $z$ and $v_z$, or the **Perturb** tool to kick a body *out of plane*. The 3D view draws a line from each body down to the reference plane, and a shadow of each trail on it, so you can read heights from any angle.

Which plane? The total angular momentum $\mathbf L$ is conserved, so the plane perpendicular to it, through the center of mass, never moves. It is the **natural plane** of the system. The "Perpendicular to L" setting uses it. When $\mathbf L$ is zero, as in the figure-eight, there is no natural plane and the view uses $z=0$.

Turning a whole system rigidly, with the **Tilt** control, changes nothing physical: the energy and the motion are the same. It only changes how the plane sits in the view.

The most dramatic 3D effect is the **von Zeipel–Lidov–Kozai** cycle. A distant star perturbing an inner binary at an inclination above about 39° makes the inner orbit's eccentricity and inclination trade places over many orbits.

:::deeper
Rotations about any axis through the origin are a symmetry, so the conserved angular momentum is a vector. In the quadrupole, test-particle limit of the Kozai cycle, $\sqrt{1-e^2}\cos i$ is conserved; starting at $i=65^\circ$ with $e\approx0.1$, the eccentricity grows to $\sqrt{1-\tfrac53\cos^2 i}\approx0.84$ while the inclination falls.
:::

[Try it: an inclined test particle around a Kepler pair](index.html#preset=kepler&inclination=60)

[Try it: the Kozai cycle](index.html#preset=zlk&inclination=65)

[Try it: three masses lifted out of the plane, drawn against their natural plane](index.html#preset=sandbox&lift=0.8&plane=angular)
