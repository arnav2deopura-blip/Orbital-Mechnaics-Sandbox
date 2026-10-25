import { Cancelled, convergenceSweep, fastForward, lyapunov } from '../sim/batch';
import type { BatchContext } from '../sim/batch';
import type { ClientMessage, HostMessage, Job, JobResult } from './protocol';

// What the worker does with a message, apart from the worker itself, so it can be tested without
// one. `post` sends a reply (with the buffers to hand over); `pause` is how a job lets messages in
// between its runs, which is the only way a cancel can arrive while it works.

/** Every Float64Array buffer in a result, to hand over instead of copying. */
export function transferablesOf(result: JobResult): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const visit = (value: unknown): void => {
    if (value instanceof Float64Array) buffers.push(value.buffer as ArrayBuffer);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
  };
  visit(result);
  return buffers;
}

async function run(job: Job, ctx: BatchContext): Promise<JobResult> {
  switch (job.kind) {
    case 'sweep':
      return convergenceSweep(job.spec, ctx);
    case 'fastForward':
      return fastForward(job.spec, ctx);
    case 'lyapunov':
      return lyapunov(job.spec, ctx);
    default:
      throw new Error(`unknown job: ${(job as { kind?: string }).kind}`);
  }
}

export function createBatchHost(
  post: (message: HostMessage, transfer?: Transferable[]) => void,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): { handle(message: ClientMessage): Promise<void> } {
  const cancelled = new Set<number>();
  return {
    async handle(message) {
      if (message.type === 'cancel') {
        cancelled.add(message.id);
        return;
      }
      const { id, job } = message;
      const ctx: BatchContext = {
        cancelled: () => cancelled.has(id),
        progress: (fraction) => post({ type: 'progress', id, fraction }),
        yield: pause,
      };
      try {
        const result = await run(job, ctx);
        post({ type: 'result', id, result }, transferablesOf(result));
      } catch (error) {
        if (error instanceof Cancelled) post({ type: 'cancelled', id });
        else post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
      } finally {
        cancelled.delete(id);
      }
    },
  };
}
