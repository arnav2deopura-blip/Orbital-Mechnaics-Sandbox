import type { BindingApi, BladeApi, FolderApi } from '@tweakpane/core';
import { Pane } from 'tweakpane';
import { el } from '../dom';

// What the modules share: Tweakpane inside a card, formats, menus, and small bits of HTML.

/** The part of the container API that panes and folders share. */
export type Container = Pick<FolderApi, 'addFolder' | 'addBinding' | 'addButton'>;

/**
 * How often an open module re-reads its controls, since the simulation can pause itself.
 * Tweakpane answers a changed value by writing it back through the binding, so a setter on an
 * object bound here must do nothing when it is given the value it already has: otherwise every
 * programmatic change would be applied a second time (restarting an integrator, or re-baselining the errors).
 */
export const REFRESH_MS = 250;

export const scientific = (value: number): string => (Number.isFinite(value) ? value.toExponential(2) : '-');
export const fixed = (digits: number) => (value: number): string => value.toFixed(digits);

/** The menu: "Symplectic Euler" is Euler with the reordered update, so it is one more entry here. */
export const INTEGRATOR_OPTIONS: Record<string, string> = {
  Leapfrog: 'leapfrog',
  RK4: 'rk4',
  'Wisdom-Holman': 'wh',
  IAS15: 'ias15',
  Euler: 'euler',
  'Symplectic Euler': 'symplectic-euler',
};

/** The bodies to choose from, for a system of n. */
export function bodyOptions(n: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`Body ${i + 1}`, i]));
}

export const NUDGE_DIRECTIONS = { 'Out of plane (L)': 'normal', z: 'z', x: 'x', y: 'y', Random: 'random' };

/** A Tweakpane inside a module's card. The card's header is the title, so the pane has none. */
export function paneIn(parent: HTMLElement): Pane {
  const holder = el('div', 'module-pane');
  parent.appendChild(holder);
  const pane = new Pane({ container: holder });
  panes.set(parent, [...(panes.get(parent) ?? []), pane]);
  return pane;
}

/** The panes of each card, so a card built again does not leave the old ones (and their timers) running. */
const panes = new WeakMap<HTMLElement, Pane[]>();

export function disposePanes(parent: HTMLElement): void {
  for (const pane of panes.get(parent) ?? []) pane.dispose();
  panes.delete(parent);
}

export function setTitle(binding: BindingApi | BladeApi, text: string | undefined): void {
  if (text) binding.element.setAttribute('title', text);
}

/** A paragraph of plain text. */
export function prose(parent: HTMLElement, text = '', className = 'module-prose'): HTMLParagraphElement {
  const p = el('p', className);
  p.textContent = text;
  parent.appendChild(p);
  return p;
}

/** A link to a section of the Learn page, opened in a new tab so the run keeps going. */
export function learnLink(parent: HTMLElement, text: string, section = ''): HTMLAnchorElement {
  const a = el('a', 'learn-link');
  a.href = `learn.html${section ? `#${section}` : ''}`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  parent.appendChild(a);
  return a;
}

/** A small heading between groups of controls in a card. */
export function subhead(parent: HTMLElement, text: string): void {
  const h = el('h3', 'module-subhead');
  h.textContent = text;
  parent.appendChild(h);
}
