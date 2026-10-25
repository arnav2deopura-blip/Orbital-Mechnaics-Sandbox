import type { Simulation } from '../sim/simulation';
import { createState } from '../sim/state';
import type { SystemState } from '../sim/types';

// The per-frame logic of plan §5: a time target that advances with the wall clock, a hard
// compute budget per frame, and an interpolated state to draw. The requestAnimationFrame
// loop itself belongs to SceneView, which calls frame() with the elapsed seconds.

/** How fast the achieved-speed estimate follows: its weight on each new frame. */
const ACHIEVED_SMOOTHING = 0.1;
/** The perf counters are averaged over windows of this many seconds. */
const STATS_WINDOW = 0.25;
/** How fast the measured cost of each simulation follows, and the least share of the budget either gets. */
const COST_SMOOTHING = 0.1;
const MIN_SHARE = 0.15;
const MIN_BUDGET_MS = 2;
/** The share of a frame's interval that stepping and drawing together may use. */
const FRAME_USE = 0.9;
/** How much each way advanceTo() can end matters: a failure over an event over running out of budget. */
const SEVERITY = { reached: 0, budget: 1, event: 2, failed: 3 } as const;

export interface LoopSettings {
  running: boolean;
  /** Sim time units per real second. The direction comes from the Simulation. */
  speed: number;
  /** Most wall time a frame may spend stepping. The plan's default is ~8 ms. */
  budgetMs: number;
}

export class SimLoop {
  readonly settings: LoopSettings;
  /** Updated about four times a second. achieved is the fraction of the requested speed delivered, 1 when keeping up. */
  readonly stats = { simMs: 0, stepsPerSec: 0, forceEvalsPerSec: 0, achieved: 1 };
  /** What frame() returns: the interpolated state to draw. */
  readonly rendered = createState();
  /**
   * The comparison twin (plan §7.4), advanced to the same time target and drawn from
   * `renderedTwin`. The frame budget is split between the two in proportion to what each has been costing.
   */
  twin: Simulation | null = null;
  readonly renderedTwin = createState();
  /**
   * Milliseconds the last frame spent drawing, when known. With it the budget adapts (plan §5): a
   * frame has about 90% of its interval, less the drawing, to spend stepping, and never more than
   * settings.budgetMs nor less than 2 ms. Without it the budget is settings.budgetMs.
   */
  renderMs: (() => number) | null = null;
  /**
   * Time the run must not pass, or null. Reaching it pauses and calls onStop. The caller sets it
   * half a step beyond the time it really wants, so a fixed-step run that lands on it by
   * arithmetic does not take one more step over roundoff.
   */
  stopAt: number | null = null;
  onStop: (() => void) | null = null;

  private readonly sim: Simulation;
  private readonly clock: () => number;
  private tTarget: number;
  private revision: number;
  /** Smoothed wall time per frame spent in each simulation, for splitting the budget. */
  private costMain = 1;
  private costTwin = 1;
  private windowSeconds = 0;
  private windowSimMs = 0;
  private windowFrames = 0;
  private windowSteps = 0;
  private windowEvals = 0;

  constructor(sim: Simulation, settings: Partial<LoopSettings> = {}, clock: () => number = () => performance.now()) {
    this.sim = sim;
    this.clock = clock;
    this.settings = { running: true, speed: 1, budgetMs: 8, ...settings };
    this.tTarget = sim.state.t;
    this.revision = sim.revision;
  }

  /**
   * Advances the simulation (and the twin) by dtSeconds of real time at the set speed (when
   * running) within the frame budget, and returns the state to draw. If the budget runs out,
   * the backlog is dropped rather than caught up later (plan §5): the target falls back to the
   * time of whichever simulation is furthest behind, and stats.achieved says how far. A failed
   * integration, or an encounter the simulation was asked to stop at, pauses.
   */
  frame(dtSeconds: number): SystemState {
    const { sim, settings, stats } = this;
    const twin = this.twin;
    if (sim.revision !== this.revision) {
      this.revision = sim.revision;
      this.tTarget = sim.state.t; // loaded, reset, or reversed: the old target means nothing now
    }

    if (settings.running && sim.failure === null && (twin === null || twin.failure === null)) {
      const requested = dtSeconds * settings.speed;
      const dir = sim.direction;
      const start = this.tTarget;
      const steps0 = sim.counters.stepCount;
      const evals0 = sim.counters.forceEvals;
      const wall0 = this.clock();

      this.tTarget += dir * requested;
      const stopping = this.stopAt !== null && (this.tTarget - this.stopAt) * dir >= 0;
      if (stopping) this.tTarget = this.stopAt as number;

      const budget = this.renderMs
        ? Math.min(settings.budgetMs, Math.max(MIN_BUDGET_MS, FRAME_USE * 1000 * dtSeconds - this.renderMs()))
        : settings.budgetMs;
      const share = twin === null ? 1 : Math.min(Math.max(this.costMain / (this.costMain + this.costTwin), MIN_SHARE), 1 - MIN_SHARE);
      let status = sim.advanceTo(this.tTarget, wall0 + budget * share).status;
      let reached = sim.state.t;
      if (twin !== null) {
        const mid = this.clock();
        const twinStatus = twin.advanceTo(this.tTarget, wall0 + budget).status;
        const end = this.clock();
        this.costMain += COST_SMOOTHING * (mid - wall0 - this.costMain);
        this.costTwin += COST_SMOOTHING * (end - mid - this.costTwin);
        reached = dir > 0 ? Math.min(reached, twin.state.t) : Math.max(reached, twin.state.t);
        if (SEVERITY[twinStatus] > SEVERITY[status]) status = twinStatus; // the worse outcome of the two decides
      }
      if (status !== 'reached') this.tTarget = reached;
      if (status === 'failed' || status === 'event') settings.running = false;

      if (requested > 0) {
        const progress = Math.min(Math.max(((reached - start) * dir) / requested, 0), 1);
        stats.achieved += ACHIEVED_SMOOTHING * ((status === 'budget' ? progress : 1) - stats.achieved);
      }
      this.windowSimMs += this.clock() - wall0;
      this.windowSteps += sim.counters.stepCount - steps0;
      this.windowEvals += sim.counters.forceEvals - evals0;

      if (stopping && status === 'reached') {
        settings.running = false;
        this.stopAt = null;
        this.onStop?.();
      }
    }

    this.windowFrames++;
    this.windowSeconds += dtSeconds;
    if (this.windowSeconds >= STATS_WINDOW) {
      stats.simMs = this.windowSimMs / this.windowFrames;
      stats.stepsPerSec = this.windowSteps / this.windowSeconds;
      stats.forceEvalsPerSec = this.windowEvals / this.windowSeconds;
      this.windowSeconds = this.windowSimMs = this.windowSteps = this.windowEvals = this.windowFrames = 0;
    }

    sim.stateAt(this.tTarget, this.rendered);
    twin?.stateAt(this.tTarget, this.renderedTwin);
    return this.rendered;
  }

  /** Pauses and takes one step (plan §7.1); the twin runs on to the same time. */
  stepOnce(): void {
    this.settings.running = false;
    this.sim.step();
    this.twin?.advanceTo(this.sim.state.t, Infinity);
    this.tTarget = this.sim.state.t;
  }
}
