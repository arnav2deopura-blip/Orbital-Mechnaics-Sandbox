import { learnHref, SIM_HREF } from '../app/router';
import type { Route } from '../app/router';
import { ARRANGEMENTS } from './arrangement';
import type { Charts } from './charts';
import { el } from './dom';
import { popover } from './popover';
import type { Shell } from './shell';

// The masthead: a thin row above everything, the same on both pages. The name, the two pages as
// tabs (the open one underlined in the accent), and on the simulator page a Layout menu for
// arranging it: which of the charts and the module panel show, and how tall the charts are.

const LAYOUT_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 9.5h6.5M9 2.5v7" stroke="currentColor" stroke-width="1.4"/></svg>';

/** A 28 by 18 sketch of an arrangement: the view, the panel at the right, the charts under it. */
function sketch(panel: boolean, charts: boolean, tall: boolean): string {
  const edge = 'fill="none" stroke="currentColor" stroke-width="1"';
  const fill = 'fill="currentColor" fill-opacity="0.38"';
  const stageRight = panel ? 19 : 27;
  const drawerTop = tall ? 6 : 12;
  return (
    `<svg class="sketch" viewBox="0 0 28 18" aria-hidden="true">` +
    `<rect x="0.5" y="0.5" width="27" height="17" ${edge}/>` +
    (panel ? `<path d="M19.5 0.5v17" ${edge}/><rect x="20" y="1" width="7" height="3" ${fill}/><rect x="20" y="5" width="7" height="3" ${fill}/>` : '') +
    (charts ? `<path d="M0.5 ${drawerTop}.5H${stageRight}" ${edge}/><rect x="1" y="${drawerTop + 1}" width="${stageRight - 1}" height="${17 - drawerTop}" ${fill}/>` : '') +
    `<circle cx="${panel ? 9 : 13}" cy="${charts ? (tall ? 3 : 6) : 9}" r="1.5" fill="currentColor"/>` +
    `</svg>`
  );
}

export interface Masthead {
  root: HTMLElement;
  /** Shows which page is open, and the Layout menu only on the simulator. */
  setRoute(route: Route): void;
  /** Re-reads the layout state for the menu while it is open. */
  refresh(): void;
}

export function createMasthead(shell: Shell, charts: Charts): Masthead {
  const root = el('header', 'masthead');

  const brand = el('a', 'brand');
  brand.href = SIM_HREF;
  brand.innerHTML = '<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-name">Three-body sandbox</span>';

  const nav = el('nav', 'pages');
  nav.setAttribute('aria-label', 'Pages');
  const pages = [
    { id: 'sim', title: 'Simulator', href: SIM_HREF },
    { id: 'learn', title: 'Learn', href: learnHref() },
  ] as const;
  const links = new Map<string, HTMLAnchorElement>();
  for (const page of pages) {
    const a = el('a', 'page-tab');
    a.href = page.href;
    a.textContent = page.title;
    links.set(page.id, a);
    nav.appendChild(a);
  }

  // ---- layout menu --------------------------------------------------------------------------
  const host = el('div', 'layout-host');
  const opener = el('button', 'page-tab layout-button');
  opener.type = 'button';
  opener.innerHTML = `${LAYOUT_ICON}<span>Layout</span>`;
  opener.title = 'Arrange the page: the module panel, the charts, or the orbits alone';
  const sheet = el('div', 'menu layout-menu');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Layout');
  const heading = el('p', 'menu-heading');
  heading.textContent = 'Arrange the page';
  const list = el('div', 'layout-list');
  const items = new Map<string, HTMLButtonElement>();
  for (const arrangement of ARRANGEMENTS) {
    const item = el('button', 'layout-item');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    const tall = arrangement.size !== null && arrangement.size >= 0.7;
    item.innerHTML = `${sketch(arrangement.panel, arrangement.charts, tall)}<span><b></b><small></small></span>`;
    (item.querySelector('b') as HTMLElement).textContent = arrangement.title;
    (item.querySelector('small') as HTMLElement).textContent = arrangement.summary;
    item.addEventListener('click', () => {
      shell.applyArrangement(arrangement.id);
      refresh();
    });
    items.set(arrangement.id, item);
    list.appendChild(item);
  }

  const toggles = el('div', 'layout-toggles');
  const toggle = (text: string, key: string, get: () => boolean, set: (on: boolean) => void): HTMLInputElement => {
    const label = el('label', 'menu-item layout-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      set(box.checked);
      refresh();
    });
    const span = el('span');
    span.innerHTML = '<b></b><kbd></kbd>';
    (span.querySelector('b') as HTMLElement).textContent = text;
    (span.querySelector('kbd') as HTMLElement).textContent = key;
    label.append(box, span);
    toggles.appendChild(label);
    box.checked = get();
    return box;
  };
  const chartsBox = toggle('Charts', 'C', () => charts.settings.visible, (on) => {
    charts.settings.visible = on;
    charts.update();
  });
  const panelBox = toggle('Module panel', 'M', () => !shell.dockHidden, (on) => shell.setDockHidden(!on));

  const foot = el('div', 'menu-foot layout-foot');
  const hint = el('span', 'layout-hint');
  hint.innerHTML = '<kbd>F</kbd> orbits only, and back';
  const reset = el('button', 'text-button');
  reset.type = 'button';
  reset.textContent = 'Reset layout';
  reset.addEventListener('click', () => {
    shell.resetLayout();
    refresh();
  });
  foot.append(hint, reset);
  sheet.append(heading, list, toggles, foot);
  host.append(opener, sheet);
  const pop = popover(opener, sheet, () => refresh());

  function refresh(): void {
    const current = shell.arrangement;
    for (const [id, item] of items) {
      item.setAttribute('aria-checked', String(id === current));
      item.classList.toggle('on', id === current);
    }
    chartsBox.checked = charts.settings.visible;
    panelBox.checked = !shell.dockHidden;
  }

  root.append(brand, nav, host);
  return {
    root,
    setRoute(route) {
      for (const [id, a] of links) {
        if (id === route.page) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
      host.hidden = route.page !== 'sim';
      if (route.page !== 'sim') pop.close();
    },
    refresh() {
      if (pop.isOpen) refresh();
    },
  };
}
