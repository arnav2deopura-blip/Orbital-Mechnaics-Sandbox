import { Cancelled } from '../sim/batch';
import type { ChaosSpec, ChaosVerdict } from '../sim/chaos';
import type { FastForwardResult, FastForwardSpec, LyapunovResult, LyapunovSpec, SweepResult, SweepSpec } from '../sim/batch';
import type { ClientMessage, HostMessage, Job, JobResult } from '../worker/protocol';

// The page's side of the batch worker (plan §9): start a job, hear its progress, get its result,
// or cancel it. One job at a time is the intended use, but any number can be in flight.

/** What the client needs of a Worker. A real Worker satisfies it, and so does a test double. */
export interface WorkerLike {
  postMessage(message: ClientMessage): void;
  onmessage: ((event: { data: HostMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  /** A message that could not be read. Optional: only the real Worker has it. */
  onmessageerror?: ((event: unknown) => void) | null;
  terminate(): void;
}

export interface RunningJob<R> {
  /** Resolves with the result; rejects with Cancelled if cancelled, or an Error if the job failed. */
  result: Promise<R>;
  cancel(): void;
}

interface Pending {
  resolve(result: JobResult): void;
  reject(error: Error): void;
  onProgress?: (fraction: number) => void;
}

export class BatchClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly create: () => WorkerLike;

  /** `create` makes the worker, the first time it is needed. The default is the real one. */
  constructor(create: () => WorkerLike = () => new Worker(new URL('../worker/batch.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike) {
    this.create = create;
  }

  sweep(spec: SweepSpec, onProgress?: (fraction: number) => void): RunningJob<SweepResult> {
    return this.start({ kind: 'sweep', spec }, onProgress) as RunningJob<SweepResult>;
  }

  fastForward(spec: FastForwardSpec, onProgress?: (fraction: number) => void): RunningJob<FastForwardResult> {
    return this.start({ kind: 'fastForward', spec }, onProgress) as RunningJob<FastForwardResult>;
  }

  lyapunov(spec: LyapunovSpec, onProgress?: (fraction: number) => void): RunningJob<LyapunovResult> {
    return this.start({ kind: 'lyapunov', spec }, onProgress) as RunningJob<LyapunovResult>;
  }

  chaos(spec: ChaosSpec, onProgress?: (fraction: number) => void): RunningJob<ChaosVerdict> {
    return this.start({ kind: 'chaos', spec }, onProgress) as RunningJob<ChaosVerdict>;
  }

  /** Ends the worker, failing every job still running. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Cancelled());
    this.pending.clear();
  }

  private start(job: Job, onProgress?: (fraction: number) => void): RunningJob<JobResult> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    const result = new Promise<JobResult>((resolve, reject) => this.pending.set(id, { resolve, reject, onProgress }));
    worker.postMessage({ type: 'run', id, job });
    return { result, cancel: () => this.worker?.postMessage({ type: 'cancel', id }) };
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.create();
    // Events from a worker that has been replaced are not this client's business any more.
    worker.onmessage = (event) => {
      if (this.worker === worker) this.receive(event.data);
    };
    worker.onerror = (event) => this.fail(worker, event.message || 'the batch worker failed');
    worker.onmessageerror = () => this.fail(worker, 'the batch worker sent a message that could not be read');
    this.worker = worker;
    return worker;
  }

  /**
   * The worker is no use any more (its script did not load, or it crashed): ends it, fails the jobs it
   * had, and forgets it, so that the next job starts a new one instead of posting to a dead one.
   */
  private fail(worker: WorkerLike, reason: string): void {
    if (this.worker !== worker) return;
    worker.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error(reason));
    this.pending.clear();
  }

  private receive(message: HostMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    switch (message.type) {
      case 'progress':
        pending.onProgress?.(message.fraction);
        return;
      case 'result':
        this.pending.delete(message.id);
        pending.resolve(message.result);
        return;
      case 'cancelled':
        this.pending.delete(message.id);
        pending.reject(new Cancelled());
        return;
      case 'error':
        this.pending.delete(message.id);
        pending.reject(new Error(message.message));
    }
  }
}
