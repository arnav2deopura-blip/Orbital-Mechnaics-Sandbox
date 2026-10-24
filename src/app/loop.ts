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

  private readonly sim: Simulation;
  private readonly clock: () => number;
  private tTarget: number;
  private revision: number;
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
   * Advances the simulation by dtSeconds of real time at the set speed (when running) within
   * the frame budget, and returns the state to draw. If the budget runs out, the backlog is
   * dropped rather than caught up later (plan §5), and stats.achieved says how far behind.
   * A failed integration, or an encounter the simulation was asked to stop at, pauses.
   */
  frame(dtSeconds: number): SystemState {
    const { sim, settings, stats } = this;
    if (sim.revision !== this.revision) {
      this.revision = sim.revision;
      this.tTarget = sim.state.t; // loaded, reset, or reversed: the old target means nothing now
    }

    if (settings.running && sim.failure === null) {
      const requested = dtSeconds * settings.speed;
      const start = this.tTarget;
      const steps0 = sim.counters.stepCount;
      const evals0 = sim.counters.forceEvals;
      const wall0 = this.clock();

      this.tTarget += sim.direction * requested;
      const result = sim.advanceTo(this.tTarget, wall0 + settings.budgetMs);
      if (result.status !== 'reached') this.tTarget = sim.state.t;
      if (result.status === 'failed' || result.status === 'event') settings.running = false;

      if (requested > 0) {
        const progress = Math.min(Math.max(((sim.state.t - start) * sim.direction) / requested, 0), 1);
        stats.achieved += ACHIEVED_SMOOTHING * ((result.status === 'budget' ? progress : 1) - stats.achieved);
      }
      this.windowSimMs += this.clock() - wall0;
      this.windowSteps += sim.counters.stepCount - steps0;
      this.windowEvals += sim.counters.forceEvals - evals0;
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
    return this.rendered;
  }

  /** Pauses and takes one step (plan §7.1). */
  stepOnce(): void {
    this.settings.running = false;
    this.sim.step();
    this.tTarget = this.sim.state.t;
  }
}
