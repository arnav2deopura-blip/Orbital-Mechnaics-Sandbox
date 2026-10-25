import { describe, expect, it } from 'vitest';
import { BatchClient } from '../src/app/batch';
import type { WorkerLike } from '../src/app/batch';
import { Cancelled, geometricSeries } from '../src/sim/batch';
import { createBatchHost, transferablesOf } from '../src/worker/host';
import type { ClientMessage, HostMessage } from '../src/worker/protocol';
import { kepler } from './helpers';

/**
 * A Worker without a thread: messages go through structuredClone, as they would between threads,
 * with the buffers handed over, and the host pauses on the macrotask queue as the real one does.
 */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: HostMessage }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  readonly received: ClientMessage[] = [];
  private readonly host = createBatchHost(
    (message, transfer) => {
      const copy = structuredClone(message, { transfer });
      setTimeout(() => this.onmessage?.({ data: copy }), 0);
    },
    () => new Promise((resolve) => setTimeout(resolve, 0)),
  );

  postMessage(message: ClientMessage): void {
    this.received.push(message);
    const copy = structuredClone(message);
    setTimeout(() => void this.host.handle(copy), 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function sweepSpec(count = 6) {
  const { s, T } = kepler();
  return { state: s, integrator: 'leapfrog' as const, duration: T, values: geometricSeries(T / 50, T / 400, count) };
}

describe('BatchClient with a worker', () => {
  it('runs a sweep and returns the result, with progress along the way', async () => {
    const worker = new FakeWorker();
    const client = new BatchClient(() => worker);
    const seen: number[] = [];
    const job = client.sweep(sweepSpec(), (f) => seen.push(f));
    const result = await job.result;
    expect(result.reference).toBe('exact');
    expect(result.values).toHaveLength(6);
    expect(result.errors).toBeInstanceOf(Float64Array);
    expect(Math.abs(result.slope - 2)).toBeLessThan(0.3);
    expect(seen.at(-1)).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('runs fast-forward and Lyapunov jobs too', async () => {
    const client = new BatchClient(() => new FakeWorker());
    const { s, T } = kepler();
    const ff = await client.fastForward({ state: s, integrator: 'leapfrog', dt: T / 100, duration: 20 * T, period: T }).result;
    expect(ff.final.t).toBeGreaterThanOrEqual(20 * T);
    expect(ff.final.x).toBeInstanceOf(Float64Array);
    const ly = await client.lyapunov({ state: s, duration: 10, period: T, intervals: 10 }).result;
    expect(ly.times).toHaveLength(10);
  });

  it('creates its worker once, lazily, and reuses it', async () => {
    let created = 0;
    const worker = new FakeWorker();
    const client = new BatchClient(() => {
      created++;
      return worker;
    });
    expect(created).toBe(0);
    await client.sweep(sweepSpec(3)).result;
    await client.sweep(sweepSpec(3)).result;
    expect(created).toBe(1);
    expect(worker.received.filter((m) => m.type === 'run')).toHaveLength(2);
  });

  it('can be cancelled while it works: the promise rejects with Cancelled, and the worker is still usable', async () => {
    const worker = new FakeWorker();
    const client = new BatchClient(() => worker);
    const stop = { cancel: () => {} };
    const job = client.sweep(sweepSpec(10), (f) => {
      if (f > 0.2) stop.cancel();
    });
    stop.cancel = job.cancel;
    await expect(job.result).rejects.toBeInstanceOf(Cancelled);
    expect(worker.received.some((m) => m.type === 'cancel')).toBe(true);
    // Not left cancelled: the next job runs to the end.
    expect((await client.sweep(sweepSpec(3)).result).values).toHaveLength(3);
  });

  it('runs two jobs at once and keeps their results apart', async () => {
    const client = new BatchClient(() => new FakeWorker());
    const [a, b] = await Promise.all([client.sweep(sweepSpec(3)).result, client.sweep(sweepSpec(5)).result]);
    expect(a.values).toHaveLength(3);
    expect(b.values).toHaveLength(5);
  });

  it('turns a job the worker cannot run into a rejected promise with the message', async () => {
    const client = new BatchClient(() => new FakeWorker());
    // A caller that sends a job the worker does not know, bypassing the typed methods.
    const start = (client as unknown as { start(job: unknown): { result: Promise<unknown> } }).start.bind(client);
    await expect(start({ kind: 'bogus', spec: {} }).result).rejects.toThrow('unknown job: bogus');
  });

  it('rejects everything in flight when the worker itself fails, or is disposed', async () => {
    const worker = new FakeWorker();
    const client = new BatchClient(() => worker);
    const a = client.sweep(sweepSpec(8));
    worker.onerror?.({ message: 'boom' });
    await expect(a.result).rejects.toThrow('boom');

    const b = client.sweep(sweepSpec(8));
    client.dispose();
    await expect(b.result).rejects.toBeInstanceOf(Cancelled);
    expect(worker.terminated).toBe(true);
  });

  it('ignores a message for a job it does not know', () => {
    const worker = new FakeWorker();
    const client = new BatchClient(() => worker);
    client.sweep(sweepSpec(2));
    expect(() => worker.onmessage?.({ data: { type: 'progress', id: 999, fraction: 0.5 } })).not.toThrow();
  });
});

describe('createBatchHost', () => {
  it('replies with progress then the result, handing over the arrays', async () => {
    const replies: { message: HostMessage; transfer: Transferable[] }[] = [];
    const host = createBatchHost((message, transfer) => replies.push({ message, transfer: transfer ?? [] }), () => Promise.resolve());
    await host.handle({ type: 'run', id: 7, job: { kind: 'sweep', spec: sweepSpec(3) } });
    const last = replies.at(-1)!;
    expect(last.message.type).toBe('result');
    expect(last.message.id).toBe(7);
    expect(last.transfer.length).toBeGreaterThanOrEqual(3); // values, errors, forceEvals
    expect(replies.filter((r) => r.message.type === 'progress').length).toBeGreaterThanOrEqual(3);
  });

  it('answers a cancel that arrives during the job with "cancelled", and forgets it', async () => {
    const replies: HostMessage[] = [];
    const self: { host?: ReturnType<typeof createBatchHost> } = {};
    let cancelOnce = true;
    const host = createBatchHost(
      (message) => {
        replies.push(message);
        if (cancelOnce && message.type === 'progress' && message.fraction > 0.3) {
          cancelOnce = false;
          void self.host?.handle({ type: 'cancel', id: 1 });
        }
      },
      () => Promise.resolve(),
    );
    self.host = host;
    await host.handle({ type: 'run', id: 1, job: { kind: 'sweep', spec: sweepSpec(10) } });
    expect(replies.at(-1)).toEqual({ type: 'cancelled', id: 1 });
    // The same id can run again: the cancel was forgotten.
    replies.length = 0;
    await host.handle({ type: 'run', id: 1, job: { kind: 'sweep', spec: sweepSpec(2) } });
    expect(replies.at(-1)?.type).toBe('result');
  });

  it('reports an unknown job as an error rather than throwing', async () => {
    const replies: HostMessage[] = [];
    const host = createBatchHost((m) => replies.push(m), () => Promise.resolve());
    await host.handle({ type: 'run', id: 2, job: { kind: 'bogus' } as never });
    expect(replies.at(-1)).toEqual({ type: 'error', id: 2, message: 'unknown job: bogus' });
  });
});

describe('transferablesOf', () => {
  it('finds every Float64Array buffer in a result, nested ones included', () => {
    const buffers = transferablesOf({
      final: { t: 1, m: new Float64Array(3), x: new Float64Array(9), v: new Float64Array(9), G: 1, eps2: 0 },
      elapsed: new Float64Array(5),
      steps: 3,
      failure: null,
    } as never);
    expect(buffers).toHaveLength(4);
    for (const b of buffers) expect(b).toBeInstanceOf(ArrayBuffer);
  });
});
