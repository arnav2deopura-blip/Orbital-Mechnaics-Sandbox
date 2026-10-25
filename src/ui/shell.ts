import { el } from './dom';
import { disposePanes } from './modules/common';
import { DEFAULT_DOCK_WIDTH, savePrefs } from './prefs';
import type { ModulePrefs, Prefs } from './prefs';

// The page layout: a top bar, the stage (the 3D view, the warnings over it, the charts drawer
// under it) and a dock of modules on the right. Each module is a card the user can collapse,
// close, or bring back from the Modules menu; which ones are open is remembered.

export interface ModuleSpec {
  id: string;
  title: string;
  /** One line for the Modules menu: what it is for. */
  summary: string;
  /** Open on a first visit. */
  shownByDefault: boolean;
  /** Its controls depend on how many bodies there are: it is built again when that changes. */
  perBody?: boolean;
  /** Folded on a first visit. */
  collapsedByDefault?: boolean;
  /** Fills the card. Returns what refreshes it, called only while the card is open and unfolded. */
  build(body: HTMLElement): () => void;
}

interface Card {
  spec: ModuleSpec;
  root: HTMLElement;
  body: HTMLElement;
  toggle: HTMLButtonElement;
  refresh: () => void;
}

const MIN_DOCK = 280;
const MAX_DOCK = 640;
/** Below this width the dock is a sheet over the view rather than a column beside it. */
export const NARROW_QUERY = '(max-width: 760px)';

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
  private readonly cardsHost = el('div', 'dock-cards');
  private readonly empty = el('p', 'dock-empty');
  private readonly cards: Card[] = [];
  private readonly prefs: Prefs;
  private readonly listeners: (() => void)[] = [];

  constructor(root: HTMLElement, prefs: Prefs) {
    this.prefs = prefs;
    root.classList.add('shell');
    this.viewport.setAttribute('aria-label', 'The three bodies in 3D. Drag to orbit, scroll to zoom.');
    this.drawer.setAttribute('aria-label', 'Diagnostic charts');
    this.dock.setAttribute('aria-label', 'Modules');
    this.stage.append(this.viewport, this.overlay, this.drawer);

    this.empty.textContent = 'Every module is closed. Open one from Modules in the top bar.';
    // On a phone the dock is a sheet over the view, with a way to put it away.
    const sheetHead = el('div', 'sheet-head');
    const sheetTitle = el('strong');
    sheetTitle.textContent = 'Modules';
    const done = el('button', 'text-button');
    done.type = 'button';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.setDockHidden(true));
    sheetHead.append(sheetTitle, done);
    this.dock.append(sheetHead, this.cardsHost, this.empty);
    const resizer = el('div', 'dock-resizer');
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-label', 'Resize the module panel');
    this.dragToResize(resizer);
    this.workspace.append(this.stage, resizer, this.dock);
    root.append(this.topbar, this.workspace);

    // A phone starts with the sheet down, whatever was saved: it would cover the view.
    if (matchMedia(NARROW_QUERY).matches) this.prefs.dockHidden = true;
    this.applyDock();
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
      close.title = `Close ${spec.title} (bring it back from Modules)`;
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

  /** Refreshes the cards that can be seen. */
  refresh(): void {
    if (this.prefs.dockHidden) return;
    for (const card of this.cards) {
      const state = this.moduleState(card.spec);
      if (state.shown && !state.collapsed) card.refresh();
    }
  }

  get modules(): readonly ModuleSpec[] {
    return this.cards.map((card) => card.spec);
  }

  isShown(id: string): boolean {
    const card = this.cards.find((c) => c.spec.id === id);
    return card ? this.moduleState(card.spec).shown : false;
  }

  /** Opens or closes a module. Opening one also unfolds it, shows the dock and scrolls to the card. */
  setShown(id: string, shown: boolean): void {
    const card = this.cards.find((c) => c.spec.id === id);
    if (!card) return;
    const state = this.moduleState(card.spec);
    state.shown = shown;
    if (shown) {
      state.collapsed = false;
      if (this.prefs.dockHidden) this.setDockHidden(false);
    }
    this.applyCard(card);
    this.applyEmpty();
    this.save();
    if (shown) card.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Every module back to how a first visit has it. */
  resetLayout(): void {
    this.prefs.modules = {};
    this.prefs.dockWidth = DEFAULT_DOCK_WIDTH;
    for (const card of this.cards) this.applyCard(card);
    this.applyEmpty();
    this.setDockHidden(false);
  }

  get dockHidden(): boolean {
    return this.prefs.dockHidden;
  }

  setDockHidden(hidden: boolean): void {
    this.prefs.dockHidden = hidden;
    this.applyDock();
    this.save();
  }

  /** Called whenever what the shell shows changes, so buttons that mirror it can update. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  save(): void {
    savePrefs(this.prefs);
    for (const listener of this.listeners) listener();
  }

  private moduleState(spec: ModuleSpec): ModulePrefs {
    return (this.prefs.modules[spec.id] ??= { shown: spec.shownByDefault, collapsed: spec.collapsedByDefault ?? false });
  }

  private applyCard(card: Card): void {
    const state = this.moduleState(card.spec);
    card.root.hidden = !state.shown;
    card.root.classList.toggle('collapsed', state.collapsed);
    card.toggle.setAttribute('aria-expanded', String(!state.collapsed));
    if (state.shown && !state.collapsed) card.refresh();
  }

  private applyEmpty(): void {
    this.empty.hidden = this.cards.some((card) => this.moduleState(card.spec).shown);
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
