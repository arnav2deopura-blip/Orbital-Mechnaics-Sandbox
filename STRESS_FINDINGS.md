# Stress-test findings

Produced by the stress plan (phases 0–2), plus the live chaos indicator built from its findings. Reproduce with:

```bash
STRESS=1 npx vitest run tests/stress/physics.test.ts
STRESS=1 npx vitest run tests/stress/inputs.test.ts
STRESS=1 npx vitest run tests/stress/chaos.test.ts
```

Both are skipped in normal `npm test` and CI. A failing case in them is a finding, not a regression. Phases 3–6 (performance soak, browser pass, content review, and the remaining fixes) are not done yet. The bugs marked **Fixed** below were fixed afterwards, and a later pass (the section at the end) fixed most of the rest.

Tags: **[P]** reproduced by a test or probe here, **[R]** seen only by reading the code and still to be reproduced.

## What checked out

- **Core physics is right.** Force kernel, Euler (both forms), leapfrog, RK4, the universal-variable Kepler drift, the Jacobi transforms, Wisdom–Holman, the IAS15 constants, diagnostics and the Routh threshold (50.46) all check out on reading, and the tests below agree.
- **Convergence order [P].** Fitted slopes on systems the suite does not cover (figure-eight, softened figure-eight, Kepler pair + massless body, 3D sandbox):

  | Method | Nominal | Measured |
  |---|---|---|
  | Euler / symplectic Euler | 1 | 0.98–1.00 |
  | Leapfrog | 2 | 2.00 |
  | RK4 | 4 | 4.02–4.20 |

- **Kepler drift [P].** Matches an independent bisection solver on ellipses (e from 0 to 0.999999, 1e-12 to 100 periods, both signs) and on hyperbolas (e from 1.000001 to 50). The forward-then-back round trip is exact, including a near-radial plunge (h = 1e-6). The apparent e = 0.999999 failures in the first run were the *reference's* conditioning limit at pericentre (E³/6 ≈ M, so a 1e-16 error in M is ~1e-5 in E), not the solver.
- **Long-run invariants [P].** Every preset with its recommended method, up to 300 T_char (or the 8 s wall budget): energy error ≤ 1.5e-9 (leapfrog Lagrange; everything else ≤ 7e-12), angular momentum ≤ 5e-14 relative, momentum ≤ 5e-13.
- **Reversibility [P]** (800 steps forward, 800 back, max position error): leapfrog 2.8e-14, WH 5.8e-14, RK4 9.0e-7, symplectic Euler 6.3e-2, explicit Euler 3.5. IAS15 is not exactly reversible (5e-3, and time does not return to 0), as its adaptive step is not symmetric. This matches the Learn text except that symplectic Euler is not mentioned as irreversible.
- **Controller state machine [P].** 120 random 40-action sequences (play, step, reset, reverse, return-to-start, preset and body-count and method switches, twin and method comparison, edits, G, softening, encounters): 0 exceptions, 0 non-finite states, slot 2 always empty in 2-body mode. Caveat: actions go to the controller directly, not through the render loop.
- **Failure and warning plumbing [P].** 300 random ordinary 3-body systems (masses 0.2–3, positions ±2, speeds ±0.8) run 10 T_char: no hard failures with any method, and **0 silent cases**. Whenever energy error reached 0.1, or 1e-2 for non-Euler methods, a warning or danger banner was raised.
- **In-range preset sliders [P].** Every slider at its own min and max gives a finite state that runs for one period.

## Bugs and defects

### Chaos is not communicated (the main concern)

1. **No automatic "this run is chaotic" message [R, confirmed by the census below].** Only the opt-in twin chart, the opt-in batch Lyapunov job, and a Learn link inside the "escaped" banner touch on it.
2. **Good energy conservation hides chaos [P].** IAS15 held energy error below 1e-6 on all 60 random systems, which are generically chaotic, so no banner appears. A run with energy error 1e-13 is still unreliable after a few Lyapunov times, and nothing says so.
3. **Finite-time Lyapunov census [P]** (Benettin, twin 1e-8 × size apart, renormalised every T_char/4, IAS15 epsTol 1e-10, 6 s budget per preset). T_λ = 1/λ:

   | Group | T_λ / T_char | Window |
   |---|---|---|
   | Regular 3-body presets: kepler (test particle), figure-eight, lagrange (m=100), trojan, star-planet-moon, zlk | 9.7–19.9 | 100 T |
   | Chaotic: Šuvakov Butterfly 1/2/3, Moth 1/2, Dragonfly | 0.35–0.78 | 9–21 T |
   | Chaotic: Bumblebee | 0.18 | 5 T |
   | Chaotic: sandbox | 1.08 | 76 T |
   | Chaotic: Pythagorean | 0.07 | only 2 T reached (the stall, item 7) |
   | Unstable: Euler collinear | 0.09 | 100 T |
   | 2-body presets: kepler-orbit, circular-binary, sandbox-2, hyperbolic-flyby | 9.7–18.4 | 100 T |
   | **2-body `near-radial`** (not chaotic) | **0.19** | 64 T |

   Consequences for a chaos indicator:
   - A regular orbit's finite-time exponent is not zero (~0.005–0.02), so a threshold is needed: roughly "chaotic" below T_λ ≈ 3 T_char, sustained over at least 10 T_char.
   - It **must be off in 2-body mode**: a very eccentric 2-body orbit amplifies a perturbation hugely at each pericentre pass and would read as chaotic.
   - Euler collinear is an unstable periodic orbit whose exponent is real but not the same thing as chaos. The message should say "unstable" or "sensitive", not "chaotic".
4. **Raw divergence misreads non-chaotic runs [P, earlier probe].** A 1e-10 nudge reaches 10% of system size by about 1.6 T on the hyperbolic flyby, similar to truly chaotic runs. An indicator must fit exponential growth, not use a distance threshold.
5. **Batch Lyapunov says "no sign of chaos" for a run that failed [R]** (`src/sim/batch.ts` ~303, `src/ui/batchView.ts` ~132).
6. **Twin failure is never raised as a banner; the pill can read "Running" while the clock is frozen [R]** (`src/app/loop.ts` ~92, `src/app/controller.ts` ~586).
7. **Possible false divergence spikes when the frame budget runs out [R]** (`loop.ts` ~116, `comparison.ts` ~67).

### Physics and preset defects

1. **Trojan inclination slider adds energy [P].** `generators.ts:221` sets `v_z = ωa·tan i` on top of the circular speed. Semi-major axis over radius: 1.001 at 0°, 1.009 at 5°, 1.033 at 10°, 1.079 at 15°, 1.154 at 20°, 1.280 at 25°, 1.503 at 30°. The default is 8°. Fix: rotate the velocity by (cos i, sin i), as `kepler()` already does.
   **Fixed.** The velocity relative to the Sun is now turned out of the plane (cos i in it, sin i out), so the heliocentric energy and semi-major axis are the flat orbit's at every inclination, to 1e-9 (`generators.ts`, tests in `generators.test.ts`).
2. **IAS15 false "corrector did not converge" warnings [P].** Count per 5000 steps, by `epsTol`:

   | Preset | 1e-6 | 1e-9 | 1e-12 |
   |---|---|---|---|
   | lagrange | 121 | 9 | 0 |
   | circular-binary | 102 | 9 | 0 |
   | euler | 87 | 5 | 1 |
   | sandbox-2 | 15 | 2 | 0 |
   | kepler-orbit | 2 | 1 | 0 |
   | zlk | 2 | 0 | 0 |
   | near-radial | 0 | 1 | 0 |

   Evaluations per step also rise as the tolerance loosens (about 15 at 1e-12, 22 at 1e-9, 29–37 at 1e-6). Likely cause: `CONVERGED = 1e-16` with no stagnation exit in `iterate()` (`ias15.ts`).
   **Fixed.** A corrector that has stopped improving at a change far below the tolerance now counts as converged (and stops), instead of being flagged. The settling threshold is 1% of epsTol, never below the roundoff noise (1e-13) nor above 1e-11. The false flags are gone at every tolerance but the very edge (an unstable orbit at 1e-12 still flags about 1 step in 5000, which is noise-limited), and a step forced far too large is still flagged (tests in `ias15.test.ts`).
3. **IAS15 stalls on the Pythagorean problem [P].** In an 8 s wall budget it reached only t/T = 8.0 (t ≈ 87). With dtMin 1e-9 it needs 410,496 steps to reach t = 89.8. The error criterion reads roundoff noise from the tight binary far from the origin, so dt collapses, at exactly the interesting moment. The live app shows only "N% of requested speed" in a tooltip.
4. **T_char is recomputed on every edit [R]** (`controller.ts` ~283), so the step readout, speed readout, chart sampling interval and coarse-step check all jump after a rotate, nudge or G change on a preset with a declared period (figure-eight: 6.326 → 4.443).
5. **Šuvakov stability tests cannot tell stable from unstable orbits [R].** The 10-period bound of 1e-8 is also met by the unstable Butterfly I; Dragonfly's "unstable" label is untested; the `stable` flags have no cited source. Needs a monodromy/Floquet check.
6. Euler-collinear and Lagrange instability below the Routh mass are untested. `scaleToBound` calls K < |U| "bound" (negative total energy does not prevent a 3-body escape). The momentum-error chart is absolute with no scale. `isFiniteState` sums 18 numbers and can overflow on legitimate huge values.

### Input handling

1. **Out-of-range preset sliders from a link give NaN states [P].** Not range-checked (`urlState.ts` ~138). Reproduced for:
   **Fixed.** `resolveParams` pulls every override back to its slider's range and ignores non-numbers, so links, the UI and tests all get a real state (tests in `generators.test.ts` and `urlState.test.ts`). The message for a failure from absurd values is still the generic "close approach" one (see below).
   - kepler / kepler-orbit `e` ≥ 1.9, `massRatio` ≤ 0;
   - lagrange `mass` < 0;
   - star-planet-moon `fraction` ≤ 0;
   - near-radial `e` < 0 or > ~1.1;
   - hyperbolic-flyby `e` ≤ 0.

   The user then sees "two bodies came so close that one step sent the numbers to infinity", which is the wrong cause.
2. **`applyState` can throw [P].** `#preset=kepler&massRatio=-1e308` throws "IAS15 needs a positive first guess for dt" out of the link handler (NaN period gives a NaN first step).
   **Fixed.** No longer reachable: the parameter is clamped, so the period is finite.
3. **WH throws uncaught on a zero-mass central/inner pair [P]** (`wh.ts:99`; `Controller.edit` and `setIntegrator` do not catch it, leaving the state half-loaded). Also reachable programmatically: WH plus softening through `edit()` throws, which the UI avoids because `setSoftening` guards it.
   **Fixed.** `Controller.setIntegrator` now checks the system with the integrator's own `init` on a copy and, if refused, changes nothing and shows a banner (and returns the reason). An edit that leaves a Wisdom-Holman run with a system it cannot run switches the run to IAS15 first, with an info banner. Choosing a central body that cannot run is reverted. (`controller.ts`, tests in `methodRejection.test.ts`.)
4. **Extreme but finite link values fail cleanly on the first step [P]** (dt 1e300, G 1e308, dtMin ≥ 1e300, structured `bodies` with 1e300 coordinates or t = 1e300), but with the same misleading "close approach" message. No exceptions, no NaN left running.
5. **`__proto__` as a link key rejects the whole link [P]**; other prototype names (`constructor`, `toString`) are ignored harmlessly. A rejected link gives no feedback [R].
   **Fixed.** Link keys are matched with `Object.hasOwn`, so `__proto__` no longer throws the link away. A rejected link still gives no feedback.
6. From code reading and not yet reproduced [R]:
   - Return to start reports false success when the direction is reversed mid-return, and leaves the run going backward.
   - Back/Forward to a `#s=…` hash reloads and wipes the run.
   - Fast-forward "Continue" applies an old result to a changed system.
   - Failed batch sweep runs are plotted at 1e-18, and a stopped comparison draws NaN as 1e-18.
   - A batch worker that fails to load hangs every later job.
   - Step with a twin runs unbudgeted.
   - Off-screen arrows are mirrored beyond the far plane.
   - "Unbound" is falsely warned when re-center COM is off.
   - Camera and body scale are stale after edits.
   - A close-encounter pause shows no reason.
   - dtMin > dtMax is allowed.
   - A switched method does not revive a dismissed warning.

### UX, accessibility, content, tests

See the plan's sections D–F; nothing there was re-tested in this pass. The built-in browser pane ran at about 2 fps, so it can't be used for timing, and below 1200 px the layout is clipped with no explanation (seen at 800 px).

## Chaos indicator: implemented

Items A.1–A.4 above are addressed by a live chaos probe (`src/sim/chaos.ts`, run in the worker through `src/worker/host.ts`, owned by `Controller.chaos`, shown by `src/app/health.ts` and `src/ui/banner.ts`).

**How it works.**
- From the run's initial state it follows two IAS15 copies, one offset by 1e-8 × the system's size, and renormalises the offset whenever the separation has grown by e³ (or 4 T_char have passed). The exponent is the growth over the trailing 8 T_char.
- It is independent of the run's method and runs ahead of what is on screen, so a verdict usually arrives within a few seconds.
- It is off for two bodies and for fewer than two massive bodies.
- It restarts (after 0.4 s) on a load or an edit, and is kept through a reset or a method change.
- A job in flight is cancelled by the next restart.

**What the user sees.**
- **Banner "This run is chaotic" (info)** when the Lyapunov time is under 3 T_char, with the Lyapunov time in orbits and how long the path can be trusted.
- **Banner "This run is extremely chaotic" (warning)** when it is under 1 T_char.
- **Banner "Past the point where this path can be trusted" (warning)** once the run has gone beyond that horizon, plus a chart marker at that moment. The horizon is T_λ·ln(0.1/ε) with ε = max(1e-12, the run's current energy error), so a coarse method gets a shorter horizon.
- **"Show me: start a ghost twin"** starts the existing twin with a 1e-4 nudge, so the divergence shows within a few tens of orbits.
- **Live Numbers** gets a `chaos` row: `measuring N%`, `chaotic, e per 2.0 T`, `extreme, e per 0.3 T`, `no sign in 48 T`, `inconclusive`, or `none: two bodies`.
- **Learn** gets a paragraph in the Chaos chapter and a glossary entry for the predictability horizon.
- It never pauses the run, and it does not pause or change anything else.

**Verdicts on every preset** (final constants, IAS15 pair, in the browser's worker the wall times are similar):

| Preset | Verdict | T_λ / T_char | Probed | Wall |
|---|---|---|---|---|
| Euler collinear | extremely chaotic | 0.09 | 6 T | 0.0 s |
| Pythagorean | extremely chaotic | 0.32 | 6 T | 3 s |
| Sandbox (3D) | chaotic | 1.95 | 18 T | 1 s |
| Šuvakov Butterfly I | chaotic | 1.79 | 20 T | 5 s |
| Kepler pair + test particle | no sign | 5.0 | 48 T | 1.4 s |
| Figure-eight, Lagrange (m=100), Trojan, star-planet-moon, ZLK | no sign | 14.7 / 43.5 / 40.2 / 45.3 / inf | 48 T | ≤ 2 s |
| Šuvakov Butterfly II, Bumblebee, Moth I, Moth II, Butterfly III | no sign | 40.1 / 21.2 / 43.0 / 42.4 / inf | 48 T | 7–29 s |
| Šuvakov Dragonfly | no sign (close to the line) | 3.6 | 48 T | 14 s |
| All five 2-body presets | off | n/a | 0 | 0 |

The regression tests (`tests/chaos.test.ts`) pin Euler collinear, the sandbox, and four regular systems; the full table is reproduced with `STRESS=1 npx vitest run tests/stress/chaos.test.ts`.

**Caveats.**
- "No sign" means none appeared in the first 48 periods. It does not prove regularity. Dragonfly at 3.6 is only just on the regular side of the 3.0 line.
- Whether an unstable orbit such as Euler collinear should read "chaotic" or "unstable" is a wording question: its exponent is real, but the orbit is periodic. The banner currently says chaotic.
- The Šuvakov orbits take 5–29 s because IAS15 has to resolve a close pass every period, twice over. The probe runs in its own worker, so the page is not slowed, but the `chaos` row shows `measuring N%` for that long.
- The probe's 30 s / 6 million step limits end it as `inconclusive` if a system defeats it.
- The Pythagorean probe finishes in about 3 s, but only because the verdict is decisive at 6 T_char, before the binary stall (item 3 above) bites.
- The horizon is an order-of-magnitude statement, not a bound.

## Known limits of this pass

- The Lyapunov windows are short for the fast-chaotic presets (5–21 T) because of the 6 s wall budget, and finite-time estimates of regular orbits decay like ln t / t.
- The random-system run used a 250 ms budget per system, so some may not have reached 10 T_char.
- The 120-run state machine and 60-system random sets are samples, not exhaustive.

## Second pass: the remaining findings

A later pass re-read the code for every item above that was still open, wrote a failing test for each, and fixed it. Nothing here was left as "to be reproduced": each item below has a regression test (the UI-only ones, marked *manual*, were checked in the browser).

**Run control and state.**
- Return to start, direction flipped mid-return: the return is cancelled (`Controller.setDirection`), not reported as arrived.
- Back/Forward onto a run link already on screen no longer restarts the run (`RunLinks` in `urlState.ts`); a Learn "Try it" click still starts it fresh. There was no page reload: the `hashchange` handler restarted the run.
- Twin failure: a `twin-failed` warning, the pill reads Failed, Play is held, and the banner offers to stop the comparison.
- Divergence is not updated while the two runs are drawn at different times; Step gives the twin a 50 ms budget.
- A method switch starts a new run for the banner (dismissed warnings come back); a close-encounter pause says why; the return distance is cleared by a new run.
- T_char is kept through rotate, nudge, G and softening; an edit that changes the system's size by more than 2x reframes the camera.
- A same-method twin ends when the first run's method, step, tolerance or step limits change.
- A link that cannot be opened says so on the banner.

**Messages.**
- "Unbound" and "only just bound" are judged from the kinetic energy within the system (the drift of the whole is taken out), in the preflight check and in the preset suggestion.
- A failed step is blamed on a close approach only when two bodies were close; otherwise it says the numbers overflowed. A far body is no longer promised to be bound.

**Solver and inputs.**
- A maximum step below the minimum no longer pins every IAS15 step under the minimum; links and the sliders keep the two in order.
- **IAS15's stall on the Pythagorean problem (Physics and preset defects, item 3) is fixed**: the roundoff expected in the accelerations is taken off the error estimate, only when it is more than 5% of epsTol. Orbits near the origin step exactly as before (golden tests unchanged); t = 85 to 90 went from over 100,000 steps (capped) to a few thousand, with the energy error unchanged.
- `isFiniteState` no longer overflows on large finite values.

**Batch jobs and charts.**
- A Lyapunov job on a run that broke down says so instead of "no sign of chaos"; a sweep whose reference run fails says so; failed sweep runs are left out of the plots and counted.
- Batch jobs ride out min-step and encounter stops (`advanceThrough`) instead of taking an early state for the state at the target time.
- A stopped comparison, a failed run and an exact-zero first sample are gaps on the log charts (`forLogAxis`), not a perfect run at the 1e-18 floor.
- A batch or chaos worker that fails is replaced, so later jobs do not hang.
- "Continue" after a fast-forward is refused if the system changed since it began (`Controller.continueFrom`). A Cancel that arrives as a job finishes now cancels it (*manual*).
- The momentum error is relative to Σ m|v|.

**Page.**
- Off-screen arrows for a body past the far plane or inside the near plane point the right way (`arrowTarget`); orthographic cameras are not mirrored.
- A line at the top says the page is laid out for 1200 by 680 pixels when the window is smaller (*manual*); a failed Learn load says so and can be retried (*manual*).

**Still open.** The Šuvakov `stable` flags (item 5 of Physics and preset defects) need a Floquet/monodromy check, and instability of Euler-collinear and Lagrange below the Routh mass is untested. The newer IAS15 timestep criterion (Pham, Rein and Spiegel 2024) is not implemented; the noise floor above is the smaller change. The batch module's UI wiring (`data.ts`) has no automated test. The built-in browser pane's frame rate is still too low to time anything.
