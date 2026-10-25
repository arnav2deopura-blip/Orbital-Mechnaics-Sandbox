"""Golden data for the integrator tests (plan section 10, test 9): the same runs made with REBOUND.

REBOUND (Rein & Liu 2012) is GPL-3.0-or-later. It is used here only as an outside program that
produces numbers; none of its code is in this project, whose integrators are written from the
papers. Run it offline when the inputs change:

    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install rebound
    WRITE_GOLDEN_INPUTS=1 npx vitest run tests/golden/exportInputs.test.ts
    /tmp/venv/bin/python tools/reference/make_golden.py

Reads tests/golden/inputs.json, writes tests/golden/golden.json. Each run is a list of states
(x, y, z of the three bodies, then vx, vy, vz of the three) at the times asked for, and the
energy there.
"""

import json
import pathlib
import sys

import rebound

ROOT = pathlib.Path(__file__).resolve().parents[2]
inputs = json.loads((ROOT / "tests/golden/inputs.json").read_text())


def make(case, integrator):
    sim = rebound.Simulation()
    sim.G = case["G"]
    sim.integrator = integrator
    for i in range(3):
        x, v = case["x"][3 * i : 3 * i + 3], case["v"][3 * i : 3 * i + 3]
        sim.add(m=case["m"][i], x=x[0], y=x[1], z=x[2], vx=v[0], vy=v[1], vz=v[2])
    return sim


def state(sim):
    p = sim.particles
    return [c for q in p for c in (q.x, q.y, q.z)] + [c for q in p for c in (q.vx, q.vy, q.vz)]


def run_at_times(case, times):
    """IAS15, integrated exactly to each time."""
    sim = make(case, "ias15")
    out = {"times": times, "states": [], "energy": [sim.energy()]}
    for t in times:
        sim.integrate(t, exact_finish_time=1)
        out["states"].append(state(sim))
        out["energy"].append(sim.energy())
    return out


def run_fixed(case, integrator, dt, steps):
    """A fixed-step integrator: the state after each count of steps in `steps`."""
    sim = make(case, integrator)
    sim.dt = dt
    # WHFast's defaults are what the tests compare with: Jacobi coordinates, no correctors, and
    # synchronized states after every step.
    out = {"dt": dt, "steps": steps, "times": [], "states": [], "energy": [sim.energy()]}
    for n in steps:
        sim.integrate(n * dt, exact_finish_time=0)
        out["times"].append(sim.t)
        out["states"].append(state(sim))
        out["energy"].append(sim.energy())
    return out


golden = {"rebound": rebound.__version__, "cases": {}}
for name in ("figure-eight", "pythagorean"):
    golden["cases"][name] = {"ias15": run_at_times(inputs[name], inputs[name]["times"])}
for name in ("hierarchical", "kepler"):
    case = inputs[name]
    dt, steps = case["dt"], case["steps"]
    times = [n * dt for n in steps]
    golden["cases"][name] = {
        "ias15": run_at_times(case, times),
        "whfast": run_fixed(case, "whfast", dt, steps),
        "leapfrog": run_fixed(case, "leapfrog", dt, steps),
    }

(ROOT / "tests/golden/golden.json").write_text(json.dumps(golden, indent=1) + "\n")
print("wrote tests/golden/golden.json (REBOUND", rebound.__version__ + ")", file=sys.stderr)
