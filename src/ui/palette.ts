// Colors the canvas and chart code need as strings. The same values are the tokens at the top of
// shell.css (--ink, --rule, --accent, ...): change one place, change the other.
//
// The page is graphite and warm white with one accent, vermilion, kept for the primary action and
// the selected state. The three bodies are the only other colors on the plate: gold, cornflower
// and bone, chosen so each pair stays apart for the common kinds of color blindness.

export const INK = '#e6e3dc';
export const INK_2 = '#a6a39b';
export const INK_3 = '#858279';
export const RULE = '#26262a';
export const RULE_STRONG = '#3b3b40';
export const ACCENT = '#ff5a36';

/** One color per integrator, for the batch plots that compare them (a legend names each). */
export const METHOD_COLORS = {
  euler: '#d9695f',
  symplecticEuler: '#e3a94b',
  leapfrog: '#7fbf7b',
  rk4: '#5aa9d6',
  wh: '#a68ad8',
  ias15: INK,
} as const;
