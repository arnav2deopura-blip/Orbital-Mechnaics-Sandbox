/// <reference lib="webworker" />
// The batch worker (plan §9): convergence sweeps, work-precision, fast-forward and the Lyapunov
// estimate, off the main thread so the live view never stalls. The work is src/sim/batch.ts;
// src/worker/host.ts decides what to do with each message.
import { createBatchHost } from './host';
import type { ClientMessage } from './protocol';

const host = createBatchHost((message, transfer) => self.postMessage(message, transfer ?? []));
self.onmessage = (event: MessageEvent<ClientMessage>) => {
  void host.handle(event.data);
};
