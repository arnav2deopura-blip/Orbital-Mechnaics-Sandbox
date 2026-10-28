# Three-body integrator explorer

**Live site: <https://arnav2deopura-blip.github.io/Orbital-Mechnaics-Sandbox/>** (best viewed on a desktop browser)

An interactive, in-browser sandbox for the gravitational three-body problem (and, with one switch,
the exactly solvable two-body problem) and the numerical methods used to follow it: **Euler** (explicit and symplectic), **leapfrog**, **RK4**,
**Wisdom-Holman** and **IAS15**. It runs in three dimensions, with a height for every body, and shows
what each method gets right and wrong: conservation laws, order, cost, reversibility, chaos.

One app with two pages, switched from the masthead along the top (Back and Forward work, and every
link between them stays in the same window):

- **Simulator** (`#/`, the default): the 3D view, the charts and the module panel.
- **Learn** (`#/learn`, or `#/learn/<chapter>`): plain-language explanations, with equations under
  *Go deeper* and a *Try it* link under each section that opens the simulator in a prepared state.
  While you read, the run holds where it is and carries on when you come back.

It is made for a desktop window (1200 by 680 or more) and does not reflow for a phone. The old
`learn.html` address redirects to `#/learn`.

## Running it

```bash
npm install
npm run dev        # the app, at http://localhost:5173
npm test           # the test suite
npm run typecheck  # tsc
npm run lint       # eslint
npm run build      # a static site in dist/
```

The build is a plain static site with relative URLs, so `dist/` can be put on any static host (Netlify,
a school server) at any path. The live site is served by GitHub Pages: `.github/workflows/pages.yml`
builds `dist/` and deploys it on every push to `main` (Settings, Pages, Source: GitHub Actions).
`.github/workflows/ci.yml` runs the checks above.

## What is in the simulator

- **Two bodies or three**: the *Bodies* switch in the top bar runs a pair instead of a triple, and
  the whole interface follows: the preset menu lists only the presets of that count, the modules
  drop the third body (its editor, its nudge, its camera focus, the Routh ratio), the warnings and
  charts speak of "the pair", and Wisdom-Holman, which is exact for a pair, says so. A pair is not a
  triple with a massless third body: `SystemState.n` is 2, slot 2 stays zero for good, and the force
  kernel, diagnostics, events and renderer all stop at `n`. Every method can be checked against the
  exact Kepler orbit (the *Error against the exact Kepler solution* chart).
- **Layout**: a masthead (the two pages, and a *Layout* menu), then an instrument bar with the bodies
  switch, preset, play/pause, speed and method, and switches for the charts (`C`) and the module panel
  (`M`). The rest of the controls are modules in a side panel with four tabs: System (System, Bodies &
  Physics, Perturb), Method (Method, Time & Events), Analysis (Live Numbers, Compare, Batch Jobs, Chart
  Data & Export) and View (View, Performance). Each module can be folded or closed, and the button at the
  end of the tab strip brings back any of them.
  The *Layout* menu arranges the page in one click: *Instrument* (everything), *Orbits and charts*,
  *Orbits only* (`F`, and again to undo) and *Charts focus*. The charts drawer is as tall as you want it:
  drag its top edge, or use the *Height* slider in its header. Taller drawers wrap the plots into rows
  of larger plots, and hovering any plot draws a line at the same time in all of them, with the values.
  Which modules are open, the panel's tab and width, and the charts' visibility and height are
  remembered in the browser.
- **Warnings**: when a system cannot work (it is unbound, two bodies start on top of each other and fall
  together, the step is too coarse) or has stopped working (a failed step, energy off by more than 10%,
  an escape, a body far off screen), a banner over the view says so in plain words, with buttons
  that fix it: slow the bodies until the system is bound, switch to IAS15, take smaller steps, frame
  every body, or load the preset closest to the user's own values (`src/app/health.ts`,
  `src/app/suggest.ts`). An energy blow-up pauses the run once. Arrows at the edge of the view point
  to bodies that are off screen.
- **Presets**, three bodies: a Kepler pair with a test particle, figure-eight, Lagrange, Euler
  collinear, Sun-Jupiter-Trojan, star-planet-moon, Pythagorean, a Kozai triple, seven
  Šuvakov-Dmitrašinović orbits, and a sandbox. Two bodies: a Kepler orbit, a circular binary, a
  near-radial plunge, a hyperbolic flyby and a sandbox. Most have sliders (eccentricity, mass ratio,
  inclination, tilt). Each says whether a test has checked it.
- **Look**: a ruled instrument sheet in graphite and warm white. One accent, vermilion, is kept for
  the primary action, the open tab, focus and the worst warning; the only other colors are the three
  bodies (gold, cornflower, bone), picked to stay apart under the common kinds of color blindness.
  Archivo (variable width and weight) carries the interface, Source Serif 4 the Learn page; both are
  self-hosted. `src/ui/tokens.css` is the shared palette, mirrored in `src/ui/palette.ts`.
- **3D**: a reference plane (z = 0, or perpendicular to the angular momentum) with a floor grid and
  optional back walls, drop lines and shadows for height, an axes gizmo, snap views, an orthographic
  option, a co-rotating camera, and trails tinted by height.
- **Editing**: edit mass, position and velocity (z included) of each body, tilt the whole system, or
  nudge one body, out of the orbital plane if you like.
- **Method controls**: integrator, step size, WH central body, IAS15 tolerance and limits, G, softening.
- **Charts**: energy, angular momentum and momentum errors, closest approach, step size, cost, and the
  error against the exact Kepler solution, with markers for events and a caption saying what each
  method's curve should look like. CSV export of the diagnostics and of the trajectory.
- **Comparison**: a ghost twin (the same system with a tiny nudge, to see chaos as exponential
  divergence) or a second method on the identical start, with "equalize cost". **Return to start**
  reverses the run and reports how far it is from where it began.
- **Batch jobs** (in a Web Worker): convergence and work-precision sweeps with the measured order of
  each method, fast-forward a thousand orbits, and a Lyapunov exponent estimate.
- **Links**: "Copy link to this run" puts the whole setup in the URL hash.
  `index.html#preset=pythagorean&integrator=leapfrog&dt=0.01&speed=2` also works by hand; any other
  key is a parameter of the preset (`#preset=lagrange&mass=40`).

## How it is built

```
src/
  sim/        pure, DOM-free simulation: state, forces, diagnostics, integrators, sampler,
              events, batch jobs. Imports nothing from the folders below.
  presets/    schema, generators, the Šuvakov data, and the checks that back "verified"
  app/        Controller (the one path for every change), SimLoop (time target and frame budget),
              Comparison, URL state, the batch client, run health and preset suggestions
  render/     Three.js: bodies, trails, planes, gizmo, arrows, the scene
  ui/         the layout shell, top bar, modules (Tweakpane inside ruled sections), warnings, uPlot charts,
              batch results
  worker/     the batch worker and its protocol
  learn/      the Learn page, from markdown in learn/content
tests/        Vitest; golden/ holds the REBOUND reference numbers
tools/        offline helpers (IAS15 constants, REBOUND golden data)
```

Data flows one way: panel and links, then the `Controller`, then the `Simulation`, then a read-only
snapshot to the renderer and charts. All physics is Float64; the GPU only sees positions relative to
the camera focus (a floating origin), so nothing jitters far from the origin.

## Checking it

- Unit and physics tests for every part, including the order of each method and conservation laws.
- `npm run verify:presets` runs the periodicity checks: each periodic preset must return to its start
  after its claimed period, and a preset is marked verified only if a test has run it.
- **Golden data**: `tests/golden/golden.json` holds the same runs made with REBOUND (IAS15 and WHFast),
  and our IAS15 and Wisdom-Holman agree with it to about 1e-12 on the figure-eight and the hierarchical
  triple. REBOUND is GPL-3.0; it is used only as an outside program to produce numbers, and none of
  its code is in this project. To regenerate, see `tools/reference/make_golden.py`.
- The IAS15 tables are generated at high precision by `tools/gen_ias15_constants.py`.

## Things to know

- **Šuvakov-Dmitrašinović orbits**: their published 5-digit initial conditions drift off the orbit,
  so the ones shipped are refined from them to about 1e-11 closure. The refined periods differ from
  the published ones in the fourth digit; the closure test is what vouches for them.
- **IAS15 and tight pairs far from the origin**: its error estimate reads roundoff as truncation error
  and the step can collapse (documented in `src/sim/integrators/ias15.ts`). Tolerances below 1e-10 are
  near that floor; the batch jobs use 1e-10.
- **Allocation**: the step loop retains nothing, and makes a little short-lived garbage per step (a
  double returned from a function that is not inlined is boxed). Measured, not zero.
- **Divergence in comparison mode** is measured once per frame, so at very high speed several samples
  share one value.
- Not done: dragging bodies in the view, exaggerating z for display, the symplectic correctors of
  WHFast, and the newer IAS15 timestep criterion.

## References

The Learn page lists the references; each was checked against the publisher's or arXiv's own page.
