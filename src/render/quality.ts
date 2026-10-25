// Automatic quality reduction (plan §13): when frames stay slow, lower the pixel ratio and then
// shorten the trails, one step at a time, and say what was done. It never raises quality again,
// so it cannot oscillate. The decision is pure so that it can be tested without a GPU.

/** Slower than this, but not below the floor, for this many stats windows (a quarter second each) is "slow". */
export const SLOW_FPS = 30;
/** Below this is not load but a tab the browser has throttled, which lowering the quality would not help. */
export const SLOW_FPS_FLOOR = 8;
export const SLOW_WINDOWS = 12;
export const MIN_AUTO_TRAIL = 1000;

export interface QualityState {
  /** Consecutive slow windows so far. */
  slowWindows: number;
  /** The highest pixel ratio the view may use. */
  pixelRatioCap: number;
  trailLength: number;
}

export interface QualityDecision extends QualityState {
  /** What was just done, or null. */
  message: string | null;
}

/** One stats window at `fps`: the next state, and a message when a step was taken. */
export function decideQuality(state: QualityState, fps: number, enabled: boolean): QualityDecision {
  if (!enabled || !(fps >= SLOW_FPS_FLOOR && fps < SLOW_FPS)) return { ...state, slowWindows: 0, message: null };
  const slowWindows = state.slowWindows + 1;
  if (slowWindows < SLOW_WINDOWS) return { ...state, slowWindows, message: null };
  const rate = `running at ${fps.toFixed(0)} fps`;
  if (state.pixelRatioCap > 1) return { ...state, slowWindows: 0, pixelRatioCap: 1, message: `pixel ratio lowered to 1 (${rate})` };
  if (state.trailLength > MIN_AUTO_TRAIL) {
    const trailLength = Math.max(MIN_AUTO_TRAIL, Math.floor(state.trailLength / 2));
    return { ...state, slowWindows: 0, trailLength, message: `trails shortened to ${trailLength} samples (${rate})` };
  }
  return { ...state, slowWindows: 0, message: null };
}
