import { createDiagnostics, measure, systemSize } from '../sim/diagnostics';
import type { IntegratorId } from '../sim/integrators/types';
import type { SystemState } from '../sim/types';

// Run health: plain-language warnings about a system that is about to go wrong (checked on the
// starting state, before it runs) or has gone wrong (checked while it runs), each with the fixes
// worth offering. Pure: the Controller gathers the inputs and applies the fixes.

export type Severity = 'info' | 'warning' | 'danger';

/**
 * What a warning can offer to do. 'bind' slows the bodies until the system is bound; 'suggested'
 * loads the preset closest to the user's values; 'defaults' reloads the preset's own values; 'twin'
 * starts a ghost twin, which makes chaos visible; 'stop-twin' ends a comparison whose twin failed.
 */
export type Fix = 'bind' | 'ias15' | 'smaller-step' | 'reset' | 'frame' | 'suggested' | 'defaults' | 'twin' | 'stop-twin';

export interface Issue {
  /** Stable per kind (and body), so a dismissed warning stays dismissed while it lasts. */
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** The Learn page section that explains it. */
  learn?: string;
  fixes: Fix[];
  /** Pause the run the first time this appears. */
  pause?: boolean;
}

const RANK: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };

/** Most severe first; the order within a severity is kept. */
export function bySeverity(issues: Issue[]): Issue[] {
  return issues.map((issue, i) => [issue, i] as const).sort((a, b) => RANK[a[0].severity] - RANK[b[0].severity] || a[1] - b[1]).map(([issue]) => issue);
}

/** A fixed-step method takes fewer steps than this per T_char: too coarse to follow the orbit. */
export const MIN_STEPS_PER_PERIOD = 20;
/** Bodies start closer than this fraction of the system's size... */
const CLOSE_START = 0.01;
/** ...with less than this fraction of a circular orbit's angular momentum: they fall into each other, not around. */
const PLUNGING = 0.3;
/** Kinetic over |potential| above this, though still bound: likely to throw a body out. */
const LOOSE = 0.75;

export interface PreflightInput {
  /** The starting state. */
  state: SystemState;
  integrator: IntegratorId;
  dt: number;
  /** T_char. */
  period: number;
  /** The preset is unbound on purpose (a flyby): not worth a warning. */
  expectUnbound?: boolean;
}

/** What is wrong with a system before it runs: unbound, bodies on top of each other, a step too big for it. */
export function preflight({ state, integrator, dt, period, expectUnbound = false }: PreflightInput): Issue[] {
  const issues: Issue[] = [];
  const d = createDiagnostics();
  measure(state, d);
  const massive = [...state.m].filter((m) => m > 0).length;
  const size = systemSize(state);

  if (expectUnbound) {
    // The preset is a flyby: being unbound is its point.
  } else if (massive >= 2 && d.energy >= 0) {
    issues.push({
      id: 'unbound',
      severity: 'warning',
      title: 'This system is not bound',
      detail:
        `Its total energy is positive: the bodies move too fast (kinetic ${d.kinetic.toPrecision(3)}) for their gravity ` +
        `(potential ${d.potential.toPrecision(3)}) to hold them. At least one will fly off and never come back. That is real physics, not a bug.`,
      learn: 'stability',
      fixes: ['bind', 'suggested'],
    });
  } else if (massive >= 2 && d.kinetic > LOOSE * -d.potential) {
    issues.push({
      id: 'loosely-bound',
      severity: 'info',
      title: 'Only just bound',
      detail: 'The bodies are moving nearly fast enough to escape. Expect one to be thrown out after a few close passes.',
      learn: 'stability',
      fixes: ['bind'],
    });
  }

  if (plungingPair(state, CLOSE_START * size)) {
    issues.push({
      id: 'close-start',
      severity: 'warning',
      title: 'Two bodies start almost on top of each other',
      detail:
        `They are ${d.minSeparation.toPrecision(2)} apart in a system ${size.toPrecision(2)} across, and not moving around each other, ` +
        'so they fall straight together. The pull at that distance is enormous: a fixed step will likely blow up.',
      learn: 'ias15',
      fixes: integrator === 'ias15' ? ['suggested'] : ['ias15', 'suggested'],
    });
  }

  const stepsPerPeriod = period / Math.abs(dt);
  if (integrator !== 'ias15' && stepsPerPeriod < MIN_STEPS_PER_PERIOD) {
    issues.push({
      id: 'coarse-step',
      severity: 'warning',
      title: 'The step is too big for this system',
      detail:
        `It takes only ${Math.max(stepsPerPeriod, 0).toFixed(1)} steps per orbit of the closest pair (fewer than ${MIN_STEPS_PER_PERIOD}). ` +
        'The orbit will come out wrong, or blow up at the first close pass.',
      learn: 'error-order-cost',
      fixes: ['smaller-step', 'ias15'],
    });
  }
  return issues;
}

/**
 * Whether two bodies with mass start within `radius` of each other without the sideways speed to
 * orbit: their angular momentum about each other is under PLUNGING of a circular orbit's. A close
 * pair that does orbit (a planet and its moon) is a binary, and fine.
 */
function plungingPair(s: SystemState, radius: number): boolean {
  for (let i = 0; i < s.n; i++) {
    for (let j = i + 1; j < s.n; j++) {
      const mu = s.G * (s.m[i] + s.m[j]);
      if (!(mu > 0)) continue;
      const r = [0, 1, 2].map((c) => s.x[3 * j + c] - s.x[3 * i + c]);
      const v = [0, 1, 2].map((c) => s.v[3 * j + c] - s.v[3 * i + c]);
      const distance = Math.hypot(r[0], r[1], r[2]);
      if (!(distance < radius)) continue;
      const h = Math.hypot(r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]);
      if (h < PLUNGING * Math.sqrt(mu * distance)) return true;
    }
  }
  return false;
}

/** Energy error above this, with a method that should keep it small: the run no longer follows gravity. */
export const BLOWUP_ENERGY = 0.1;
/** Energy error above this deserves a word. */
export const DRIFT_ENERGY = 1e-2;
/** A body this many times the starting size from the center of mass is reported as far away. */
export const FAR_SIZES = 10;

/** What the chaos probe found, when it found chaos (sim/chaos.ts). Times are in T_char. */
export interface ChaosInput {
  state: 'chaotic' | 'very-chaotic';
  /** How many periods it takes two nearby runs to separate by a factor of e. */
  lyapunovPeriods: number;
  /** How long the path can be trusted, and how long the run has gone, both since the start. */
  horizonPeriods: number;
  elapsedPeriods: number;
}

export interface RuntimeInput {
  integrator: IntegratorId;
  /** Explicit Euler, whose failure is the lesson. */
  explicitEuler: boolean;
  failure: string | null;
  /** Why the comparison twin failed, when it has (the first run is fine). */
  twinFailure?: string | null;
  /** Why the run paused itself, while it is paused: a close encounter it was asked to stop at, or an integrator event. */
  stopped?: string | null;
  warning: string | null;
  energyError: number;
  /** Per body (two or three): unbound and beyond the escape radius. */
  escaped: boolean[];
  /** Per body: farther than FAR_SIZES starting sizes from the center of mass. */
  far: boolean[];
  /** The user changed the system (or the preset's sliders), so another preset may suit them better. */
  custom: boolean;
  /** Set once the chaos probe has found the run chaotic. */
  chaos?: ChaosInput | null;
}

/** What has gone wrong while running. */
export function runtimeIssues(input: RuntimeInput): Issue[] {
  const issues: Issue[] = [];
  const { integrator, failure, energyError } = input;
  const away: Fix[] = input.custom ? ['suggested', 'defaults'] : [];
  const better: Fix[] = integrator === 'ias15' ? ['reset'] : ['ias15', 'smaller-step', 'reset'];

  if (failure !== null) {
    issues.push({
      id: 'failed',
      severity: 'danger',
      title: 'The integration broke down',
      detail:
        `${capitalize(failure)}. Two bodies came so close that one step sent the numbers to infinity. ` +
        'The run is paused at the last good state.',
      learn: 'ias15',
      fixes: [...better, ...away],
    });
  } else if (energyError > BLOWUP_ENERGY) {
    const percent = energyError >= 10 ? `${energyError.toExponential(0)} times` : `${Math.round(100 * energyError)}%`;
    issues.push(
      input.explicitEuler
        ? {
            id: 'energy-blowup',
            severity: 'warning',
            title: "Euler's energy has run away",
            detail: `Energy is off by ${percent}. This is the failure Euler is here to show: it gains energy every step and the orbit spirals out.`,
            learn: 'euler',
            fixes: ['smaller-step', 'reset'],
          }
        : {
            id: 'energy-blowup',
            severity: 'danger',
            title: 'The simulation has gone wrong',
            detail:
              `Energy is off by ${percent}. Real gravity keeps energy constant, so what is on screen no longer follows it, ` +
              'usually because a close pass was taken in too few steps.',
            learn: 'conservation-laws',
            fixes: [...better, ...away],
            pause: true,
          },
    );
  } else if (energyError > DRIFT_ENERGY && !input.explicitEuler) {
    issues.push({
      id: 'energy-drift',
      severity: 'warning',
      title: 'The energy error is getting large',
      detail: `Energy is off by ${(100 * energyError).toPrecision(2)}%. The run is still going, but its details are no longer reliable.`,
      learn: 'conservation-laws',
      fixes: integrator === 'ias15' ? ['reset'] : ['ias15', 'smaller-step'],
    });
  }

  if (input.twinFailure && failure === null) {
    issues.push({
      id: 'twin-failed',
      severity: 'warning',
      title: 'The comparison twin broke down',
      detail:
        `${capitalize(input.twinFailure)}. The run is held while a comparison is open, because the two would no longer be at the same time. ` +
        'Stop the comparison to carry on with the first run.',
      learn: 'chaos',
      fixes: ['stop-twin'],
    });
  }

  if (input.stopped && failure === null) {
    const encounter = input.stopped.startsWith('close encounter');
    issues.push({
      id: encounter ? 'encounter' : 'stopped',
      severity: 'info',
      title: encounter ? 'Paused at a close encounter' : 'The run stopped itself',
      detail: `${capitalize(input.stopped)}. The run paused here, as it was set to. Press Play to go on.`,
      fixes: [],
    });
  }

  if (input.warning !== null && failure === null) {
    issues.push({
      id: 'integrator-warning',
      severity: 'warning',
      title: 'The integrator is struggling',
      detail: `${capitalize(input.warning)}.`,
      learn: integrator === 'wh' ? 'wisdom-holman' : 'ias15',
      // IAS15 is already the best tool here: restarting the same system will struggle the same way.
      fixes: integrator === 'ias15' ? [...away, 'reset'] : ['ias15', 'reset'],
    });
  }

  if (input.chaos) issues.push(...chaosIssues(input.chaos));

  for (let k = 0; k < input.escaped.length; k++) {
    if (input.escaped[k] && input.escaped.length === 2) {
      // Both bodies of a pair escape together: say it once.
      if (k === 0) {
        issues.push({
          id: 'escaped-pair',
          severity: 'info',
          title: 'The two bodies are leaving each other',
          detail: 'They are moving apart fast enough that gravity can never pull them back: a hyperbolic flyby, the one two-body motion that does not repeat.',
          learn: 'three-body-problem',
          fixes: ['frame', 'reset', ...(input.custom ? (['suggested'] as Fix[]) : [])],
        });
      }
    } else if (input.escaped[k]) {
      issues.push({
        id: `escaped-${k}`,
        severity: 'info',
        title: `Body ${k + 1} has escaped`,
        detail:
          'It is moving away fast enough that the other two can never pull it back. This is how most three-body systems end: ' +
          'one body thrown out, a tighter pair left behind.',
        learn: 'chaos',
        fixes: ['frame', 'reset', ...(input.custom ? (['suggested'] as Fix[]) : [])],
      });
    } else if (input.far[k]) {
      issues.push({
        id: `far-${k}`,
        severity: 'info',
        title: `Body ${k + 1} is far from the others`,
        detail: `It is more than ${FAR_SIZES} times the starting size of the system away, so it may be off screen. It is still bound, so it may come back.`,
        fixes: ['frame'],
      });
    }
  }
  return issues;
}

/** A count of periods in words: one decimal below ten, whole above. */
function periods(n: number): string {
  if (!(n > 0)) return 'no';
  return n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n));
}

/**
 * The warnings for a run the probe found chaotic: what it means and for how long the picture can be
 * trusted (the predictability horizon), and a second one once the run has gone past that.
 */
function chaosIssues({ state, lyapunovPeriods, horizonPeriods, elapsedPeriods }: ChaosInput): Issue[] {
  const very = state === 'very-chaotic';
  const issues: Issue[] = [
    {
      id: 'chaotic',
      severity: very ? 'warning' : 'info',
      title: very ? 'This run is extremely chaotic' : 'This run is chaotic',
      detail:
        `Two copies that start a hundred-millionth of the system's size apart pull away from each other by a factor of e about every ${periods(lyapunovPeriods)} orbits` +
        `${very ? ', which is very fast' : ''}. What you see is a real solution, but a tiny difference, even rounding, gives a different one, ` +
        `so it can be trusted for only about ${periods(horizonPeriods)} orbits. Energy staying constant does not mean the path is right. This is how three bodies behave, not a bug.`,
      learn: 'chaos',
      fixes: ['twin'],
    },
  ];
  if (elapsedPeriods > horizonPeriods) {
    issues.push({
      id: 'chaos-horizon',
      severity: 'warning',
      title: 'Past the point where this path can be trusted',
      detail:
        `The run has gone about ${periods(elapsedPeriods)} orbits, longer than the roughly ${periods(horizonPeriods)} it can be followed reliably. ` +
        'From here on it is one possible path out of many that a tiny difference would give, and it is still a valid example of the motion.',
      learn: 'chaos',
      fixes: ['twin'],
    });
  }
  return issues;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
