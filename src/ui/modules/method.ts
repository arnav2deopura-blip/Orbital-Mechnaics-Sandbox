import type { Controller } from '../../app/controller';
import type { IntegratorId } from '../../sim/integrators/types';
import { cardFor } from '../infoCards';
import type { ModuleSpec } from '../shell';
import { el } from '../shell';
import { bodyOptions, INTEGRATOR_OPTIONS, learnLink, paneIn, prose, setTitle, subhead } from './common';

// The Method module (plan §7.1): which integrator, what it is (from the Learn page's own text),
// and the controls that apply to it. Controls for one method only are hidden for the rest.
// Also "Time & Events": direction, return to start and the encounter radius.

/** The menu's value for the current integrator: symplectic Euler is its own entry. */
export function integratorChoice(controller: Controller): string {
  const { integrator } = controller.sim;
  return integrator.id === 'euler' && integrator.symplectic ? 'symplectic-euler' : integrator.id;
}

export function chooseIntegrator(controller: Controller, choice: string): void {
  if (choice === integratorChoice(controller)) return;
  if (choice === 'symplectic-euler') controller.setIntegrator('euler', true);
  else controller.setIntegrator(choice as IntegratorId);
}

export function methodModule(controller: Controller): ModuleSpec {
  return {
    id: 'method',
    title: 'Method',
    summary: 'The integrator, what it does, and its step size and limits',
    shownByDefault: true,
    perBody: true,
    build(body) {
      const { sim } = controller;
      const pane = paneIn(body);
      const integrator = {
        get id(): string {
          return integratorChoice(controller);
        },
        set id(choice: string) {
          chooseIntegrator(controller, choice);
        },
      };
      pane.addBinding(integrator, 'id', { label: 'integrator', options: INTEGRATOR_OPTIONS });

      // Step size, as a power of ten of T_char: the slider's exponent, shown as "T_char / N".
      const stepSize = {
        get exponent(): number {
          return Math.log10(sim.params.dt / sim.reference.period);
        },
        set exponent(exponent: number) {
          if (Math.abs(exponent - this.exponent) > 1e-9) controller.setDt(10 ** exponent * sim.reference.period);
        },
      };
      setTitle(
        pane.addBinding(stepSize, 'exponent', { label: 'step size', min: -5.5, max: -0.5, format: (exponent: number) => `T/${Math.round(10 ** -exponent)}` }),
        'Step size as a fraction of T_char, the shortest orbital period. For IAS15 this is only the first guess.',
      );

      const central = {
        get body(): number {
          return sim.params.centralBody ?? -1;
        },
        set body(value: number) {
          if (value !== this.body) controller.setCentralBody(value < 0 ? undefined : (value as 0 | 1 | 2));
        },
      };
      const centralBinding = pane.addBinding(central, 'body', { label: 'central body', options: { 'Most massive': -1, ...bodyOptions(sim.state.n) } });
      setTitle(centralBinding, 'Wisdom-Holman: the body the others orbit. For a star, planet and moon use the planet.');

      // IAS15's limits, as exponents of ten; the end of each slider means "no limit".
      const ias = sim.params;
      const tolerance = {
        get exp(): number {
          return Math.log10(ias.epsTol ?? 1e-9);
        },
        set exp(value: number) {
          if (value !== this.exp) ias.epsTol = 10 ** value;
        },
      };
      const tolBinding = pane.addBinding(tolerance, 'exp', { label: 'tolerance', min: -12, max: -4, step: 0.1, format: (value: number) => `1e${value.toFixed(1)}` });
      setTitle(tolBinding, 'IAS15: the size of the last term of its polynomial, relative to the acceleration. Smaller is more accurate.');
      const limit = (key: 'dtMin' | 'dtMax', off: number) => ({
        get exp(): number {
          const value = ias[key];
          return value === undefined ? off : Math.log10(value / sim.reference.period);
        },
        set exp(value: number) {
          if (value !== this.exp) ias[key] = value === off ? undefined : 10 ** value * sim.reference.period;
        },
      });
      const dtMinBinding = pane.addBinding(limit('dtMin', -12), 'exp', {
        label: 'min step',
        min: -12,
        max: -3,
        step: 0.1,
        format: (value: number) => (value === -12 ? 'off' : `T x 1e${value.toFixed(1)}`),
      });
      const dtMaxBinding = pane.addBinding(limit('dtMax', 1), 'exp', {
        label: 'max step',
        min: -4,
        max: 1,
        step: 0.1,
        format: (value: number) => (value === 1 ? 'off' : `T x 1e${value.toFixed(1)}`),
      });
      setTitle(dtMinBinding, 'IAS15: the smallest step it may take, in units of T_char. Hitting it is reported as an unresolved encounter.');
      setTitle(dtMaxBinding, 'IAS15: the largest step it may take, in units of T_char.');

      const pairNote = prose(
        body,
        'With two bodies Wisdom-Holman is exact: the orbit is the very Kepler motion it drifts along, so the step only decides how often it stops to look.',
        'module-meta',
      );

      // What the chosen method is, from the same text as the Learn page.
      subhead(body, 'About this method');
      const idea = prose(body);
      const more = el('details', 'module-details');
      const summary = el('summary');
      summary.textContent = 'Strengths, cost and when to use it';
      const strengths = prose(more);
      const cost = prose(more);
      const use = prose(more);
      more.prepend(summary);
      body.appendChild(more);
      const learn = learnLink(body, 'Learn about this method →');
      let shownCard = '';

      return () => {
        const id = sim.integrator.id;
        centralBinding.hidden = id !== 'wh';
        pairNote.hidden = id !== 'wh' || sim.state.n !== 2;
        for (const binding of [tolBinding, dtMinBinding, dtMaxBinding]) binding.hidden = id !== 'ias15';
        const choice = integratorChoice(controller);
        if (choice !== shownCard) {
          shownCard = choice;
          const card = cardFor(choice);
          idea.textContent = card ? `${card.idea} ${card.analogy}` : '';
          strengths.textContent = card ? `Strengths and weaknesses: ${card.strengths}` : '';
          cost.textContent = card ? `Cost: ${card.cost}` : '';
          use.textContent = card ? `Use it for: ${card.use}` : '';
          learn.href = card?.learnHref ?? 'learn.html';
          learn.textContent = card ? `Learn about ${card.title} →` : 'Learn about the methods →';
        }
        pane.refresh();
      };
    },
  };
}

export function timeModule(controller: Controller): ModuleSpec {
  return {
    id: 'time',
    title: 'Time & Events',
    summary: 'Run backward, return to the start, and stop at close encounters',
    shownByDefault: false,
    build(body) {
      const { sim } = controller;
      const pane = paneIn(body);
      const direction = {
        get dir(): number {
          return sim.direction;
        },
        set dir(sign: number) {
          if (sign !== this.dir) controller.setDirection(sign < 0 ? -1 : 1);
        },
      };
      pane.addBinding(direction, 'dir', { label: 'direction', options: { Forward: 1, Backward: -1 } });
      const back = pane.addButton({ title: 'Return to start' });
      back.on('click', () => controller.returnToStart());
      setTitle(back, 'Runs backward to where it began and reports how far the state is from the start. Leapfrog and Wisdom-Holman retrace to roundoff; Euler does not.');
      setTitle(
        pane.addBinding(controller.readout, 'returnDistance', {
          label: 'return dist.',
          readonly: true,
          format: (value: number) => (Number.isFinite(value) ? value.toExponential(2) : '-'),
        }),
        'After "Return to start": the phase-space distance from the initial state.',
      );

      const encounter = { radius: 0, stop: false };
      const apply = (): void => controller.setEncounter(encounter.radius, encounter.stop);
      setTitle(
        pane.addBinding(encounter, 'radius', { label: 'encounter dist.', min: 0, step: 0.001 }).on('change', apply),
        'Note when two bodies come closer than this (0 is off). Bodies never merge: this is also the collision radius.',
      );
      pane.addBinding(encounter, 'stop', { label: 'pause there' }).on('change', apply);
      learnLink(body, 'Learn about time reversal →', 'time-reversal');
      return () => {
        // A new preset clears the encounter radius; show what is in force.
        encounter.radius = sim.encounterRadius;
        encounter.stop = sim.stopOnEncounter;
        pane.refresh();
      };
    },
  };
}
