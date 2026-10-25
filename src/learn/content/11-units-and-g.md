# Units and G

The simulation uses numbers without units, with $G$ as a setting. Most presets use **N-body units**, $G=1$ and masses of order one, so a distance of 1 and a time of about 6 are typical.

The Sun–Jupiter–Trojan and star–planet–moon presets use **astronomical units**: distance in AU, mass in solar masses, time in years. In those, $G=4\pi^2$, because a body at 1 AU around one solar mass takes one year.

Changing $G$ changes the energy, so the energy and angular momentum references restart from the moment you change it.

The **characteristic time** $T_{char}$ sets the speed slider's units ("periods per second") and the sampling of the charts. It is the shortest two-body period over the pairs, $2\pi\sqrt{r_{ij}^3/(G(m_i+m_j))}$, unless the preset knows its own period.

:::deeper
Scaling lengths by $L$, masses by $M$ and times by $\sqrt{L^3/(GM)}$ makes the equations of motion free of $G$. The app keeps $G$ explicit rather than rescaling so the presets can be read in physical units.
:::
