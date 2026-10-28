# Three-Body Sandbox — Complete Project Outline

A full description of what this interactive web application does, how it behaves, and how it is built.
It was written from a read of every source file, the Learn-page content, the design/product documents,
the tests and tools, and a live run of the app in a browser. It is **not** a summary: it aims to list
every page, control, setting, preset, method, warning, chart, file and limit in the project.

> Project folder: `Numerical Integrator Sandbox/` · package name `three-body-integrator` · UI name **"Three-body sandbox"**

---

## Contents

1. [What the app is](#1-what-the-app-is)
2. [Quick facts](#2-quick-facts)
3. [Pages and navigation](#3-pages-and-navigation)
4. [The simulator page, region by region](#4-the-simulator-page-region-by-region)
5. [The instrument bar (every control)](#5-the-instrument-bar-every-control)
6. [Keyboard and mouse](#6-keyboard-and-mouse)
7. [Layout menu, arrangements and remembered preferences](#7-layout-menu-arrangements-and-remembered-preferences)
8. [The module panel (all 11 modules, every control)](#8-the-module-panel-all-11-modules-every-control)
9. [Two bodies versus three](#9-two-bodies-versus-three)
10. [Presets (all 21)](#10-presets-all-21)
11. [The numerical methods](#11-the-numerical-methods)
12. [Physics and the data model](#12-physics-and-the-data-model)
13. [The simulation engine and run loop](#13-the-simulation-engine-and-run-loop)
14. [Charts and diagnostics](#14-charts-and-diagnostics)
15. [Warnings, health checks and preset suggestions](#15-warnings-health-checks-and-preset-suggestions)
16. [Comparison mode, perturbation and time reversal](#16-comparison-mode-perturbation-and-time-reversal)
17. [Batch jobs (Web Worker)](#17-batch-jobs-web-worker)
18. [The 3D renderer](#18-the-3d-renderer)
19. [Links: the whole run in the URL](#19-links-the-whole-run-in-the-url)
20. [The Learn page](#20-the-learn-page)
21. [Visual design system](#21-visual-design-system)
22. [Product intent, principles and accessibility](#22-product-intent-principles-and-accessibility)
23. [Architecture and file-by-file map](#23-architecture-and-file-by-file-map)
24. [Testing and verification](#24-testing-and-verification)
25. [Tooling, build, CI and housekeeping folders](#25-tooling-build-ci-and-housekeeping-folders)
26. [The archived Streamlit original](#26-the-archived-streamlit-original)
27. [Known limits, not-done items and observations](#27-known-limits-not-done-items-and-observations)

---

## 1. What the app is

An **interactive, in-browser sandbox for gravitational few-body dynamics** and for the numerical
methods used to follow it. It is an education dashboard: students and teachers watch what each
integration method gets right and wrong on a real system, and can trust that what they see is correct.

- It simulates **three bodies** (the chaotic three-body problem) or, with one switch, **two bodies**
  (the exactly solvable Kepler problem, used as the control experiment).
- It runs in **three dimensions**: every body has a height (z) and a z-velocity.
- It offers **five numerical methods** (six entries in the menu): **Euler** (explicit), **Symplectic
  Euler**, **Leapfrog**, **RK4**, **Wisdom–Holman** and **IAS15**.
- It makes visible the things that distinguish those methods: **conservation laws** (energy, momentum,
  angular momentum), **order of accuracy**, **cost** (force evaluations), **time reversibility**, and **chaos**.
- It comes with a **Learn page** (plain-language chapters with equations, plus "Try it" links that
  open the simulator in a prepared state) and a **run-health system** that explains in plain words when
  a run is about to fail or has failed, and offers one-click fixes.
- Everything is a **static site** (no server, no account, no network calls after load). All physics is
  64-bit floating point and runs in the browser; heavy computations run in a Web Worker.
- The numerics are **checked, not decorative**: presets are marked "verified" only when a test has run
  them; diagnostics are computed from true integrator states; IAS15 and Wisdom–Holman agree with
  REBOUND reference numbers to about 1e-12 in the tests.

**Intended users:** students and teachers meeting numerical integration and the gravitational few-body
problem, at a laptop or in a classroom, with a teacher or on their own.

**Intended screen:** a desktop window of **1200 × 680 or more**. It is desktop-only and does not reflow
for a phone or tablet (below that size the page scrolls). The HTML viewport meta is fixed at width 1280.

---

## 2. Quick facts

| Item | Value |
|---|---|
| Language / build | TypeScript (strict, ES2023, `erasableSyntaxOnly`, no unused locals/params), Vite 8, Vitest 5 |
| Rendering | Three.js 0.186 (WebGL), custom GLSL for trails, grids, drop-line dots |
| UI libraries | Tweakpane 4 (module controls), uPlot (charts), KaTeX (math), markdown-it (Learn content) |
| Fonts (self-hosted) | Archivo Variable (interface; weight 100–900, width 62–125%), Source Serif 4 Variable (Learn reading text) |
| Runtime dependencies | `@fontsource-variable/archivo`, `@fontsource-variable/source-serif-4`, `katex`, `markdown-it`, `three`, `tweakpane`, `uplot` |
| Dev dependencies | eslint + typescript-eslint, `@tweakpane/core`, `@types/*`, typescript ~6.0, vite, vitest |
| Scripts | `dev`, `build` (`tsc -b && vite build`), `preview`, `typecheck`, `test`, `test:watch`, `lint`, `verify:presets` |
| Dev server | `npm run dev` → `http://localhost:5173` (a `.claude/launch.json` defines `dev` on 5173 and `dev-alt` on 5174) |
| Output | `dist/` — a plain static site with relative URLs (`base: './'`), hostable at any path (GitHub Pages, Netlify, a school server) |
| Multi-page setup | `appType: 'mpa'`; two Vite inputs: `index.html` (the app) and `learn.html` (a redirect stub) |
| Tests | 37 test files, roughly 530 test cases, plus golden data from REBOUND |
| CI | `.github/workflows/ci.yml`: Node 22 → `npm ci` → typecheck → lint → test → build, on every push and PR |
| State storage | Only `localStorage` (layout preferences), key `three-body-sandbox.layout.v1`; failures to read/write are tolerated |
| Dev-only hooks | `?offset=1e6` (moves the system far from the origin to prove the floating origin works); in dev builds `window.__view`, `__controller`, `__charts`, `__shell` are exposed |

---

## 3. Pages and navigation

One document, **two pages**, switched from the masthead and told apart by the URL **hash** (so the
static build works at any sub-path, and Back/Forward move between pages with no extra code):

| Route (hash) | Page |
|---|---|
| `#/` or anything else not starting with `#/` | **Simulator** (the default) |
| `#/learn` | **Learn** page |
| `#/learn/<chapter-id>` | Learn page scrolled to that chapter |
| `#/learn/preset-<preset-id>` | Learn page scrolled to that preset's entry |
| `#s=<base64url JSON>` | A shared **run** (simulator) — see [§19](#19-links-the-whole-run-in-the-url) |
| `#preset=...&integrator=...&...` | A hand-written run link (simulator) |

Behaviours:

- **A hash that names a page is not a run.** The simulator ignores any hash starting with `#/`.
- **Back/Forward work**, and every in-app link stays in the same window.
- **The simulator holds while the Learn page is shown**: no stepping, no drawing, no time passes. Coming back
  resumes exactly where it was. The Learn page's scroll position is remembered between visits.
- **The Learn page is built lazily** (dynamic import) the first time it is opened.
- **`learn.html` redirects** to `./#/learn` (carrying any hash as a chapter id), so old links still work.
- **Link rewriting:** links inside Learn chapters that were written for two separate pages
  (`index.html#preset=x`, `learn.html#chaos`) are rewritten at load into in-page hash links.
- Hash changes are listened to after load: pasting a different run link into the address bar applies it.
- The `<html>` element gets `data-page="sim"` or `"learn"`; keyboard shortcuts are disabled on Learn.

---

## 4. The simulator page, region by region

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Masthead: ◦ Three-body sandbox │ Simulator │ Learn │            [Layout ▾] │
├────────────────────────────────────────────────────────────────────────────┤
│ Instrument bar: Bodies 2|3 · Preset ▾ · ⏸ ⏭ ↺ · Speed ──── · Method ▾ │ Charts │ Modules │
├──────────────────────────────────────────────┬─┬───────────────────────────┤
│  THE PLATE (3D view)                         │ │ System │ Method │ Analysis │ View │ ⚙ │
│   warning banner (top)                       │r│  module sections, ruled     │
│   axes gizmo (top-left)                      │e│  (fold / close each one)    │
│   status pill + big clock (bottom-left)      │s│                             │
│   caption (bottom-right)                     │i│                             │
│──────────────────────────────────────────────│z│                             │
│  CHARTS DRAWER (resizable, up to 82%)        │e│                             │
└──────────────────────────────────────────────┴─┴───────────────────────────┘
```

### 4.1 Masthead (44 px, same on both pages)
- Brand mark (three small dots in the three body colors) + the name **"Three-body sandbox"**, which links to the simulator.
- Page tabs **Simulator** and **Learn** (flat tabs; the open one has a 2 px vermilion underline and `aria-current="page"`).
- On the simulator only: a **Layout** menu button at the far right ([§7](#7-layout-menu-arrangements-and-remembered-preferences)).

### 4.2 Instrument bar (64 px)
Always-needed controls, described fully in [§5](#5-the-instrument-bar-every-control). At the far right are the two **switches**: **Charts** (C) and **Modules** (M).

### 4.3 The plate (the 3D view)
- A night-sky 3D canvas (`#060607`). Drag to orbit, scroll to zoom; panning only in free-orbit mode.
- **HUD, bottom-left:** a **status pill** and a **large clock**.
  - Status pill text: `Running`, `Running NN%` (when the machine cannot keep the requested speed, below 95%), `Paused`, `Problem` (a danger-level warning), `Failed` (integration broke). Tone colors: ok / idle / warning / danger. Its tooltip holds the full status sentence.
  - Clock: simulated time in large condensed type (scientific notation below 1e-3 or above 1e5), with a small `t · N.N T` giving how many characteristic periods that is.
- **Caption, bottom-right** (like a journal figure caption): `Preset name · up to three preset parameters (label value) · method`, e.g. "Kepler orbit · eccentricity 0.5 · mass ratio 0.3 · IAS15". Tilt is left out.
- **Axes gizmo, top-left:** a small x/y/z indicator that turns with the camera (labels become u/v/L when the reference plane follows angular momentum).
- **Off-screen arrows:** numbered arrows at the view's edge point at any body that has left the frame.
- **Warning banner** across the top of the plate ([§15](#15-warnings-health-checks-and-preset-suggestions)).
- **Welcome card** on a first visit ("New here?") with buttons *Open the Learn page* and *Just explore*, and a hint line: *"Drag to orbit, scroll to zoom. Space plays and pauses, C shows the charts, M the module panel, F the orbits alone."* Dismissal is remembered (`welcomed`).
- **Batch results overlay** appears over the plate when a batch job finishes ([§17](#17-batch-jobs-web-worker)).

### 4.4 Charts drawer (under the plate)
Header with title **Charts**, nine chart toggles ("chips"), a **Height** slider, an expand/shrink button and a hide button; the plots; and a note line under them. Fully described in [§14](#14-charts-and-diagnostics).

### 4.5 Module panel (right side)
A tabbed column, **420 px wide by default (resizable 340–720)**, with four tabs — **System, Method, Analysis, View** — plus a **Choose modules** button (sliders icon) at the end of the tab strip. Each module is a ruled section with a title, a fold chevron and a close ×. Details in [§8](#8-the-module-panel-all-11-modules-every-control).

---

## 5. The instrument bar (every control)

| Control | What it does |
|---|---|
| **Bodies 2 \| 3** (segmented, radio group) | Switches the whole app between a pair and a triple. A switch is a **new run**: it loads the preset last used with that count (or the default: *Kepler orbit* for 2, *Figure-eight* for 3). Arrow keys move between the two segments. Tooltips: "Two bodies: the Kepler problem, solved exactly" / "Three bodies: no general solution, and chaos". |
| **Preset** (select, grouped) | Lists only presets with the chosen number of bodies. Groups — 3 bodies: *Classics*, *Hierarchical systems*, *Šuvakov–Dmitrašinović orbits*, *Your own*; 2 bodies: *The Kepler problem*, *Your own*. Choosing one loads it with its recommended settings. |
| **Play / Pause** | Toggles running (label and icon change; the paused button is the filled vermilion primary). Space does the same. |
| **Step** | Pauses and takes exactly one integrator step (the comparison twin runs on to the same time). |
| **Reset** | Back to the state of the last load or edit; running/paused stays as it was. Ends any comparison. |
| **Speed** (log slider) | Simulated time per real second, shown as **orbits/s** (periods of T_char per second). Slider exponent −4 … +3 (0.0001 to 1000 orbits/s). Default per preset is one T_char every 8 s (0.125 orbits/s) unless the preset sets `speed`. |
| **Method** (select) | Leapfrog, RK4, Wisdom-Holman, IAS15, Euler, Symplectic Euler. Switching continues from the **current state**, keeps the reference values (so the error shown afterwards is that of the new method), adds a labelled marker on the charts, and clears the one-time auto-pause memory. |
| **Charts** toggle (C) | Shows/hides the charts drawer. |
| **Modules** toggle (M) | Shows/hides the module panel. |

---

## 6. Keyboard and mouse

| Input | Effect |
|---|---|
| **Space** | Play / pause |
| **C** | Show / hide charts |
| **M** | Show / hide module panel |
| **F** | "Orbits only" (hide panel and charts); press again to restore what was there |
| Arrow keys on the *Bodies* switch | Move between 2 and 3 |
| Left/Right on a panel tab | Move between the four tabs |
| Up/Down on the charts drawer handle | Resize by 2% steps |
| Drag the drawer's top edge | Resize the charts (double-click to reset to 36%) |
| Drag the panel's left edge | Resize the module panel (double-click resets to 420 px) |
| Drag in the 3D view | Orbit the camera |
| Scroll in the 3D view | Zoom |
| Right-drag / pan | Pan, **only** in *Free orbit* focus mode |
| Hover any chart | A vertical cursor appears at the same time in **every** chart, with `t … · value` read-out in each |

Shortcuts are ignored while typing in a field/select/button, with modifier keys held, and on the Learn page.
Every control is reachable from the keyboard; focus shows a 2 px vermilion ring; Escape closes menus.

---

## 7. Layout menu, arrangements and remembered preferences

**Layout** (masthead, simulator only) opens a sheet titled **"Arrange the page"** with four arrangements, each drawn with a tiny sketch and a tick on the current one:

| Arrangement | What it shows | Charts height |
|---|---|---|
| **Instrument** | Orbits, charts and the module panel (everything) | 36% (default) |
| **Orbits and charts** | The module panel put away | 36% |
| **Orbits only** (`F`) | The view alone, full width and height | unchanged |
| **Charts focus** | Tall charts under a short view, no panel | 78% |

The sheet also has two checkboxes (**Charts** `C`, **Module panel** `M`), a hint line (`F` orbits only, and back) and **Reset layout**
(all modules back to first-visit state, panel width 420, first tab, *Instrument* arrangement).

**Charts drawer height:** a share of the stage height, **18%–82%** (default 36%; "large" ≥ 70%). Set by dragging the drawer's top edge (it turns vermilion on hover), the **Height** slider, the keyboard, or the expand button (jumps to 78% and back).

**Remembered in the browser** (`localStorage` key `three-body-sandbox.layout.v1`): which modules are shown and which are folded, the panel's open tab and width, whether the panel is hidden, whether charts show and their height, whether the welcome card was dismissed, and the last preset used for 2 bodies and for 3. If storage is unavailable, defaults are used and nothing is kept.

---

## 8. The module panel (all 11 modules, every control)

Modules are built with Tweakpane inside ruled sections. A module's close × closes it; the **Choose modules** sheet (checkbox list grouped by tab, each with a one-line summary, plus *Reset layout*) brings any back and, when ticking one, opens its tab, unfolds it and scrolls to it. A tab with every module closed shows: *"Every module in this tab is closed. Choose modules with the button at the end of the tab strip."* Modules refresh about 4×/s, and only while open, unfolded and in the open tab.

Open on a first visit: **System, Method, Live Numbers, View** (View is folded). Others start closed.
Modules marked ⟳ are **rebuilt when the body count changes** (their controls depend on how many bodies there are).

### 8.1 Tab **System**

#### System
*What this preset shows, its sliders, and a link to this run.* Open by default.
- Preset name (heading), its one-line teaching goal, and a "Checked by a test: …" line (or "Not independently checked.") — green-styled when verified.
- **Read about this preset →** (links to `#/learn/preset-<id>`).
- **Parameters** folder: one slider per preset parameter (eccentricity, mass ratio, tilt, etc., each with a hint tooltip). Changing a slider **reloads the preset when you release it**, because loading restarts the run.
- **Copy link to this run** button: writes the whole setup to the address bar (`history.replaceState`) and the clipboard, with a status text ("link copied" / "link is in the address bar").

#### Bodies & Physics ⟳
*Edit each mass, position and velocity, tilt the system, G and softening.*
- Explanatory text: change the numbers, then Apply; the run pauses and every error restarts from the new state; impossible systems produce a warning with a fix.
- One folder per body ("Body 1…"): **mass** (min 0, step 0.001; a mass of 0 makes a *test particle* that feels forces but exerts none), **position** x/y/z and **velocity** x/y/z (step 0.01 each). Only the first folder opens by default.
- **re-center COM** checkbox (shift so the center of mass sits at the origin at rest — zero total momentum).
- **Apply edits** (pauses, applies, restarts energy/angular-momentum references, clears trails) and **Read current state** (refills the editor from the live state).
- **Tilt the whole system** folder: axis x/y/z, angle −180…180°, **Rotate** (a rigid rotation is a symmetry of the physics; only the plane of motion turns; keeps running).
- **Physics** folder: **G** (must be > 0; changing G changes the energy, so references restart) and **softening** length (Plummer: r² → r² + ε²; disabled when Wisdom–Holman is selected, because WH has no softening).
- **Learn about units and G →**

#### Perturb (chaos) ⟳
*Nudge one body by a tiny amount and watch what it changes.*
- **body** (default: the last), **nudge its** velocity|position, **direction** (*Out of plane (L)* = along angular momentum, z, x, y, Random), **size** exponent slider (10⁻¹²…10⁻², default 10⁻⁶), **re-center COM**, **Nudge** button.
- Size is a **fraction of the system's size** (for positions) or of its **characteristic speed** (for velocities).
- Restarts the energy/angular-momentum references from the nudged state; keeps running. **Learn about chaos →**

### 8.2 Tab **Method**

#### Method ⟳
*The integrator, what it does, and its step size and limits.* Open by default.
- **integrator** (the same six options as the bar).
- **step size** slider: log scale as a fraction of T_char, shown as `T/N` (exponent −5.5…−0.5). For IAS15 this is only the first guess.
- **central body** (Wisdom–Holman only): *Most massive* or Body 1/2/(3). Choosing restarts WH, which orders the bodies once. For star-planet-moon, use the planet.
- **tolerance** (IAS15 only): 10⁻¹²…10⁻⁴ (default 1e-9).
- **min step / max step** (IAS15 only): in units of T_char; the slider ends mean "off". Hitting the minimum is reported as an unresolved encounter.
- A note (WH with two bodies): *Wisdom-Holman is exact for a pair; the step only decides how often it stops to look.*
- **About this method**: the method's *Idea + Analogy* text, a collapsible *Strengths, cost and when to use it*, and **Learn about <method> →**. This text is read straight from the Learn chapter's markdown, so there is one source.

#### Time & Events
*Run backward, return to the start, and stop at close encounters.*
- **direction** Forward / Backward (adds a "time reversed"/"time forward" marker to the charts).
- **Return to start** button and **return dist.** read-out (see [§16](#16-comparison-mode-perturbation-and-time-reversal)).
- **encounter dist.** (0 = off) and **pause there** — note when two bodies come within that distance, optionally stop the run. Bodies never merge; this is also the "collision radius". **Learn about time reversal →**

### 8.3 Tab **Analysis**

#### Live Numbers ⟳
*Energy and momentum errors, closest approach, step size and cost, as they happen.* Open by default. Read-outs (refreshed ~10×/s):
**energy error**, **L error**, **|P| error**, **closest pair** (named **separation** with two bodies), **Routh** (three bodies only), **step taken**, **steps**, **force evals** — each with a tooltip. **How to read these numbers →**

#### Compare ⟳
*Run a nudged twin, or a second method, on top of this one.* See [§16](#16-comparison-mode-perturbation-and-time-reversal).
- **compare**: *Ghost twin (nudged)* or *Another method*.
- Twin: **nudge body / nudge its / direction / size** (10⁻¹⁴…10⁻², default 10⁻⁹ on position).
- Method: **other method**, **equalize cost**, **its step** (hidden while *equalize cost* is on).
- **Start comparison**, **Stop comparison**, a message line (e.g. an error), and a **divergence** read-out.
- Note: the twin is drawn as faint ghost bodies; turn on the divergence chart to watch the gap.

#### Chart Data & Export
*How often the charts sample, and CSV downloads.*
- **samples / T** (20…2000, step 10; default 200 per T_char) — applies from now on.
- **Clear history**, **Download diagnostics CSV** (`three-body-diagnostics.csv`), **Download trajectory CSV** (`three-body-trajectory.csv`).

#### Batch Jobs
*Convergence sweeps, fast-forward and a Lyapunov estimate, run in the background.* See [§17](#17-batch-jobs-web-worker).
Folders **Convergence sweep** (Run sweep; *periods* 0.25–10, default 1.3), **Fast-forward** (Run fast-forward; *periods* 1–5000, default 100), **Lyapunov estimate** (Run estimate; *periods* 1–500, default 20), plus **Cancel job** and a **status** line. **Learn about error, order and cost →**

### 8.4 Tab **View**

#### View ⟳
*Camera, grid, drop lines, arrows and trails.* Open but **folded** by default.
- **Camera** folder: **focus** (Free orbit · Center of mass · Co-rotating (about z) · Body 1 · Body 2 · Body 3[3-body only]); **Frame all bodies**; snap buttons **Top / Front / Side / Isometric view**.
- **Space (3D)** folder: **plane** (*z = 0* or *Perpendicular to L*), **floor grid**, **back walls**, **drop lines**, **shadows**, **axes**, **orthographic**, **tint trails by z**, **velocity arrows**, **accel. arrows**.
- **Trails** folder: **show**, **length** (200–20 000 samples; applied at the end of a drag), **fade** (0–6), **frame** (*Follows focus* / *World*; changing clears trails), **Clear trails**.
- **Display** folder: **body size** (0.25–8×).
- **Learn about the third dimension →**

#### Performance
*Frame rate, time spent simulating and drawing, and auto quality.*
**auto quality** toggle, **quality** text, an **fps** graph, **frame ms**, **render ms**, **sim ms**, **steps / s**, **evals / s**, **speed kept** (fraction of the requested speed delivered).

---

## 9. Two bodies versus three

The **Bodies** switch changes the entire interface and the physics:

- **A pair is not a triple with a massless third body.** `SystemState.n` is 2; slot 2 holds zeros permanently; the force kernel, diagnostics, events, renderer, charts, warnings and presets all stop at `n`.
- Preset menu lists only that count's presets (5 for two bodies, 16 for three).
- Modules drop the third body: editor folders, nudge targets, camera focus (*Body 3* removed; following it falls back to the center of mass), the **Routh** read-out (a three-body concept), and wording changes ("separation" instead of "closest pair"; "the pair" in warnings).
- **Wisdom–Holman is exact for a pair** (the orbit is the very Kepler motion it drifts along); the UI says so.
- The chart **"Error against the exact Kepler solution"** is **always available** for two bodies (and for three bodies only when exactly one is massless).
- Escape is judged pairwise ("the two bodies are leaving each other" — a hyperbolic flyby).
- Links with `bodies` for a pair ignore anything written into slot 2.
- The three-body system is chaotic; the two-body system is the control: nothing there is chaotic, and every run has a closed form.

---

## 10. Presets (all 21)

Each preset has: id, name, tags, a one-line "demonstrates" goal, units (`nbody` G=1, or `astro` G=4π² in AU / solar masses / years), initial bodies (tabulated or from a generator with sliders), optional known period, **recommended settings**, a citation/source, and a `verified` flag with a "verified by" sentence shown to the user. Tags: `stable`, `periodic`, `unstable`, `chaotic`, `hierarchical`, `3D`, `validation`, `unbound`.

**Defaults when a preset gives none:** step = T/1000 (T/100 for IAS15 as first guess); speed = one T_char every 8 s; camera follows the center of mass framed on the system size; loading always starts running, forward, trails cleared, encounter radius reset.

Loading a preset sets: integrator, step, IAS15 tolerance, WH central body, speed, camera focus/size; it clears comparison and return-to-start; and re-reads the body editor.

### 10.1 Three bodies (16)

| Preset (id) | Menu group | Parameters (key: range, default) | Recommended | Checked by a test (what it checks) |
|---|---|---|---|---|
| **Kepler pair + test particle** (`kepler`) | Classics | eccentricity 0–0.95 (0.5); mass ratio 0.01–1 (0.3); inclination 0–90° (30) | IAS15 | Yes — massive pair returns after one period to better than 1e-9 and follows the exact Kepler solution |
| **Figure-eight** (`figure-eight`) | Classics | none | Leapfrog, dt = T/4000; T = 6.32591398 | Yes — returns after one period to better than 1e-6 (IAS15 at 1e-12) |
| **Lagrange equilateral** (`lagrange`) | Classics | mass of body 1: 1–200 (100); tilt 0–90° | Leapfrog | Yes — exact rigid rotation returns after one period |
| **Euler collinear** (`euler`) | Classics | tilt 0–90° | IAS15 | Yes — exact rigid rotation returns after one period |
| **Pythagorean (Burrau)** (`pythagorean`) | Classics | none | IAS15, speed 2 | Yes — IAS15 resolves close encounters (energy kept to 1e-8); by t = 80 the lightest body is ejected leaving a bound 4–5 binary |
| **Sun-Jupiter-Trojan** (`trojan`) | Hierarchical | offset −40…40° (10); inclination 0–30° (8) | Wisdom–Holman, dt 0.05, speed 1, central body 0 | Yes — Trojan librates around L4 for 300 years, within 20–100° of the Sun–Jupiter line |
| **Star-planet-moon** (`star-planet-moon`) | Hierarchical | moon distance 0.1–0.55 of Hill radius (0.3); moon incl. 0–180° (20) | Wisdom–Holman, speed 0.25, central body 1 (the planet), camera on body 1 | Yes — moon stays bound at 0.3 R_H for 20 years, lost at 0.55 |
| **Inclined triple (Kozai)** (`zlk`) | Hierarchical | mutual incl. 0–90° (65) | IAS15, speed 100 | Yes — at 65° inner eccentricity cycles 0.1 up to the quadrupole limit; at 20° it does not |
| **Butterfly I (unstable)** (`suvakov-butterfly-1`) | Šuvakov–Dmitrašinović | none | IAS15, speed = period | Yes — returns after one period to better than 1e-8, then drifts away over many periods |
| **Butterfly II** (`…butterfly-2`) | " | none | IAS15, speed = period/4 | Yes — returns to better than 1e-8 and stays within 1e-8 of the orbit for 10 periods |
| **Bumblebee** (`…bumblebee`) | " | none | IAS15, speed period/4 | same as Butterfly II |
| **Moth I** (`…moth-1`) | " | none | IAS15, speed period/4 | same |
| **Moth II** (`…moth-2`) | " | none | IAS15, speed period/4 | same |
| **Butterfly III** (`…butterfly-3`) | " | none | IAS15, speed period/4 | same |
| **Dragonfly (unstable)** (`…dragonfly`) | " | none | IAS15, speed = period | same as Butterfly I |
| **Sandbox** (`sandbox`) | Your own | lift 0–1.5 (0.5) | IAS15 | **No** — "Not independently checked" (free experimentation) |

Details of the generators:
- **Kepler pair + test particle:** two bodies on a Kepler orbit (a = 1, G = 1, started at pericenter) and a **massless** third body on a circular orbit of radius 4 whose plane is inclined to the pair's. Because the test particle exerts no force, the pair stays exactly Keplerian, so there is a closed-form solution to compare with.
- **Figure-eight:** Chenciner–Montgomery/Moore: three unit masses, G = 1; body 1 at (0.97000436, −0.24308753), body 3 at the origin with v = (−0.93240737, −0.86473146); bodies 1 and 2 share −v₃/2.
- **Lagrange:** masses (m, 1, 1) at the corners of an equilateral triangle of side 2, rotating rigidly (ω² = GM/a³); stable only when the Routh criterion 27(m₁m₂+m₂m₃+m₃m₁) < (m₁+m₂+m₃)² holds, i.e. m above ≈ 50.5. The slider's tooltip says so.
- **Euler collinear:** three unit masses at −1, 0, +1 rotating at ω = √(5/4); periodic but unstable.
- **Pythagorean (Burrau, Szebehely & Peters 1967):** masses 3, 4, 5 at rest on the corners of a 3-4-5 triangle, each opposite the side of its own length.
- **Trojan:** Sun (1), Jupiter (9.548e-4, a = 5.203 AU), massless Trojan placed `offset`° away from L4 along Jupiter's orbit with the rigid-rotation velocity plus out-of-plane speed. (Exactly at L4 nothing would happen.)
- **Star-planet-moon:** Earth-like planet (3.0e-6 M☉) at 1 AU and moon (3.7e-8 M☉) on a circular orbit at a chosen fraction of the planet's Hill radius R_H = a(m/3M)^{1/3}, built in Jacobi coordinates; dt = moon period/40; the view is framed on the moon's orbit. A circular prograde moon survives to ≈ 0.45 R_H and is lost beyond ≈ 0.5.
- **Inclined triple:** inner binary (a = 1, e = 0.1, masses 1 and 0.01, pericenter at ω = 90°) and a distant star (mass 1, circular radius 6) inclined by the slider; Kozai cycles appear above ≈ 39.2°; one cycle ≈ 1100 time units (~11 s at speed 100).
- **Šuvakov–Dmitrašinović family:** seven periodic, planar, zero-angular-momentum orbits of three equal masses (x₁ = −x₂ = (−1,0), x₃ = 0, v₁ = v₂ = (p₁,p₂), v₃ = −2(p₁,p₂)). The published 5-digit initial conditions drift off the orbit, so the shipped values (`src/presets/data/suvakov.json`) were **refined by Gauss–Newton shooting to about 1e-11 closure**; refined periods differ from the published ones in the fourth digit. Classes and periods: Butterfly I (I.A.1, **unstable**, 6.2347), Butterfly II (I.A.2, stable, 7.0037), Bumblebee (I.A.3, stable, 63.534), Moth I (I.B.1, stable, 14.894), Moth II (I.B.2, stable, 28.669), Butterfly III (I.B.3, stable, 13.867), Dragonfly (I.B.7, **unstable**, 21.272). Unstable ones "look periodic, then fall apart after tens of periods, from roundoff alone".
- **Sandbox:** three unit masses on Lagrange's triangle with body 1 lifted by `lift` and the others lowered by half of it, so motion is 3D from the start.

### 10.2 Two bodies (5)

| Preset (id) | Parameters | Recommended | Notes |
|---|---|---|---|
| **Kepler orbit** (`kepler-orbit`) | eccentricity 0–0.95 (0.5); mass ratio 0.01–1 (0.3); tilt 0–90° | IAS15 | Exact two-body solution; returns after one period to better than 1e-9. Tags validation, periodic |
| **Circular binary** (`circular-binary`) | mass ratio 0.05–1 (1); tilt | Leapfrog, dt = T/400 | Constant separation; "Euler spirals outward; leapfrog stays on it" |
| **Near-radial plunge** (`near-radial`) | eccentricity 0.9–0.999 (0.99); mass ratio; tilt | IAS15 | Started at the far point; at e = 0.99 the pericenter pass is 100× closer than the start; shows where adaptive steps pay off |
| **Hyperbolic flyby** (`hyperbolic-flyby`) | eccentricity 1.05–6 (2); mass ratio; tilt | IAS15, dt = period/200 | Pericenter distance 1, started 15 pericenter distances out on the way in; tagged `unbound` so the unbound warning is suppressed; "closest approach is the analytic pericenter distance and the energy is that of the hyperbola" is what the test checks |
| **Sandbox (2 bodies)** (`sandbox-2`) | speed 0.2–1.6 of circular speed (0.8); tilt (25°) | IAS15 | Masses 1 and 0.4 at distance 2; below 1 starts at the far point, √2 (1.41) and up is unbound. **Not** independently checked |

All preset `tilt` sliders rotate the whole system about the x axis; nothing physical changes, only the plane's orientation in the 3D view.

---

## 11. The numerical methods

All five share one interface (`init`, `step`, `reset`, `setDirection`, optional `dense`), allocate nothing inside `step`, and work forwards **or backwards** in time.

| Method | Order | Symplectic | Time-reversible | Adaptive | Force evals / step | Notes |
|---|---|---|---|---|---|---|
| **Euler** (explicit) | 1 | No | No | No | 1 | `x += v·dt; v += a·dt` (old values). Gains energy every step; orbits spiral outward. The failure it is here to show. |
| **Symplectic Euler** | 1 | Yes | No (not symmetric) | No | 1 | `v += a·dt; x += v·dt` — one line reordered, energy error bounded. A flag on the Euler integrator, listed as its own menu entry. |
| **Leapfrog** (kick-drift-kick / velocity Verlet) | 2 | Yes | Yes | No | 1 (first step after init/reset/direction flip costs 2; acceleration is cached) | Conserves momentum and angular momentum to roundoff at any step. |
| **RK4** (classic) | 4 | No | approximately | No | 4 | Energy drifts roughly linearly in time. The "fair cost" comparison gives it 4× leapfrog's step. |
| **Wisdom–Holman** (Jacobi coordinates, drift-kick-drift) | 2 (error ∝ perturbation × dt²) | Yes | Yes | No | 1 + two Kepler solves | Exact Kepler drifts via a universal-variable solver; excels with one dominant mass; **no softening**; requires central+inner bodies to have non-zero total mass; rule of thumb dt below T/20 (presets use ≈ T/40). For two bodies a step is one exact drift. |
| **IAS15** (Gauss–Radau, Rein & Spiegel 2015, after Everhart 1985) | 15 | No | Not exactly | **Yes** | about 20, variable | Written from the mathematics; 7 Radau nodes; predictor–corrector with up to 12 sweeps; error estimate max\|b₆\|/max\|a\|; step ×(ε_tol/ε)^{1/7}; rejects a step if it would shrink dt by more than 4×, grows by at most 4×; **Kahan-compensated** summation for x, v, t; dense output for smooth drawing. |

Method-specific mechanics:
- **IAS15 parameters:** `epsTol` (default 1e-9; slider 1e-12 … 1e-4), `dtMin`, `dtMax`, first-guess `dt`. If dt cannot shrink further the step is accepted anyway and counted as `dtMinHits` ("close encounter unresolved"). Corrector sweeps that do not converge are counted as `convergenceFailures`. A step that cannot be taken at all (NaN/∞) returns 0 and is a failure. A direction flip drops the predictor, so IAS15 does not retrace exactly.
- **Known IAS15 limit** (documented in `ias15.ts`): its global error criterion reads roundoff as truncation error for a tight pair far from the origin, so the step can collapse. The Pythagorean problem's final binary at t ≈ 87 needs 311 681 steps from t = 85–89 versus 1 559 with the binary recentred. Tolerances below ~1e-10 sit near that floor (the batch jobs use 1e-10; the slider floor is 1e-12). The newer Pham–Rein–Spiegel 2024 criterion is the real fix and is **not implemented**.
- **WH central body:** only the choice of *outer* body changes the map. For star-planet-moon the planet (or moon) must be central. The central body is ordered once at init (`most massive` by default); the outer two are sorted by distance.
- **Switching to WH** removes any softening (WH rejects `eps2 ≠ 0`).
- **Universal-variable Kepler drift** (`kepler.ts`, after Curtis): Stumpff functions C(z), S(z) with a series inside |z| < 1; Newton iteration kept inside a bracket with bisection fallback (handles elliptic, parabolic and hyperbolic orbits, negative dt, and drops whole periods); Lagrange f, g coefficients.
- **Jacobi coordinates** (`coords.ts`): COM, inner = q₁ − q₀, outer = q₂ − COM(q₀,q₁); linear maps used for positions, velocities and accelerations. WH updates the state by the *change* in Jacobi coordinates to keep roundoff proportional to the step's change.
- **Info cards:** each method has a card (Idea, Analogy, Strengths and weaknesses, Cost, When to use it) in its Learn chapter; the Method module shows them.

---

## 12. Physics and the data model

- **State** (`SystemState`): `n` (2 or 3), `t`, masses `m[3]`, positions `x[9]`, velocities `v[9]` (body-major, x/y/z), `G`, `eps2` (softening²). All `Float64Array`.
- **Force** (`computeAccel`): pairwise Newtonian gravity, softened: for pair (i, j), d = x_j − x_i, r² = |d|² + ε², a_i += G m_j d / r³, a_j −= G m_i d / r³. The mass in each term belongs to the *other* body, so a test particle (m = 0) feels forces but exerts none. Accelerations can be evaluated at arbitrary positions (stage values for RK4, IAS15, WH). A separate two-body kernel leaves slot 2 at exactly zero. The cost counter is optional so diagnostics/rendering do not inflate it.
- **Potential energy** uses the softened potential whenever ε > 0 (otherwise the energy diagnostic would be wrong).
- **Units:** dimensionless numbers; `G` is a setting. Most presets use N-body units (G = 1); Trojan and star-planet-moon use AU / solar masses / years (G = 4π²).
- **Center-of-mass frame:** loading shifts positions and velocities so the COM is at rest at the origin (skipped for all-massless systems and when `recenter` is off).
- **Conserved quantities:** energy, total momentum, COM motion, angular momentum (ten integrals for three bodies); two bodies additionally have the Laplace–Runge–Lenz vector.
- **Diagnostics** (`measure`): kinetic, potential, total energy, L (about the origin), P, COM, closest pair distance (unsoftened).
- **Reference values** (taken on load/edit): E₀ with a scale (|E₀|, or K+|U| when E₀ is below 1e-6 of it), L₀ with scale Σ m|x||v| (or Σ m|x| × characteristic speed when that is zero, e.g. starting from rest), P₀, **T_char**, and the system size.
- **Errors shown:** energy error |E−E₀|/scale; angular-momentum error |L−L₀|/L_scale (vector norm); momentum error |P−P₀| (absolute).
- **T_char:** the preset's declared period if it has one (a generator's own period wins), else the **shortest two-body period** over all pairs, 2π√(r³/(G(mᵢ+mⱼ))); pairs of two test particles have none; 1 if no pair has one. It sets the speed slider's units, chart sampling, step-size slider, and T-units on the clock.
- **Characteristic speed:** √(2(K+|U|)/M). **System size:** diameter of the sphere about the COM that just holds every body.
- **Exact Kepler reference** (`analytic.ts`): for two bodies, or three bodies with exactly one massless; advances the relative orbit with the Kepler drift and compares the position of the two massive bodies (largest component difference). Unavailable with softening.
- **Events:** *close encounter* (radius chosen by the user; bodies never merge; counts once per pass and ends when the bodies are 20% beyond the radius); *escape* (a body farther than 20× the system's starting size from the COM of the other two *and* unbound to them; with two bodies, farther than that from each other and unbound); *far* (farther than 10× the starting size from the COM, still bound).
- **Transforms:** rigid rotation about x/y/z (right-handed); nudge (direction x/y/z/normal/random-on-sphere) scaled by system size or characteristic speed; `scaleToBound` scales relative velocities so kinetic = 0.5 × |potential| (virial balance), keeping positions and COM velocity.
- **Sampling/time interpolation for drawing:** the screen shows cubic-Hermite interpolation between the last two true states (IAS15 uses its dense polynomial); diagnostics always use true states.

---

## 13. The simulation engine and run loop

**Data flow, one way:** panel / links → `Controller` (the single path for every change) → `Simulation` → read-only snapshot → renderer and charts.

- **`Simulation`** owns the state, previous state, cost counters (`stepCount`, `forceEvals`, `rejectedSteps`), the integrator, the baseline (for reset/return-to-start), the reference values, failure/encounter/warning strings, and a `revision` counter so callers know to resync. Methods: `load`, `reset`, `setIntegrator`, `setDirection`, `advanceTo(targetTime, deadline)` (steps until the target or the wall-clock budget; clock read every 32 steps; returns `reached | budget | event | failed`), `step`, `stateAt`, `analyticError`, `distanceFromBaseline`, `baselineSnapshot`, `refreshDiagnostics`.
- **Failure handling:** if a step returns 0 or non-finite numbers, the last good state is restored, the integrator is reset, and `failure` explains ("integration failed at t=…, min separation …").
- **Integrator health events:** IAS15 hitting its minimum step (stops once), IAS15 corrector non-convergence (warns, never stops), WH Kepler solver failure (stops once). These add chart markers.
- **`SimLoop`** (per-frame): a time target advances with the wall clock × speed; a **compute budget** per frame (default 8 ms, adaptively `0.9 × frame interval − render time`, never below 2 ms) limits stepping; if the budget runs out the backlog is **dropped** (not caught up) and `achieved` (smoothed) reports the fraction of requested speed; failure or an event pause the run. With a twin, the budget is split in proportion to what each has cost (at least 15% each). `stopAt` supports "return to start". Stats (sim ms, steps/s, evals/s) are averaged over 0.25 s windows.
- **`Controller`** extras: runs a *readout* about every 0.1 s, keeps `runId` (so a dismissed warning comes back on the next load/edit/reset), `custom` (user changed the system), the last preset per body count, `edit()` (pause, apply, recenter, new references, clear trails, restart integrator and history), `applyDraft`, `rotate`, `nudge`, `setG`, `setSoftening`, `setDt`, `setCentralBody`, `setEncounter`, `setSamplesPerPeriod`, `restartHistory`, `startComparison`/`stopComparison`, `returnToStart`, `applyFix`, `suggestion`, and the **status sentence** ("paused", "running", "running at N% of requested speed", "returning to the start", plus encounter/warning/escape notes).
- **Frame clamp:** a hidden/throttled tab cannot cause a catch-up burst (frame time capped at 0.1 s).
- **Allocation:** the step loop retains nothing and makes only a little short-lived garbage (measured, tested, not zero).

---

## 14. Charts and diagnostics

Nine series, each a uPlot chart in the drawer; a chip in the header toggles each. Samples are taken **from true integrator states** at a fixed amount of simulated time (default **200 samples per T_char**; adjustable 20–2000), into fixed ring buffers (capacity 20 000). When a buffer fills, adjacent samples are **merged 2:1** — keeping the *largest* error, the *smallest* separation/step, or the *last* cumulative value — so a long run keeps its shape and a spike never averages away. The x-axis is **elapsed time** (sum of step sizes taken), so it only grows even when the run is reversed.

| Chart (chip label) | Axis | Merge | What it tells you (tooltip) |
|---|---|---|---|
| **Energy error** \|E−E₀\|/\|E₀\| (Energy) | log | max | Bounded oscillation = symplectic. Linear growth = RK4-style drift. Exponential growth or a jump = Euler or an unresolved encounter. √t growth = IAS15 roundoff. |
| **Angular momentum error** (Ang. momentum) | log | max | Conserved to roundoff by every method (pairwise central force); a rise points to a bug, or to softening that is not central. |
| **Momentum error** \|P−P₀\| (Momentum) | log | max | Conserved to roundoff by every method. |
| **Center of mass drift** (COM drift) | log | max | How far the COM has moved since the start; zero when total momentum is zero. |
| **Closest pair distance** (Closest pair; "Separation" for two bodies) | log | min | Dips explain energy spikes and shrinking IAS15 steps. |
| **Step size taken** (Step size) | log | min | Constant for fixed-step methods; IAS15 shrinks it near close encounters. |
| **Force evaluations (cumulative)** (Cost) | linear | last | The fair measure of cost. |
| **Error against the exact Kepler solution** (vs exact Kepler) | log | max | Only when the orbit has a closed form: two bodies, or three with one massless. |
| **Divergence from the twin** (Divergence) | log | max | Comparison mode only. Exponential growth = chaos (Lyapunov time); steady growth = two methods disagreeing. |

- **Shown at start:** Energy, Ang. momentum, Closest pair, Step size, vs exact Kepler, Divergence. Hidden: Momentum, COM drift, Cost. The two data-dependent charts appear by themselves only when they have data and are marked *(n/a)* otherwise.
- **Twin overlay:** during a comparison, every chart (except divergence) also draws the twin's curve **dashed** on the same axes, resampled onto the first run's times.
- **Event markers:** dashed vermilion vertical lines with rotated labels where something happened — method switches (e.g. "leapfrog", "symplectic Euler"), "time reversed"/"time forward", "close encounter", "IAS15 reached its minimum step…", "IAS15 corrector did not converge", "the Kepler solver did not converge". At most 64 are kept.
- **Layout:** the plots fill the drawer — as many columns as fit at a readable width (min cell 200 × 124 px, target aspect 2.4), wrapping into rows of larger plots when the drawer is tall; if nothing fits, the widest row and the drawer scrolls.
- **Cursor sync:** hovering any plot draws a line at the same time in all of them with the time and value read out in each plot's title row.
- **Note under the plots:** *"Energy error: <what to expect for the current method>"* with **How to read these →** (links to the *Conservation laws* chapter). Expectations per method: leapfrog/WH — bounded oscillation; RK4 — steady, roughly linear drift; explicit Euler — rapid growth, spiralling outward; symplectic Euler — bounded oscillation; IAS15 — tiny, slowly growing (√t) from roundoff unless an encounter is unresolved.
- **History** restarts on every load, reset, edit, and when a comparison starts (so both runs begin at the same point). It is kept while the charts are hidden.
- **CSV export:** diagnostics CSV (elapsed time + every series with data) and trajectory CSV (`elapsed_time, t, x1,y1,z1,…`).
- Axes use one grid line per decade (thinned) rather than uPlot's default minor lines.

---

## 15. Warnings, health checks and preset suggestions

A **banner** over the top of the plate shows the most severe warning, in plain words, with the buttons that fix it (`health.ts` decides which; `controller.applyFix` does it). Severity icons: `!` for warning/danger, `i` for info. Several warnings cycle with an "N of M ›" button; **×** dismisses a warning until the run is restarted (a new load, edit or reset brings it back). A "Why does this happen? →" link opens the matching Learn chapter. Warnings are re-rendered only when the *set* of warnings changes, so a number that moves every tick (energy error) cannot swallow clicks.

### 15.1 Checked on the starting state (before it runs)

| Id | Severity | Trigger | Fixes |
|---|---|---|---|
| `unbound` | warning | ≥ 2 massive bodies and total energy ≥ 0 (not for presets tagged `unbound`) | Slow the bodies so it stays together; Try <closest preset> |
| `loosely-bound` | info | bound but kinetic > 0.75 × \|potential\| | Slow the bodies |
| `close-start` | warning | two bodies start within 1% of the system size with under 30% of a circular orbit's angular momentum (they fall together rather than orbit) | Switch to IAS15 and restart (not offered if already IAS15); Try <preset> |
| `coarse-step` | warning | a non-IAS15 method takes fewer than 20 steps per T_char | Use a smaller step and restart; Switch to IAS15 and restart |

### 15.2 Checked while running

| Id | Severity | Trigger | Fixes / behaviour |
|---|---|---|---|
| `failed` | danger | the integration produced NaN/∞ ("broke down") | IAS15 / smaller step / restart (+ suggest/defaults when custom) |
| `energy-blowup` (Euler) | warning | explicit Euler, energy error > 10% — "the failure Euler is here to show" | Smaller step; restart. Does not pause |
| `energy-blowup` (others) | danger | energy error > 10% | IAS15 / smaller step / restart (+ custom fixes). **Pauses the run once** per run; pressing play again does not pause again |
| `energy-drift` | warning | non-explicit-Euler energy error between 1% and 10% | IAS15 / smaller step |
| `integrator-warning` | warning | IAS15 minimum-step or convergence trouble, or WH Kepler failure | IAS15 + restart (or restart/defaults when already IAS15) |
| `escaped-pair` | info | with two bodies: unbound and > 20 sizes apart ("hyperbolic flyby") | Frame all bodies; restart (+ suggested) |
| `escaped-<k>` | info | three bodies: body k unbound and > 20 sizes from the COM of the other two, which stay close | Frame all bodies; restart (+ suggested) |
| `far-<k>` | info | body k beyond 10 sizes but still bound | Frame all bodies |

Fixes in detail: **bind** (scale relative velocities until kinetic = ½|U|, then edit and re-center), **ias15** (switch and reset), **smaller-step** (step = min(dt/4, T/80), then reset), **reset**, **frame** (pull the camera back until every body is in view; does not resume), **suggested** (load the closest preset), **defaults** (restore the preset's own parameters; only offered when the preset has parameters and the user has changed them). Every fix except *frame* resumes running.

### 15.3 "Try this preset instead" (`suggest.ts`)
When the user's own values differ from any preset (custom run, or the Sandbox), the banner can name the closest preset and say why. **Three bodies:** from the mass ratios (one dominant > 20× the other two → star-planet-moon [close pair], trojan [tiny third], or lagrange), similar masses (heaviest ≤ 3× lightest → pythagorean when almost at rest, zlk for a tight non-flat pair, otherwise figure-eight), tight pairs, flatness, and speed. **Two bodies:** from the orbit's energy and eccentricity (unbound → hyperbolic flyby; e > 0.9 → near-radial; e < 0.05 with similar masses → circular binary; else Kepler orbit). The suggestion is "a pointer to a system that works and shows what the user seems to be after, not a fit".

---

## 16. Comparison mode, perturbation and time reversal

### 16.1 Comparison (Analysis ▸ Compare)
A second `Simulation` starts from the first's **current state** (time included, same direction, same settings except what is changed), is stepped to the **same time target**, and is drawn over the first as **translucent ghost bodies** (40% opacity, 15% larger) with fainter ghost trails (always in the world frame). The charts get their own history for it and a **divergence** measure.
- **Ghost twin (nudged):** same method, one body nudged by a tiny amount (position or velocity; direction x/y/z/out-of-plane/random). In a chaotic system the gap grows exponentially (a straight line on the log chart; its slope is the Lyapunov exponent); in a regular one it grows at most linearly.
- **Another method:** a different integrator and/or step on the identical start. **Equalize cost** picks its step so it makes as many force evaluations per unit time as the first run (RK4 gets 4× leapfrog's step); not available for IAS15 (variable cost), in which case the manual step is used.
- **Divergence** = the largest distance between a body and its twin, measured once per frame (exact true-state comparison when both are at the same time, interpolated otherwise); at very high speed several samples share one value.
- Starting a comparison can fail with a message (e.g. Wisdom–Holman does not take softening).
- Any load, reset or edit ends the comparison.

### 16.2 Perturb (System ▸ Perturb)
Nudge one body by a chosen fraction of system size (position) or characteristic speed (velocity), from 10⁻¹² to 10⁻² — "roundoff up to a visible kick" — in a chosen direction. It re-baselines errors and keeps running.

### 16.3 Time reversal and "Return to start"
- **Direction** flips the run backwards; the diagnostics' x-axis keeps growing.
- **Return to start** runs back to the time of the last load/edit and **pauses**, then reports the **phase-space distance** from the initial state (largest difference in any position/velocity component). Expectations: leapfrog and WH retrace to roundoff; RK4 approximately; Euler visibly fails; IAS15 does not retrace exactly; and even leapfrog fails after a long run of a chaotic system. A fixed-step method lands exactly; an adaptive one stops within a step.

---

## 17. Batch jobs (Web Worker)

Jobs run **off the main thread** so the live view never stalls, one at a time, with progress in the status line and a **Cancel job** button (cancel is heard between runs). Results are structured-cloned with their arrays transferred; they display in an overlay over the plate (title, plots, notes, **Close**).

### 17.1 Convergence sweep (+ work-precision)
From the **baseline** (initial) state, for each method over **8 step sizes** spaced geometrically (fractions of T_char):

| Method | Step range (× T_char) | Expected order |
|---|---|---|
| Euler | 1/6400 … 1/204800 | 1 |
| Symplectic Euler | 1/6400 … 1/204800 | 1 |
| Leapfrog | 1/100 … 1/1600 | 2 |
| RK4 | 1/100 … 1/600 | 4 |
| Wisdom–Holman (skipped when softening is on) | 1/100 … 1/1600 | 2 |
| IAS15 | tolerances 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10 (7 values) | — (chooses its own step) |

- Duration defaults to **1.3 periods** (0.25–10), not 1: ending at a symmetric point of the orbit would make symplectic Euler show order 2 instead of its true 1.
- The step is adjusted slightly so a whole number of steps make up the duration. The error is the **largest position-component difference** at the end, measured against the **exact Kepler solution** when one exists, otherwise against **IAS15 at tolerance 1e-10** (not 1e-12, which sits at IAS15's error-estimate noise floor).
- **Two log–log plots:** (1) *Convergence: error against step size*, with each method's **measured order** (least-squares slope of log error vs log step, using runs with error between 1e-12 and 1e-1; "not measurable" if at roundoff or too big) beside the expected order; (2) *Work-precision: error against force evaluations*. A note says what the error is measured against and "where a line flattens, roundoff has been reached".
- Failed runs count as `failures` (their error is NaN).

### 17.2 Fast-forward
Runs the **current system** ahead headless with the current method, step and tolerance for N periods (1–5000, default 100), in 100 slices, keeping ≤ 1000 points. Shows three plots (energy error, angular-momentum error, separation of the closest pair), a summary line (steps, force evaluations, final time; "Stopped early: …" on failure) and a **Continue from the final state** button that loads the final state back into the live simulation.

### 17.3 Lyapunov estimate
The **Benettin method**: a shadow trajectory offset by 1e-8 (in body 1's x), both run with IAS15 at 1e-10 over N periods (1–500, default 20) cut into 400 intervals; each interval the growth of separation (all 18 position/velocity components) is added to a running sum of ln(d/δ₀) and the shadow is pulled back to distance δ₀. Plots the **running estimate of the largest Lyapunov exponent**; reports the final value and the **Lyapunov time** (1/λ) — or "not positive: no sign of chaos". A regular orbit's estimate keeps falling like ln t / t toward zero; chaos levels off above it.

---

## 18. The 3D renderer

Three.js with a Z-up camera (the orbital plane is xy), OrbitControls with damping (min distance 1e-9, max 1e12). Pixel ratio up to 2.

- **Floating origin:** physics is Float64; the GPU only ever sees positions **relative to the camera focus**, subtracted in doubles first, so nothing jitters far from the origin (checked with `?offset=1e6`). Free-mode panning is folded into the origin the same way; clip planes follow the view distance.
- **Bodies:** Lambert-shaded spheres with 35% emission so the dark side never goes black. Displayed radius ∝ m^{1/3} (heaviest = 2% of the system size × the body-size slider), with a minimum of 3 CSS pixels. Not a physical radius. Colors: **gold #f2b84b, cornflower #6aa6ff, bone #ece8dc**, chosen to stay distinguishable under protan, deutan and tritan color-vision deficiency (min ΔE 36).
- **Trails:** a ring buffer per body (default 4000 samples, 200–20 000), drawn as a fading line strip, **alpha = (1 − age)^fade** (default 1.5); age is computed in the vertex shader from `gl_VertexID`; samples are skipped unless the body has moved 0.3% of the view distance; the trail is re-anchored when its anchor is 2000 view distances from the focus. Optional **tint by height** (toward pink above the reference plane, toward blue below) and **shadows** (the trail flattened onto the plane at 30% alpha).
- **Trail frame:** *Follows focus* (with a body in focus, the others trace their orbits around it) or *World*; changing the focus mode or frame clears trails; free orbit is always the world frame; a comparison draws both runs in the world frame.
- **Camera modes:** *Free orbit*, *Center of mass*, *Co-rotating (about z)* (the view turns so the body-1→body-2 line keeps its direction on screen — Lagrange configurations and Trojan tadpoles hold still), *Body 1/2/3*. **Frame all bodies** pulls back until every body fits. **Snap views** relative to the reference plane: top, front, side, isometric.
- **Reference plane:** `z = 0` through the origin, or the plane through the COM **perpendicular to the total angular momentum** (conserved, so it never moves; falls back to z = 0 when L is negligible, as in the figure-eight).
- **Space aids:** floor grid (antialiased in the fragment shader, power-of-ten cells, heavier lines every tenth, fading radially, fixed in world space), optional back walls (two more grids, a "plot box"), **drop lines** from each body to the plane with a footprint dot, trail **shadows**, axes gizmo, **orthographic** option (field of view 1.5° instead of 45°, with the camera moved back so size is preserved).
- **Arrows:** velocity (body-colored) and acceleration (vermilion), with **logarithmic lengths** L·ln(1+|v|/v_typ)/ln 2 (so a body ten times faster is not drawn ten times as long).
- **Off-screen markers:** numbered arrows 22 px in from the edge.
- **Ghost twin rendering:** see [§16.1](#161-comparison-analysis--compare).
- **Auto quality:** if frames stay between 8 and 30 fps for 12 consecutive quarter-second windows, first lower the pixel ratio to 1, then repeatedly halve the trail length down to 1000, and say so in the *Performance* module; it never goes back up (so it cannot oscillate). Below 8 fps it assumes a throttled tab and does nothing.
- **Simulator held while Learn is open:** `view.stop()` cancels the animation frame.

---

## 19. Links: the whole run in the URL

**Copy link to this run** (System module) encodes the setup as compact JSON in base64url: `#s=<…>`. Loading the link restores:
preset and its parameters; method (`euler | symplectic-euler | leapfrog | rk4 | wh | ias15`), step `dt`, `epsTol`, `dtMin`, `dtMax`, WH `centralBody`; `speed`, `direction` (±1), `running`; `G` and `softening` (only when different from the preset's); **edited bodies** (time, masses, positions, velocities, z included — only when edited); **view** (camera mode, plane mode, trail frame, trail length 200–20 000, fade 0–6, body size 0.25–8, and flags for trails, grid, walls, drop lines, shadows, axes, orthographic, tint trails, velocity and acceleration arrows); and the camera offset.

**Hand-written form** (used by every "Try it" link): `index.html#preset=pythagorean&integrator=leapfrog&dt=0.01&speed=2`. Recognized keys: `preset, integrator, focus, plane, dt, epsTol, dtMin, dtMax, central, speed, direction, G, softening, running`. **Any other key is a numeric parameter of the preset** (e.g. `#preset=lagrange&mass=40`, `#preset=kepler&inclination=60`, `#preset=sandbox&lift=0.8&plane=angular`).

**Input is untrusted:** `sanitize()` drops anything malformed or out of range (non-finite numbers, non-positive steps/speed, unknown methods or camera modes, wrong-length arrays, negative masses). An unknown preset is ignored. Settings that do not apply to the method (a central body for leapfrog) are ignored. Applying a link: loads the preset with parameters, sets step/tolerances/method, G/softening, edited bodies (for two bodies slot 2 is zeroed), speed, direction, play/pause, view, camera. Links work at load time and on later hash changes.

---

## 20. The Learn page

A single long page in the app's own window (route `#/learn`), the **Read** mode of the design, with a 288 px **contents column** and chapters of two columns each: the chapter's large condensed title stays on the left while a 74-character serif column scrolls on the right. The page title is **"How the integrators work"**, with the lede *"Plain language first. Open Go deeper for the equations, and Try it to see it in the simulator."*

**Mechanics (`src/learn/`):**
- Content is markdown in `src/learn/content/*.md` (16 files, read in file-name order), rendered by markdown-it (typographer on, raw HTML off) with **KaTeX** for `$…$` and `$$…$$` math and a custom **`:::deeper … :::`** block that becomes a collapsible **"Go deeper"** `<details>` with the equations.
- Links whose text starts **"Try it"** are styled as buttons and open the simulator in a prepared state (§19). The page remembers the reader's place; the simulator holds while it is open.
- Contents are grouped **Foundations / The methods / Behaviour / Reference**; the entry for the chapter being read is marked (IntersectionObserver); clicking an entry scrolls smoothly (instantly with reduced-motion) without adding a history entry per chapter.
- Two chapters are generated from data: **The presets explained** and **References**; the glossary is split into two columns.
- Chapter text is also the source of the simulator's **method info cards** (`## Idea / Analogy / Strengths and weaknesses / Cost / When to use it`).

**Chapters (18):**

| Group | Chapter (id) | What it covers |
|---|---|---|
| Foundations | **What is the three-body problem?** (`three-body-problem`) | Two bodies have a closed form; a third kills it (Bruns, Poincaré). The equation of motion. The ten conserved quantities (energy 1, momentum 3, COM motion 3, angular momentum 3). *Go deeper*: the ten integrals and their symmetries; 18 state numbers minus 10 integrals leaves a chaotic remainder. Sub-section **Two bodies, as a control**: the Bodies switch, the exact orbit, the Laplace–Runge–Lenz vector. Try it: figure-eight, Pythagorean, Kepler orbit, hyperbolic flyby |
| Foundations | **How a computer "moves" planets** (`how-a-computer-moves-planets`) | Time steps and integrators; the stepping-stone analogy; Euler's recipe spirals outward; five methods introduced. *Go deeper*: ẋ = v, v̇ = a(x). Try it: Euler on a Kepler orbit |
| Foundations | **Error, order and cost** (`error-order-cost`) | Local vs global error; order p ⇒ halving dt cuts error 2^p; table of order and force evaluations per method; cost = force evaluations; equalizing cost. *Go deeper*: O(dt^{p+1}) local, O(dt^p) global; the batch tool measures slopes 1, 2, 4. Try it: leapfrog and RK4 at the same step |
| Foundations | **Conservation laws as a lie detector** (`conservation-laws`) | How a method fails to conserve energy identifies it (bounded oscillation / steady drift / rapid growth / √t growth); momentum and angular momentum to roundoff; why angular momentum error uses Σm\|r\|\|v\| (figure-eight has L = 0). *Go deeper*: softened potential. Try it: figure-eight with RK4 vs leapfrog |
| The methods | **Euler** (`euler`) | Card: Idea, Analogy ("walking while looking only at your feet"), Strengths/weaknesses (explicit vs symplectic Euler), Cost, When to use it. *Go deeper*: phase-space area growth 1+O(dt²). Try it: explicit and symplectic Euler |
| The methods | **Leapfrog** (`leapfrog`) | Kick-drift-kick; two dancers analogy; second order, symplectic, time-reversible; cached force. *Go deeper*: shadow Hamiltonian, O(dt²) energy wobble. Try it: figure-eight |
| The methods | **RK4** (`rk4`) | Four slope samples, "tasting the soup"; fourth order, not symplectic; four evaluations (give it 4× leapfrog's step). *Go deeper*: k₁…k₄ formulas. Try it: figure-eight at a coarse step |
| The methods | **Wisdom–Holman** (`wisdom-holman`) | Kepler does the heavy lifting; river-and-gusts analogy; error ∝ perturbation size; fails for comparable masses; no softening; choose the central body well. *Go deeper*: Jacobi coordinates, μᵢ = Gηᵢ, dt rule of thumb. Try it: star-planet-moon, Trojan |
| The methods | **IAS15** (`ias15`) | High-order polynomial per step, shrink the step when the last term is not tiny; driver analogy; 15th order, adaptive, near roundoff, not symplectic; ≈ 20 evaluations/step. *Go deeper*: 7 Gauss–Radau nodes, step rule dt(ε_tol/ε)^{1/7}, the known limit of the original criterion. Try it: Pythagorean |
| Behaviour | **Symplectic, simply** (`symplectic`) | Phase-space volume; shadow Hamiltonian; why planets are followed for millions of years; "symplectic does not mean accurate — the error has a shape". *Go deeper*: J^T Ω J = Ω, backward error analysis. Try it: symplectic Euler on the figure-eight |
| Behaviour | **Time reversal and roundoff** (`time-reversal`) | Which methods retrace (leapfrog/WH to roundoff; RK4 approximately; Euler fails; IAS15 not exactly); chaos defeats even leapfrog; JANUS integer arithmetic. *Go deeper*: reversal-failure time ≈ λ⁻¹ ln(10¹⁶). Try it: leapfrog then Return to start |
| Behaviour | **Chaos** (`chaos`) | Exponential divergence; the ghost twin; Lyapunov exponent and time; stable systems diverge at most linearly (figure-eight); periodic but unstable orbits (Butterfly I grows ≈ 70% per period; refined initial conditions). *Go deeper*: δ(t) ≈ δ(0)e^{λt}. Try it: Pythagorean; Butterfly I |
| Behaviour | **Stability of special solutions** (`stability`) | Lagrange triangle and the Routh criterion (m above ≈ 50.5 for masses (m,1,1); equal masses give 9); Euler collinear is unstable; Trojans librate (tadpole); a moon stays inside the Hill sphere (≈ 0.45 R_H survives, lost beyond ≈ 0.5). *Go deeper*: linearization, Trojan stability μ < 0.0385. Try it: four links (dominant mass, just below the limit, Trojan, moon beyond its stable distance) |
| Behaviour | **Three dimensions, and the plane the motion lives in** (`three-dimensions`) | Why famous orbits look flat; editing z/v_z, out-of-plane nudge; drop lines and shadows; the natural plane perpendicular to L; Tilt is a symmetry; the von Zeipel–Lidov–Kozai cycle above ≈ 39°. *Go deeper*: conserved √(1−e²)cos i. Try it: inclined test particle, Kozai cycle, lifted sandbox against the natural plane |
| Reference | **The presets explained** (`presets`, generated) | One article per preset (21): what it shows, source, "Checked by a test: …" or "Not independently checked.", and a **Try it** link. Anchors `preset-<id>` |
| Reference | **Units and G** (`units-and-g`) | Dimensionless numbers, N-body vs astronomical units (G = 4π²), changing G restarts references, the characteristic time T_char. *Go deeper*: scaling away G |
| Reference | **Glossary** (`glossary`) | 17 short definitions: adaptive, angular momentum, chaos, COM, close encounter, energy error, force evaluation, Hill radius, integrator, Jacobi coordinates, Lyapunov time, order, periodic orbit, softening, symplectic, time step, Trojan |
| Reference | **References** (`references`, generated) | 14 references, each checked against the publisher's or arXiv's page; only verified details are given |

**The 14 references:** Wisdom & Holman 1991 (symplectic maps); Rein & Spiegel 2015 (IAS15); Rein & Tamayo 2015 (WHFast); Rein & Tamayo 2018 (JANUS); Pham, Rein & Spiegel 2024 (new timestep criterion); Everhart 1985 (Gauss–Radau integrator); Yoshida 1990 (higher-order symplectic); Moore 1993 (braids; figure-eight); Chenciner & Montgomery 2000 (figure-eight); Šuvakov & Dmitrašinović 2013 (three classes of periodic orbits); Li & Liao 2013 (comment on the 5-digit conditions); Szebehely & Peters 1967 (Pythagorean problem); Ito & Ohtsuka 2019 (Lidov–Kozai and von Zeipel); Rein & Liu 2012 (REBOUND).

---

## 21. Visual design system

Called **"The Plate and the Specification"** (`DESIGN.md`): the simulator is laid out like a figure in a journal beside its specification sheet. **Dark only**; flat and ruled; no cards, shadows, gradients, glass, glow, colored side borders, section numbers or icon circles; radius ≤ 2 px.

- **Neutrals:** plate `#060607` (3D view) · ground `#0d0d0f` (bar, charts) · raised `#121214` (panel, menus) · field `#1a1a1d` (inputs, hover) · rule `#26262a` and rule-strong `#3b3b40` (1 px lines) · ink `#e6e3dc` · ink-2 `#a6a39b` · ink-3 `#858279` (all ≥ 4.5:1 on ground).
- **One accent — Signal Vermilion `#ff5a36`:** the paused Play button, the open tab's underline, the focus ring, text selection, the drag handle, the worst warning, and event marks on charts. "If it appears twice in one view for different reasons, one is wrong." Status tones: ok `#8fbf86`, warning `#e5a73c`, danger = vermilion, info = ink-2.
- **Body colors are data** (gold/cornflower/bone) and never decorate the chrome. Batch plots use a separate set of method colors: Euler `#d9695f`, symplectic Euler `#e3a94b`, leapfrog `#7fbf7b`, RK4 `#5aa9d6`, WH `#a68ad8`, IAS15 ink.
- **Type:** Archivo Variable for everything (display 300/56 px width 78% for the clock; headline 700/30 px for the preset name; title 650/16 px; body 400/13.5 px ≤ 62ch; label 400/11.5 px); **Source Serif 4** (18 px) only for the Learn reading column; chapter titles up to 62 px at width 70%. **Width Is the Display Voice** (large type is condensed, never another family); **No Costume Mono** (numbers are tabular figures in the same family; the one monospace exception is the chart marker/gizmo labels).
- **Components:** bar cells (caption above, 15px/600 value, 1 px vertical rules), 32 px buttons with 1 px outline (primary filled vermilion), 24 px segmented control (selected segment filled ink), flat tabs underlined 2 px, module sections with 16 px title/chevron/close and 54 px heads, banners (strip with a tone square beside the title), ruled menus (no shadow).
- **Layout:** 44 px masthead, 64 px instrument bar, 420 px (340–720) resizable module column, plate ≈ two thirds; desktop ≥ 1200 × 680.
- **Motion:** limited to state changes; respects `prefers-reduced-motion` (both stylesheets).
- Tokens live in `src/ui/tokens.css` and are mirrored in `src/ui/palette.ts` for canvas/chart code.

---

## 22. Product intent, principles and accessibility

From `PRODUCT.md`:
- **Purpose:** an in-browser sandbox for two- and three-body gravity and the methods used to follow it, showing conservation laws, order, cost, reversibility and chaos, with a Learn page that links back into the simulator in a prepared state.
- **Positioning:** the numerics are checked, not decorative; the interface is a scientific instrument and the math is never traded for looks.
- **Principles:** (1) Correctness first — a pretty wrong picture is worse than none. (2) Show where each method fails, plainly, and say why in the words of the Learn page. (3) A warning names the problem and offers the fix. (4) The same controls work for two bodies and three; the interface never shows a body that is not there. (5) Dense and exact in the controls, quiet around the plate.
- **Brand brief:** asymmetric editorial layout, structural typography, a limited palette with one strict accent, 1 px rules instead of cards; explicitly **not** floating cards, glassmorphism, heavy shadows, purple/blue neon gradients, gradient text, centered hero sections, 3-column icon grids, generic footers or decorative shapes. Module names are Title Case ("Bodies & Physics"); descriptions are sentence case.
- **Evidence:** the test suite and the Learn content; no testimonials, users or benchmarks exist and none should be invented.
- **Accessibility:** body colors stay distinguishable under protan, deutan and tritan vision; tone is never carried by color alone (a title and a square); text ≥ 4.5:1; everything operable from the keyboard with a visible focus ring; ARIA roles on the segmented control (radiogroup), tabs (tablist), separators (resizers with value ranges), alerts (banner), status (status pill), and labelled view region ("The three bodies in 3D…" / "The two bodies…").

---

## 23. Architecture and file-by-file map

```
index.html            app entry (dark background before CSS; viewport width 1280; mounts #app, loads src/main.ts)
learn.html            redirect stub to ./#/learn (+ a plain link as fallback)
vite.config.ts        base './', appType 'mpa', inputs index+learn; vitest config (node env, 30 s timeout, restoreMocks)
package.json          scripts and dependencies
tsconfig*.json        strict TS (app: ES2023, DOM; includes src and tests; node config for vite.config)
eslint.config.js      typescript-eslint; unused vars with `_` prefix allowed; no `any` in src; prefer-const; eqeqeq
.github/workflows/ci.yml   CI (Node 22: typecheck, lint, test, build)
README.md · PRODUCT.md · DESIGN.md   documentation (README: usage; PRODUCT: intent; DESIGN: design system)
archive/              the original Streamlit app (see §26)
tools/                offline helpers (see §25)
tests/                Vitest suites (see §24)
src/
  main.ts             builds both pages, wires Controller/Charts/modules/banner/masthead, routing, refresh timers, pref saving
  sim/                pure, DOM-free simulation (imports nothing from the folders below)
    types.ts          SystemState, BodyCount, CostCounters
    state.ts          createState / snapshot / copyState / counters (allocation only at init)
    forces.ts         computeAccel (3-body and 2-body kernels), potentialEnergy
    diagnostics.ts    measure, references, error measures, T_char, characteristic speed, system size
    events.ts         min separation, hasEscaped
    transforms.ts     rotateState, nudge, scaleToBound
    coords.ts         COM shift, inertial↔Jacobi
    kepler.ts         universal-variable Kepler drift, Stumpff functions
    analytic.ts       KeplerReference (exact two-body solution for error charts)
    simulation.ts     Simulation (state, integrator, advanceTo, stateAt, failure/health handling)
    sampler.ts        diagnostic history (ring buffers, 2:1 thinning), SERIES table, CSV export
    batch.ts          convergenceSweep, fastForward, lyapunov, geometricSeries, fitSlope, cancellation
    integrators/      types, index (factory), euler, leapfrog, rk4, wh, ias15, ias15_constants (generated)
  presets/            schema, index (21 presets), figureEight, generators, data/suvakov.json, verify.ts (return check, orbit refinement)
  app/                controller, loop (SimLoop), comparison, health, suggest, urlState, router, batch (worker client)
  render/             scene (SceneView), bodies, trails, vectors, gridPlane, dropLines, gizmo, frame (plane frames, snap views), offscreen, quality
  ui/                 shell (+ shell.css, tokens.css), masthead, topbar, banner, charts, chartLayout, batchView, arrangement, dockMenu, groups, infoCards, palette, prefs, popover, align, axes, dom
    modules/          common, system, method (+ time), bodies (+ perturb, compare), data (numbers, export, batch, performance), view
  worker/             batch.worker.ts, host.ts (message handling, testable), protocol.ts
  learn/              page.ts, render.ts (markdown+KaTeX), markdown.ts (helpers), references.ts, learn.css, content/*.md
```

**Design rules visible in the code:**
- `sim/` is DOM-free and import-free of the other folders; tests run it in plain Node.
- All edits go through `Controller` (one path), which owns the `Simulation`; the view is never handed the `Simulation`.
- Step loops are allocation-free (state arrays pre-allocated at init); a test checks the heap does not grow.
- Setters bound to Tweakpane do nothing when given the value they already hold (Tweakpane writes values back through bindings).
- Comments throughout cite sections of a planning document (`plan §N`) that is not in the repository.

---

## 24. Testing and verification

**Vitest, 37 files, ≈ 530 cases**, all running in Node (the sim is DOM-free). Coverage by area:

- **Numerics:** `forces` (against a naive reference and hand calculations, potential, momentum), `kepler` (Stumpff, exact solutions, random 3D orbits, edge cases), `coords` (Jacobi round trips, COM shift), `integrators` (contract, force-evaluation cost, **convergence order after one period**, conservation, time reversal), `wh`, `ias15`, `ias15_constants` (Radau exactness, table inverses, round trip), `diagnostics`, `events`, `transforms`, `state`, `simulation` (load/advance/step/failure/setIntegrator/reset/reversal/stateAt/diagnostics), `twoBody` (absent slot, same physics as a massless third body, order against the exact orbit, analytic reference, edits never move the absent slot), `bodyCount` (preset lists, switching, links, warnings, the figure-eight unchanged).
- **App logic:** `controller`, `loop` (time target, budget, twin), `comparison` (twin, equalized cost, return to start), `health` (preflight, runtime issues, scaleToBound, suggestions), `urlState` (encode/decode, sanitize, capture/apply), `router`, `sampler` (history, thinning, KeplerReference, integrator health events), `batch` and `batchWorker` (orders, progress, cancellation, fast-forward, Lyapunov, host, transferables), `allocation`.
- **Presets:** `presets`, `generators` (rigid-rotation solutions, Routh criterion, Kepler, star-planet-moon, Trojan libration, Kozai, sandbox, two-body generators), `presetVerification` (**each periodic preset returns to its start after its claimed period; Šuvakov stable orbits stay, unstable ones leave; Pythagorean**), `learn` (markdown rendering, helpers, content, integrator cards, "Try it" links open the right state, references).
- **Rendering/UI logic:** `scene` (focus point, floating origin, bodies, defaults, co-rotating and orthographic views), `frame` (plane frames, snap views), `trails` (double-write window, partial uploads, floating origin, resize/clear), `quality`, `chartLayout`/arrangements, `align`.
- **Golden data:** `tests/golden/golden.json` holds the same runs made with **REBOUND** (IAS15, WHFast, leapfrog) — **our IAS15 and Wisdom–Holman agree with it to about 1e-12** on the figure-eight and the hierarchical triple. REBOUND is GPL-3.0; it is used only as an outside program to produce numbers and none of its code is in this project. To regenerate: create a Python venv with `rebound`, run `WRITE_GOLDEN_INPUTS=1 npx vitest run tests/golden/exportInputs.test.ts`, then `python tools/reference/make_golden.py`.
- **"Verified" presets:** a preset is marked verified **only if a test has run it**; `npm run verify:presets` runs just the periodicity checks (`returnCheck`: IAS15 at 1e-10 with a floor step of 1e-7 of the period, searching a ±2% window for the closest return; the Šuvakov data were refined by `refineSymmetricOrbit`, Gauss–Newton shooting).

---

## 25. Tooling, build, CI and housekeeping folders

- **Commands:** `npm install`; `npm run dev` (app at `http://localhost:5173`); `npm test` / `test:watch`; `npm run typecheck`; `npm run lint`; `npm run build` (static site in `dist/`); `npm run preview`; `npm run verify:presets`.
- **`tools/gen_ias15_constants.py`:** generates the IAS15 Gauss–Radau tables into `src/sim/integrators/ias15_constants.ts` at **60-digit precision** with mpmath, derived from the mathematics (left Gauss–Radau rule with 8 points on [0, 1], Newton basis N_k, radau exactness through degree 14), not copied from any integrator.
- **`tools/reference/make_golden.py`:** produces the REBOUND golden data (see §24).
- **Housekeeping/tooling folders (untracked, not part of the app):** `.agents/`, `.claude/` (agents, `launch.json`, skills, local settings), `.codex/`, `.cursor/`, `.impeccable/` (design-tool config/cache). `dist/` and `node_modules/` are build/install output and are git-ignored; `.gitignore` also covers logs, editor folders and `*.local`.

---

## 26. The archived Streamlit original

`archive/numerical_integrator_sandbox.py` (+ `requirements.txt`: numpy, plotly, streamlit) is the **first version** of the project: a Python/Streamlit app titled **"The Numerical Integrator Sandbox"** (the project's old name), a **2D two-body** comparison of three integrators.

- Methods: **Forward Euler**, **Classical RK4**, **Leapfrog** (with a table listing order, symplectic?, cost — it listed leapfrog as 2 evaluations/step, where the new app caches the acceleration and uses 1).
- Sidebar: four preset buttons (**Circular Orbit** e=0, dt=0.01, T=20; **High Eccentricity** e=0.7, dt=0.005, T=40; **Near Escape** e=0.9, dt=0.001, T=60; **The Chaos Trigger** e=0.5, dt=0.2, T=20), sliders for eccentricity (0–0.9), total time (5–100) and dt (0.001–0.5; shows the number of steps required), and a multi-select of methods.
- Orbit starts at periapsis (x₀ = 1, GM = 1) with a tangential velocity; metrics shown: semi-major axis, period, specific energy, angular momentum.
- A warning appears when dt > 0.1 (Euler injecting artificial energy → outward spiral).
- Three tabs: **Trajectory Comparison**, **Energy Drift Analysis**, **Angular Momentum Conservation** (Plotly), plus an expander "About the three integration methods".
- It is excluded from linting; the current TypeScript app supersedes it (adding 3D, 3 bodies, five methods, charts, Learn page, etc.).

---

## 27. Known limits, not-done items and observations

**Documented limitations (README / code comments):**
- Not done: **dragging bodies in the view**, **exaggerating z for display**, the **symplectic correctors of WHFast**, and the **newer IAS15 timestep criterion** (Pham–Rein–Spiegel 2024).
- **Šuvakov–Dmitrašinović orbits:** the shipped initial conditions are refined (≈ 1e-11 closure); the periods differ from the published ones in the fourth digit; the closure test vouches for them.
- **IAS15 with a tight pair far from the origin:** the step can collapse (see §11); tolerances below 1e-10 are near the noise floor.
- **Allocation:** the step loop retains nothing but makes a little short-lived garbage per step (boxed doubles); measured, not zero.
- **Divergence in comparison mode** is measured once per frame, so at very high speed several samples share one value.
- **Desktop-only:** no phone/tablet layout.
- **Hosting target** is still open (comment in `vite.config.ts`); the build is host-agnostic.
- **Bodies never merge** (a collision is just a close encounter with a user-chosen radius); changing N would break Wisdom–Holman's Jacobi setup.
- **Wisdom–Holman cannot use softening**; choosing WH removes it.
- **A massless pair** (two test particles) has no period or COM; such systems fall back to defaults (T_char = 1, plain-mean COM).

**Observations from reading the project (not stated in its docs):**
- Several Learn chapters still use older interface words: they refer to the *"Compare folder"*, *"Bodies folder"*, *"Perturb tool"* and *"the Diagnostics folder shows the Routh value"*; in the current interface these are the **Compare**, **Bodies & Physics**, **Perturb (chaos)** modules, and the Routh value is in **Live Numbers**.
- Some Learn text still speaks only of three bodies (e.g. the glossary defines a force evaluation as "the pull on all three bodies") though the app now also runs pairs.
- The Method module's "About this method" text is read straight from the Learn markdown, so editing a method's chapter changes the in-panel card as well.
- When run in a browser window smaller than 1200 px the page scrolls rather than reflows (observed at 800 × 600; at an emulated 1440 × 900 the full layout shows).

**Observed in a live run (dev server, emulated 1440 × 900):** the default view is *Figure-eight / Leapfrog*, running at 0.13 orbits/s; the module chooser lists 11 modules under the four tabs; the Layout menu shows the four arrangements plus the Charts/Module-panel checkboxes, the "F orbits only, and back" hint and *Reset layout*; with charts on, the drawer shows Energy, Ang. momentum, Closest pair and Step size by default (the exact-Kepler and Divergence chips are marked n/a until data exist); switching to 2 bodies loads *Sandbox (2 bodies)* (the last used) with presets *Kepler orbit, Circular binary, Near-radial plunge, Hyperbolic flyby* and the closest-pair chip renamed "Separation"; the *Learn* page shows 18 chapters, 21 preset entries and 14 references; the link `#preset=kepler-orbit&integrator=euler&dt=0.05&speed=3` loads and raises the banner **"Euler's energy has run away — Energy is off by 61%…"** with the buttons *Use a smaller step and restart*, *Restart this run*, and *Why does this happen? →*.
