import { el } from './dom';
import { GROUPS } from './groups';
import { popover } from './popover';
import type { ModuleSpec, Shell } from './shell';

// "Choose modules": the checkbox sheet that hangs from the side panel's tab strip. Every module
// is listed with what it is for, whichever tab it is in; ticking one opens it (and its tab).

const ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="4.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.9" cy="11.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

/** The opener and the sheet; the caller puts both in the tab strip. */
export function createDockMenu(shell: Shell): { opener: HTMLButtonElement; sheet: HTMLElement } {
  const opener = el('button', 'icon-button dock-customize');
  opener.type = 'button';
  opener.innerHTML = ICON;
  opener.title = 'Choose which modules are in the panel';
  opener.setAttribute('aria-label', 'Choose modules');

  const sheet = el('div', 'menu dock-menu');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Choose modules');
  const heading = el('p', 'menu-heading');
  heading.textContent = 'Modules in the panel';
  const list = el('div', 'menu-list');
  const foot = el('div', 'menu-foot');
  const reset = el('button', 'text-button');
  reset.type = 'button';
  reset.textContent = 'Reset layout';
  reset.addEventListener('click', () => shell.resetLayout());
  foot.appendChild(reset);
  sheet.append(heading, list, foot);

  const boxes = new Map<string, HTMLInputElement>();
  const row = (spec: ModuleSpec): HTMLElement => {
    const item = el('label', 'menu-item');
    const box = el('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => shell.setShown(spec.id, box.checked));
    const text = el('span');
    const title = el('b');
    title.textContent = spec.title;
    const summary = el('small');
    summary.textContent = spec.summary;
    text.append(title, summary);
    item.append(box, text);
    boxes.set(spec.id, box);
    return item;
  };
  const fill = (): void => {
    if (boxes.size === 0) {
      for (const group of GROUPS) {
        const name = el('p', 'menu-group');
        name.textContent = group.title;
        list.appendChild(name);
        for (const spec of shell.modules.filter((m) => m.group === group.id)) list.appendChild(row(spec));
      }
    }
    for (const [id, box] of boxes) box.checked = shell.isShown(id);
  };
  const pop = popover(opener, sheet, fill);
  shell.onChange(() => {
    if (pop.isOpen) fill();
  });
  return { opener, sheet };
}
