import type { FastForwardResult, FastForwardSpec, LyapunovResult, LyapunovSpec, SweepResult, SweepSpec } from '../sim/batch';

// The messages between the page and the batch worker (plan §9). Specs and results hold only
// numbers and Float64Arrays, so they cross by structured clone, and the arrays of a result are
// handed over rather than copied.

export type Job =
  | { kind: 'sweep'; spec: SweepSpec }
  | { kind: 'fastForward'; spec: FastForwardSpec }
  | { kind: 'lyapunov'; spec: LyapunovSpec };

export type JobResult = SweepResult | FastForwardResult | LyapunovResult;

export type ClientMessage = { type: 'run'; id: number; job: Job } | { type: 'cancel'; id: number };

export type HostMessage =
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'result'; id: number; result: JobResult }
  | { type: 'cancelled'; id: number }
  | { type: 'error'; id: number; message: string };
