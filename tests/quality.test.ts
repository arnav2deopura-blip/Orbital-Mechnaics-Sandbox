import { describe, expect, it } from 'vitest';
import { SimLoop } from '../src/app/loop';
import { decideQuality, MIN_AUTO_TRAIL, SLOW_WINDOWS } from '../src/render/quality';
import type { QualityState } from '../src/render/quality';
import { Simulation } from '../src/sim/simulation';
import { kepler } from './helpers';

const start: QualityState = { slowWindows: 0, pixelRatioCap: 2, trailLength: 4000 };

/** Feeds the same fps for n windows, returning the state and every message. */
function run(fps: number, windows: number, from: QualityState = start, enabled = true): { state: QualityState; messages: string[] } {
  let state = from;
  const messages: string[] = [];
  for (let i = 0; i < windows; i++) {
    const d = decideQuality(state, fps, enabled);
    state = { slowWindows: d.slowWindows, pixelRatioCap: d.pixelRatioCap, trailLength: d.trailLength };
    if (d.message) messages.push(d.message);
  }
  return { state, messages };
}

describe('decideQuality', () => {
  it('does nothing while frames are fast', () => {
    const { state, messages } = run(60, 100);
    expect(state).toEqual(start);
    expect(messages).toEqual([]);
  });

  it('waits for sustained slowness: a single slow window, or a few, change nothing', () => {
    expect(run(20, SLOW_WINDOWS - 1).state.pixelRatioCap).toBe(2);
    const interrupted = run(60, 1, run(20, SLOW_WINDOWS - 1).state);
    expect(interrupted.state.slowWindows).toBe(0); // a good window starts the count over
  });

  it('lowers the pixel ratio first, saying so with the frame rate', () => {
    const { state, messages } = run(20, SLOW_WINDOWS);
    expect(state.pixelRatioCap).toBe(1);
    expect(state.trailLength).toBe(4000);
    expect(messages).toEqual(['pixel ratio lowered to 1 (running at 20 fps)']);
  });

  it('then halves the trails, step by step, down to the floor, and stops there', () => {
    const lowered = run(20, SLOW_WINDOWS).state;
    const lengths: number[] = [];
    let state = lowered;
    for (let i = 0; i < 6; i++) {
      state = run(20, SLOW_WINDOWS, state).state;
      lengths.push(state.trailLength);
    }
    expect(lengths).toEqual([2000, 1000, 1000, 1000, 1000, 1000]);
    expect(run(20, 10 * SLOW_WINDOWS, state).messages).toEqual([]);
    expect(MIN_AUTO_TRAIL).toBe(1000);
  });

  it('never raises quality again, however fast it gets', () => {
    const low = run(20, 4 * SLOW_WINDOWS).state;
    const after = run(120, 100, low).state;
    expect(after.pixelRatioCap).toBe(1);
    expect(after.trailLength).toBe(low.trailLength);
  });

  it('ignores a throttled tab (a frame rate far below any real load) and is off when disabled', () => {
    expect(run(1, 100).state).toEqual(start);
    expect(run(20, 100, start, false).state).toEqual(start);
  });
});

describe('the loop budget adapts to how long drawing takes', () => {
  const stepsWith = (renderMs: number | null): number => {
    let now = 0;
    const clock = (): number => (now += 1); // every reading is a millisecond later
    const { s, T } = kepler();
    const sim = new Simulation(s, { integrator: 'leapfrog', params: { dt: T / 1000 }, clock });
    const loop = new SimLoop(sim, { speed: 1e6, budgetMs: 8 }, clock);
    if (renderMs !== null) loop.renderMs = () => renderMs;
    loop.frame(1 / 60);
    return sim.counters.stepCount;
  };

  it('keeps the set budget when drawing is quick, or unknown', () => {
    expect(stepsWith(null)).toBe(stepsWith(0));
    expect(stepsWith(3)).toBe(stepsWith(null));
  });

  it('gives stepping less when drawing takes most of the frame, but never less than 2 ms', () => {
    const full = stepsWith(null);
    const squeezed = stepsWith(14); // 15 ms of frame, 14 of it drawing: 1 ms left, floored to 2
    expect(squeezed).toBeLessThan(full / 2);
    expect(squeezed).toBeGreaterThan(0);
    expect(stepsWith(1000)).toBe(squeezed); // a floor, not zero
  });
});
