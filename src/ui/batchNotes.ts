import type { LyapunovResult } from '../sim/batch';

// The sentences under the batch results. Plain text from the numbers, apart from the view, so they can be tested.

/** What to say about a Lyapunov run: the estimate, or that the run broke down and there is no verdict. */
export function lyapunovNote(result: Pick<LyapunovResult, 'final' | 'lyapunovTime' | 'failure'> & { times: ArrayLike<number> }): string {
  if (result.failure !== null) {
    const reached = result.times.length > 0 ? result.times[result.times.length - 1] : 0;
    const when = reached > 0 ? `after t = ${+reached.toPrecision(4)}` : 'at once';
    return (
      `The run broke down ${when}: ${result.failure}. ` +
      (reached > 0 ? 'The curve shows only what was measured before that, and it is not a verdict on chaos.' : 'There is no estimate, and nothing to say about chaos.')
    );
  }
  return result.final > 0
    ? `The estimate ends at ${result.final.toPrecision(3)} per unit time: a Lyapunov time of about ${result.lyapunovTime.toPrecision(3)}. ` +
        'A regular orbit gives an estimate that keeps falling toward zero (like ln t / t); chaos gives one that levels off above it.'
    : 'The estimate is not positive: no sign of chaos over this run.';
}

/** A sentence for the sweeps when some runs failed (they are left out of the plots, not drawn as perfect), else nothing. */
export function sweepFailureNote(failures: number, runs: number): string {
  if (failures === 0) return '';
  return `${failures} of ${runs} run${runs === 1 ? '' : 's'} failed (a step produced numbers that were not finite) and ${failures === 1 ? 'is' : 'are'} left out of the plots.`;
}
