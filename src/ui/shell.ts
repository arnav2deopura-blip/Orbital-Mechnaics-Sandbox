import { el } from './dom';
import { ARRANGEMENTS, currentArrangement } from './arrangement';
import type { ArrangementId } from './arrangement';
import type { Charts } from './charts';
import { createDockMenu } from './dockMenu';
import { GROUPS } from './groups';
import type { ModuleGroup } from './groups';
import { disposePanes } from './modules/common';
import { DEFAULT_DOCK_WIDTH, savePrefs } from './prefs';
import type { ModulePrefs, Prefs } from './prefs';

// The simulator page: a bar of always-needed controls, the stage (the 3D view, the warnings over
// it, the charts drawer under it) and a panel of modules on the right. The panel has four tabs;
// each module is a section the user can fold, close, or bring back from the chooser at the end of
// the tab strip. Which are open, which tab is up and how wide the panel is are remembered.

export interface ModuleSpec {
  id: string;
  title: string;
  /** The tab it is in. */
  group: ModuleGroup;
  /** One line for the chooser: what it is for. */
  summary: string;
  /** Open on a first visit. */
  shownByDefault: boolean;
  /** Its controls depend on how many bodies there are: it is built again when that changes. */
  perBody?: boolean;
  /** Folded on a first visit. */
  collapsedByDefault?: boolean;
  /** Fills the section. Returns what refreshes it, called only while it is open, unfolded and in the open tab. */
  build(body: HTMLElement): () => void;
}

interface Card {
  spec: ModuleSpec;
  root: HTMLElement;
  body: HTMLElement;
  toggle: HTMLButtonElement;
  refresh: () => void;
}

const MIN_DOCK = 340;
const MAX_DOCK = 720;

export class Shell {
  readonly topbar = el('header', 'topbar');
  readonly stage = el('main', 'stage');
  /** Where the 3D canvas goes. */
  readonly viewport = el('div', 'viewport');
  /** Over the top of the view: warnings and the welcome card. */
  readonly overlay = el('div', 'overlay');
  /** Under the view: the charts. */
  readonly drawer = el('section', 'drawer');
  readonly dock = el('aside', 'dock');

  private readonly workspace = el('div', 'workspace');
  private readonly tabs = el('div', 'dock-tabs');
  private readonly tabButtons = new Map<ModuleGroup, HTMLButtonElement>();
  private readonly cardsHost = el('div', 'dock-cards');
  private readonly empty = el('p', 'dock-empty');
  private readonly cards: Card[] = [];
  private readonly prefs: Prefs;
  private readonly listeners: (() => void)[] = [];
  private charts: Charts | null = null;
  /** What the page looked like before "orbits only", so the same key can undo it. */
  private beforeOrbits: { panel: boolean; charts: boolean } | null = null;

  constructor(root: HTMLElement, prefs: Prefs) {
    this.prefs = prefs;
    root.classList.add('shell');
    this.viewport.setAttribute('aria-label', 'The three bodies in 3D. Drag to orbit, scroll to zoom.');
    this.drawer.setAttribute('aria-label', 'Diagnostic charts');
    this.dock.setAttribute('aria-label', 'Modules');
    this.stage.append(this.viewport, this.overlay, this.drawer);

    this.buildTabs();
    this.empty.textContent = 'Every module in this tab is closed. Choose modules with the button at the end of the tab strip.';
    this.dock.append(this.tabs, this.cardsHost, this.empty);
    const resizer = el('div', 'dock-resizer');
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.setAttribute('aria-label', 'Resize the module panel');
    this.dragToResize(resizer);
    this.workspace.append(this.stage, resizer, this.dock);
    root.append(this.topbar, this.workspace);

    if (!GROUPS.some((g) => g.id === this.prefs.dockTab)) this.prefs.dockTab = GROUPS[0].id;
    this.applyDock();
    this.applyTab();
  }

  addModules(specs: ModuleSpec[]): void {
    for (const spec of specs) {
      const state = this.moduleState(spec);
      const root = el('section', 'module');
      root.dataset.module = spec.id;
      const head = el('header', 'module-head');
      const toggle = document.createElement('button');
      toggle.className = 'module-toggle';
      toggle.type = 'button';
      toggle.innerHTML = `<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>`;
      (toggle.lastElementChild as HTMLElement).textContent = spec.title;
      const close = document.createElement('button');
      close.className = 'icon-button module-close';
      close.type = 'button';
      close.title = `Close ${spec.title} (bring it back with the chooser)`;
      close.setAttribute('aria-label', `Close ${spec.title}`);
      close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      head.append(toggle, close);
      const body = el('div', 'module-body');
      body.id = `module-${spec.id}`;
      toggle.setAttribute('aria-controls', body.id);
      root.append(head, body);
      this.cardsHost.appendChild(root);

      const card: Card = { spec, root, body, toggle, refresh: spec.build(body) };
      this.cards.push(card);
      toggle.addEventListener('click', () => {
        state.collapsed = !state.collapsed;
        this.applyCard(card);
        this.save();
      });
      close.addEventListener('click', () => this.setShown(spec.id, false));
      this.applyCard(card);
    }
    this.applyEmpty();
  }

  /** Builds the modules that depend on the number of bodies again: it changed, and with it their controls. */
  rebuildPerBody(): void {
    for (const card of this.cards) {
      if (!card.spec.perBody) continue;
      disposePanes(card.body);
      card.body.replaceChildren();
      card.refresh = card.spec.build(card.body);
      this.applyCard(card);
    }
  }

  /** What the view is of, for screen readers: the bodies as they are now. */
  setBodyCount(count: number): void {
    this.viewport.setAttribute('aria-label', `The ${count === 2 ? 'two' : 'three'} bodies in 3D. Drag to orbit, scroll to zoom.`);
  }

  /** Refreshes the sections that can be seen. */
  refresh(): void {
    if (this.prefs.dockHidden) return;
    for (const card of this.cards) if (this.isVisible(card)) card.refresh();
  }

  get modules(): readonly ModuleSpec[] {
    return this.cards.map((card) => card.spec);
  }

  isShown(id: string): boolean {
    const card = this.cards.find((c) => c.spec.id === id);
    return card ? this.moduleState(card.spec).shown : false;
  }

  /** Opens or closes a module. Opening one also unfolds it, shows the panel on its tab and scrolls to it. */
  setShown(id: string, shown: boolean): void {
    const card = this.cards.find((c) => c.spec.id === id);
    if (!card) return;
    const state = this.moduleState(card.spec);
    state.shown = shown;
    if (shown) {
      state.collapsed = false;
      this.prefs.dockTab = card.spec.group;
      if (this.prefs.dockHidden) this.setDockHidden(false);
    }
    this.applyTab();
    this.save();
    if (shown) card.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Every module back to how a first visit has it. */
  resetLayout(): void {
    this.prefs.modules = {};
    this.prefs.dockWidth = DEFAULT_DOCK_WIDTH;
    this.prefs.dockTab = GROUPS[0].id;
    this.applyTab();
    this.applyArrangement('instrument');
  }

  get dockHidden(): boolean {
    return this.prefs.dockHidden;
  }

  setDockHidden(hidden: boolean): void {
    this.prefs.dockHidden = hidden;
    this.applyDock();
    this.save();
  }

  setTab(group: ModuleGroup): void {
    this.prefs.dockTab = group;
    this.applyTab();
    this.save();
  }

  /** The charts drawer is the shell's to arrange, but the charts own their state: they are handed over once. */
  bindCharts(charts: Charts): void {
    this.charts = charts;
  }

  get arrangement(): ArrangementId | null {
    const charts = this.charts;
    return charts ? currentArrangement(!this.prefs.dockHidden, charts.settings.visible, charts.settings.size) : null;
  }

  /** Sets the panel, the charts and the drawer's height together. */
  applyArrangement(id: ArrangementId): void {
    const charts = this.charts;
    const arrangement = ARRANGEMENTS.find((a) => a.id === id);
    if (!charts || !arrangement) return;
    this.beforeOrbits = null;
    this.prefs.dockHidden = !arrangement.panel;
    this.applyDock();
    charts.settings.visible = arrangement.charts;
    if (arrangement.size !== null) charts.setSize(arrangement.size);
    charts.update();
    this.prefs.charts = charts.settings.visible;
    this.prefs.chartsSize = charts.settings.size;
    this.save();
  }

  /** "Orbits only", and back to what was there before. */
  toggleOrbitsOnly(): void {
    const charts = this.charts;
    if (!charts) return;
    if (this.arrangement === 'orbits' && this.beforeOrbits) {
      const back = this.beforeOrbits;
      this.beforeOrbits = null;
      this.prefs.dockHidden = !back.panel;
      this.applyDock();
      charts.settings.visible = back.charts;
      charts.update();
      this.prefs.charts = back.charts;
      this.save();
      return;
    }
    const before = { panel: !this.prefs.dockHidden, charts: charts.settings.visible };
    this.applyArrangement('orbits');
    this.beforeOrbits = before;
  }

  /** Called whenever what the shell shows changes, so buttons that mirror it can update. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  save(): void {
    savePrefs(this.prefs);
    for (const listener of this.listeners) listener();
  }

  private buildTabs(): void {
    this.tabs.setAttribute('role', 'tablist');
    this.tabs.setAttribute('aria-label', 'Module groups');
    for (const group of GROUPS) {
      const tab = el('button', 'dock-tab');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.textContent = group.title;
      tab.addEventListener('click', () => this.setTab(group.id));
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const at = GROUPS.findIndex((g) => g.id === group.id);
        const next = GROUPS[(at + (event.key === 'ArrowRight' ? 1 : GROUPS.length - 1)) % GROUPS.length];
        this.setTab(next.id);
        this.tabButtons.get(next.id)?.focus();
      });
      this.tabButtons.set(group.id, tab);
      this.tabs.appendChild(tab);
    }
    const { opener, sheet } = createDockMenu(this);
    this.tabs.append(opener, sheet);
  }

  private moduleState(spec: ModuleSpec): ModulePrefs {
    return (this.prefs.modules[spec.id] ??= { shown: spec.shownByDefault, collapsed: spec.collapsedByDefault ?? false });
  }

  private isVisible(card: Card): boolean {
    const state = this.moduleState(card.spec);
    return state.shown && !state.collapsed && card.spec.group === this.prefs.dockTab;
  }

  private applyCard(card: Card): void {
    const state = this.moduleState(card.spec);
    card.root.hidden = !state.shown || card.spec.group !== this.prefs.dockTab;
    card.root.classList.toggle('collapsed', state.collapsed);
    card.toggle.setAttribute('aria-expanded', String(!state.collapsed));
    if (this.isVisible(card)) card.refresh();
  }

  private applyTab(): void {
    for (const [id, tab] of this.tabButtons) {
      const on = id === this.prefs.dockTab;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle('on', on);
    }
    for (const card of this.cards) this.applyCard(card);
    this.applyEmpty();
  }

  private applyEmpty(): void {
    this.empty.hidden = this.cards.some((card) => card.spec.group === this.prefs.dockTab && this.moduleState(card.spec).shown);
  }

  private applyDock(): void {
    const width = Math.min(MAX_DOCK, Math.max(MIN_DOCK, this.prefs.dockWidth));
    this.workspace.style.setProperty('--dock-width', `${width}px`);
    this.workspace.classList.toggle('dock-hidden', this.prefs.dockHidden);
  }

  private dragToResize(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      handle.setPointerCapture(down.pointerId);
      handle.classList.add('dragging');
      const move = (event: PointerEvent): void => {
        this.prefs.dockWidth = Math.min(MAX_DOCK, Math.max(MIN_DOCK, this.workspace.getBoundingClientRect().right - event.clientX));
        this.applyDock();
      };
      const up = (): void => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => {
      this.prefs.dockWidth = DEFAULT_DOCK_WIDTH;
      this.applyDock();
      this.save();
    });
  }
}

export { el };
