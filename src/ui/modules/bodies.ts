import type { Controller } from '../../app/controller';
import { equalizedDt } from '../../app/comparison';
import { createIntegrator } from '../../sim/integrators';
import type { IntegratorId } from '../../sim/integrators/types';
import type { Axis, NudgeDirection } from '../../sim/transforms';
import type { ModuleSpec } from '../shell';
import { bodyOptions, INTEGRATOR_OPTIONS, learnLink, NUDGE_DIRECTIONS, paneIn, prose, REFRESH_MS, setTitle } from './common';

// The modules that change the system: the body editor and physics (plan §7.1), the nudge for
// chaos (plan §7.2), and comparison runs (plan §7.4).

export function bodiesModule(controller: Controller): ModuleSpec {
  return {
    id: 'bodies',
    group: 'system',
    title: 'Bodies & Physics',
    summary: 'Edit each mass, position and velocity, tilt the system, G and softening',
    shownByDefault: false,
    perBody: true,
    build(body) {
      const { sim } = controller;
      prose(body, 'Change the numbers, then Apply. The run pauses and every error restarts from the new state. If the values make a system that cannot hold together, a warning says so and offers a fix.');
      const pane = paneIn(body);
      controller.draft.slice(0, sim.state.n).forEach((draft, i) => {
        const sub = pane.addFolder({ title: `Body ${i + 1}`, expanded: i === 0 });
        sub.addBinding(draft, 'm', { label: 'mass', min: 0, step: 0.001 });
        const axes = { x: { step: 0.01 }, y: { step: 0.01 }, z: { step: 0.01 } };
        sub.addBinding(draft, 'pos', { label: 'position', ...axes });
        sub.addBinding(draft, 'vel', { label: 'velocity', ...axes });
      });

      const options = { recenter: true };
      setTitle(
        pane.addBinding(options, 'recenter', { label: 're-center COM' }),
        'Shift everything so the center of mass is at the origin and at rest. The total momentum is then zero.',
      );
      const apply = pane.addButton({ title: 'Apply edits' });
      apply.on('click', () => controller.applyDraft(options.recenter));
      setTitle(apply, 'Pauses, applies the values above, restarts the energy and angular momentum references, and clears the trails.');
      pane.addButton({ title: 'Read current state' }).on('click', () => controller.readDraft());

      const turn = { axis: 'x', degrees: 30 };
      const rotate = pane.addFolder({ title: 'Tilt the whole system', expanded: false });
      rotate.addBinding(turn, 'axis', { label: 'about axis', options: { x: 'x', y: 'y', z: 'z' } });
      rotate.addBinding(turn, 'degrees', { label: 'angle (deg)', min: -180, max: 180, step: 1 });
      rotate.addButton({ title: 'Rotate' }).on('click', () => controller.rotate(turn.axis as Axis, turn.degrees));

      const physics = pane.addFolder({ title: 'Physics', expanded: false });
      const constants = {
        get G(): number {
          return sim.state.G;
        },
        set G(value: number) {
          if (value > 0 && value !== sim.state.G) controller.setG(value);
        },
        get softening(): number {
          return Math.sqrt(sim.state.eps2);
        },
        set softening(value: number) {
          if (value >= 0 && value !== this.softening) controller.setSoftening(value);
        },
      };
      setTitle(physics.addBinding(constants, 'G', { label: 'G', step: 0.01 }), 'Changing G changes the energy, so the energy and angular momentum errors restart from here.');
      const softening = physics.addBinding(constants, 'softening', { label: 'softening', min: 0, step: 0.001 });
      setTitle(softening, 'Plummer softening length: r^2 becomes r^2 + e^2 in the force. Wisdom-Holman has none.');
      learnLink(body, 'Learn about units and G →', 'units-and-g');

      return () => {
        softening.disabled = sim.integrator.id === 'wh';
        pane.refresh();
      };
    },
  };
}

export function perturbModule(controller: Controller): ModuleSpec {
  return {
    id: 'perturb',
    group: 'system',
    title: 'Perturb (chaos)',
    summary: 'Nudge one body by a tiny amount and watch what it changes',
    shownByDefault: false,
    perBody: true,
    build(body) {
      const pane = paneIn(body);
      const options = bodyOptions(controller.sim.state.n);
      const spec = { body: controller.sim.state.n - 1, target: 'velocity', direction: 'normal', exponent: -6, recenter: false };
      pane.addBinding(spec, 'body', { label: 'body', options });
      pane.addBinding(spec, 'target', { label: 'nudge its', options: { velocity: 'velocity', position: 'position' } });
      setTitle(pane.addBinding(spec, 'direction', { label: 'direction', options: NUDGE_DIRECTIONS }), 'Out of plane is along the angular momentum: it takes a planar system into 3D.');
      setTitle(
        pane.addBinding(spec, 'exponent', { label: 'size', min: -12, max: -2, step: 0.1, format: (value: number) => (10 ** value).toExponential(0) }),
        'As a fraction of the size of the system (position) or its typical speed (velocity).',
      );
      pane.addBinding(spec, 'recenter', { label: 're-center COM' });
      const nudge = pane.addButton({ title: 'Nudge' });
      nudge.on('click', () =>
        controller.nudge({ body: spec.body, target: spec.target as 'position' | 'velocity', direction: spec.direction as NudgeDirection, size: 10 ** spec.exponent }, spec.recenter),
      );
      setTitle(nudge, 'Restarts the energy and angular momentum references from the nudged state.');
      learnLink(body, 'Learn about chaos →', 'chaos');
      return () => pane.refresh();
    },
  };
}

export function compareModule(controller: Controller): ModuleSpec {
  return {
    id: 'compare',
    group: 'analysis',
    title: 'Compare',
    summary: 'Run a nudged twin, or a second method, on top of this one',
    shownByDefault: false,
    perBody: true,
    build(body) {
      const { sim } = controller;
      const pane = paneIn(body);
      const options = bodyOptions(sim.state.n);
      const setup = { kind: 'twin', body: sim.state.n - 1, target: 'position', direction: 'normal', exponent: -9, integrator: 'rk4', dtExponent: -3, equalize: true, message: '' };

      setTitle(
        pane.addBinding(setup, 'kind', { label: 'compare', options: { 'Ghost twin (nudged)': 'twin', 'Another method': 'method' } }),
        'A twin is the same method with a tiny nudge to one body: in a chaotic system it separates exponentially. Another method runs a different integrator on the identical start.',
      );
      const twinBindings = [
        pane.addBinding(setup, 'body', { label: 'nudge body', options }),
        pane.addBinding(setup, 'target', { label: 'nudge its', options: { position: 'position', velocity: 'velocity' } }),
        pane.addBinding(setup, 'direction', { label: 'direction', options: NUDGE_DIRECTIONS }),
        pane.addBinding(setup, 'exponent', { label: 'size', min: -14, max: -2, step: 0.1, format: (value: number) => (10 ** value).toExponential(0) }),
      ];
      const methodBindings = [
        pane.addBinding(setup, 'integrator', { label: 'other method', options: INTEGRATOR_OPTIONS }),
        pane.addBinding(setup, 'equalize', { label: 'equalize cost' }),
        pane.addBinding(setup, 'dtExponent', { label: 'its step', min: -5.5, max: -0.5, format: (exponent: number) => `T/${Math.round(10 ** -exponent)}` }),
      ];
      setTitle(
        methodBindings[1],
        'Choose its step so it makes as many force evaluations per unit time as the first run: RK4 takes 4 per step, so it gets 4 times the step. Without this RK4 looks unfairly good. Not for IAS15.',
      );

      pane.addButton({ title: 'Start comparison' }).on('click', () => {
        const symplectic = setup.integrator === 'symplectic-euler';
        const id = (symplectic ? 'euler' : setup.integrator) as IntegratorId;
        let dt = 10 ** setup.dtExponent * sim.reference.period;
        if (setup.equalize) dt = equalizedDt(sim.params.dt, sim.integrator, createIntegrator(id, symplectic)) ?? dt;
        const error = controller.startComparison(
          setup.kind === 'twin'
            ? { kind: 'twin', nudge: { body: setup.body, target: setup.target as 'position' | 'velocity', direction: setup.direction as NudgeDirection, size: 10 ** setup.exponent } }
            : { kind: 'method', integrator: id, symplecticEuler: symplectic, dt },
        );
        setup.message = error ?? '';
      });
      pane.addButton({ title: 'Stop comparison' }).on('click', () => controller.stopComparison());
      pane.addBinding(setup, 'message', { label: '', readonly: true, interval: REFRESH_MS });
      setTitle(
        pane.addBinding(controller.readout, 'divergence', {
          label: 'divergence',
          readonly: true,
          format: (value: number) => (Number.isFinite(value) ? value.toExponential(2) : '-'),
        }),
        'The largest distance between a body and its twin.',
      );
      prose(body, 'The twin is drawn as faint ghost bodies. Turn on the divergence chart in the charts drawer to see the gap grow.', 'module-meta');

      return () => {
        for (const binding of twinBindings) binding.hidden = setup.kind !== 'twin';
        for (const binding of methodBindings) binding.hidden = setup.kind !== 'method';
        methodBindings[2].hidden = setup.kind !== 'method' || setup.equalize;
        pane.refresh();
      };
    },
  };
}
