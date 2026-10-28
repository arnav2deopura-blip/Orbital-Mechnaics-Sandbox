import { describe, expect, it } from 'vitest';
import { lyapunovNote, sweepFailureNote } from '../src/ui/batchNotes';

describe('lyapunovNote', () => {
  const ok = { final: 0.25, lyapunovTime: 4, failure: null, times: [1, 2, 3] };

  it('quotes a positive estimate, and says no sign of chaos only for a run that went through', () => {
    expect(lyapunovNote(ok)).toMatch(/0\.250 per unit time.*about 4\.00/);
    expect(lyapunovNote({ ...ok, final: -0.01, lyapunovTime: Infinity })).toMatch(/not positive: no sign of chaos/);
  });

  it('says the run broke down, and gives no verdict, instead of "no sign of chaos"', () => {
    const none = lyapunovNote({ final: NaN, lyapunovTime: Infinity, failure: 'integration failed at t=0.00000, min separation 0', times: [] });
    expect(none).toMatch(/broke down at once/);
    expect(none).toMatch(/no estimate/i);
    expect(none).not.toMatch(/no sign of chaos/);

    const part = lyapunovNote({ final: 0.3, lyapunovTime: 3.3, failure: 'integration failed at t=7.0', times: [1, 5, 7] });
    expect(part).toMatch(/broke down after t = 7/);
    expect(part).not.toMatch(/per unit time/); // a partial estimate is not quoted as the answer
  });
});

describe('sweepFailureNote', () => {
  it('is empty when every run went through, and counts the ones that did not', () => {
    expect(sweepFailureNote(0, 8)).toBe('');
    expect(sweepFailureNote(1, 8)).toMatch(/1 of 8 runs failed/);
    expect(sweepFailureNote(3, 8)).toMatch(/3 of 8 runs failed.*left out/);
  });
});
