import type { Controller } from '../app/controller';
import { findPreset, PRESETS } from '../presets';
import type { Preset } from '../presets/schema';
import type { Charts } from './charts';
import { INTEGRATOR_OPTIONS } from './modules/common';
import { chooseIntegrator, integratorChoice } from './modules/method';
import type { Shell } from './shell';
import { el, NARROW_QUERY } from './shell';

// The top bar: what is always needed (the preset, play and pause, speed, the method, the time and
// the state of the run), and the switches for the rest (the charts, the modules, the Learn page).

const ICONS = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z" fill="currentColor"/></svg>',
  step: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5v9l6.5-4.5z" fill="currentColor"/><path d="M11 3.5h1.8v9H11z" fill="currentColor"/></svg>',
  reset: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3 2.8v3.4h3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  charts: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h11M4 11V7.5M7 11V4.5M10 11V8M13 11V6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  modules: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 2.5v11" stroke="currentColor" stroke-width="1.4"/></svg>',
  learn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.2c2-.9 4-.9 6 .4 2-1.3 4-1.3 6-.4v8.4c-2-.9-4-.9-6 .4-2-1.3-4-1.3-6-.4z M8 4.6v8.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
};

/** Menu groups for the presets: the classics, the hierarchical systems, the Šuvakov family, and the sandbox. */
function presetGroup(preset: Preset): string {
  if (preset.id === 'sandbox') return 'Your own';
  if (preset.id.startsWith('suvakov-')) return 'Šuvakov–Dmitrašinović orbits';
  if (preset.tags.includes('hierarchical')) return 'Hierarchical systems';
  return 'Classics';
}

function button(className: string, html: string, label: string, title = label): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.innerHTML = html;
  b.setAttribute('aria-label', label);
  b.title = title;
  return b;
}

function labelled(text: string, control: HTMLElement, className = 'bar-field'): HTMLLabelElement {
  const label = el('label', className);
  const caption = el('span', 'bar-caption');
  caption.textContent = text;
  label.append(caption, control);
  return label;
}

/** Builds the top bar into shell.topbar. Returns what refreshes it. */
export function createTopBar(shell: Shell, controller: Controller, charts: Charts): () => void {
  const bar = shell.topbar;
  const { sim, loop } = controller;

  const brand = el('a', 'brand');
  brand.href = 'index.html';
  brand.innerHTML = '<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-name">Three-body sandbox</span>';

  // ---- preset ----------------------------------------------------------------------------
  const preset = el('select', 'bar-select preset-select');
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const p of PRESETS) {
    const name = presetGroup(p);
    let group = groups.get(name);
    if (!group) {
      group = el('optgroup');
      group.label = name;
      groups.set(name, group);
    }
    const option = el('option');
    option.value = p.id;
    option.textContent = p.name;
    group.appendChild(option);
  }
  preset.append(...groups.values());
  preset.addEventListener('change', () => {
    const chosen = findPreset(preset.value);
    if (chosen && chosen !== controller.preset) controller.loadPreset(chosen);
    preset.blur();
  });

  // ---- transport -------------------------------------------------------------------------
  const play = button('bar-button play-button', ICONS.pause, 'Pause', 'Play or pause (space)');
  play.addEventListener('click', () => {
    if (loop.settings.running) controller.pause();
    else controller.play();
    refresh();
  });
  const step = button('bar-button icon-only', ICONS.step, 'Step once', 'Pause and take one step');
  step.addEventListener('click', () => controller.step());
  const reset = button('bar-button icon-only', ICONS.reset, 'Reset', 'Back to the start of this run');
  reset.addEventListener('click', () => controller.reset());
  const transport = el('div', 'bar-group transport');
  transport.append(play, step, reset);

  // ---- speed: periods per second, on a log scale (the slider holds the exponent) ----------
  const speed = el('input', 'bar-range');
  speed.type = 'range';
  speed.min = '-4';
  speed.max = '3';
  speed.step = '0.01';
  speed.setAttribute('aria-label', 'Speed, in orbits per second');
  const speedValue = el('output', 'bar-value');
  const speedExponent = (): number => Math.log10(loop.settings.speed / sim.reference.period);
  speed.addEventListener('input', () => {
    controller.setSpeed(10 ** Number(speed.value) * sim.reference.period);
    speedValue.textContent = formatSpeed(Number(speed.value));
  });
  const speedField = el('div', 'bar-speed');
  speedField.append(speed, speedValue);
  const speedLabel = labelled('Speed', speedField);
  speedLabel.title = 'Simulated time per real second, in periods of the system (T_char). Log scale.';

  // ---- method ----------------------------------------------------------------------------
  const method = el('select', 'bar-select');
  for (const [name, id] of Object.entries(INTEGRATOR_OPTIONS)) {
    const option = el('option');
    option.value = id;
    option.textContent = name;
    method.appendChild(option);
  }
  method.addEventListener('change', () => {
    chooseIntegrator(controller, method.value);
    method.blur();
  });

  // ---- clock and status, in the corner of the view ---------------------------------------
  const hud = el('div', 'hud');
  const clock = el('div', 'bar-clock');
  clock.title = 'Simulated time, and how many periods (T_char) that is';
  const status = el('div', 'status-pill');
  status.setAttribute('role', 'status');
  hud.append(status, clock);
  shell.viewport.appendChild(hud);

  // ---- switches --------------------------------------------------------------------------
  const chartsToggle = button('bar-button toggle', `${ICONS.charts}<span>Charts</span>`, 'Show charts', 'Show or hide the charts under the view (C)');
  chartsToggle.addEventListener('click', () => {
    charts.settings.visible = !charts.settings.visible;
    charts.update();
    refresh();
  });
  const modulesButton = button('bar-button', `${ICONS.modules}<span>Modules</span>`, 'Modules', 'Choose which modules are in the side panel');
  modulesButton.setAttribute('aria-haspopup', 'true');
  modulesButton.setAttribute('aria-expanded', 'false');
  const menu = buildModulesMenu(shell, modulesButton);
  const learn = el('a', 'bar-button learn-button');
  learn.href = 'learn.html';
  learn.target = '_blank';
  learn.rel = 'noopener';
  learn.innerHTML = `${ICONS.learn}<span>Learn how it works</span>`;
  learn.title = 'Plain-language explanations of every method, chart and preset, with links back here (opens a new tab)';
  const switches = el('div', 'bar-group switches');
  const menuHost = el('div', 'menu-host');
  menuHost.append(modulesButton, menu);
  switches.append(chartsToggle, menuHost, learn);

  const main = el('div', 'bar-main');
  main.append(labelled('Preset', preset), transport, speedLabel, labelled('Method', method));
  bar.append(brand, main, switches);

  // Space plays and pauses, C shows the charts: not while typing in a field.
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (target && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName))) return;
    if (event.key === ' ') {
      event.preventDefault();
      play.click();
    } else if (event.key === 'c' || event.key === 'C') {
      chartsToggle.click();
    }
  });

  let shownRunning: boolean | null = null;
  function refresh(): void {
    if (preset.value !== controller.preset.id) preset.value = controller.preset.id;
    const choice = integratorChoice(controller);
    if (method.value !== choice) method.value = choice;
    const running = loop.settings.running;
    if (running !== shownRunning) {
      shownRunning = running;
      play.innerHTML = `${running ? ICONS.pause : ICONS.play}<span>${running ? 'Pause' : 'Play'}</span>`;
      play.setAttribute('aria-label', running ? 'Pause' : 'Play');
      play.classList.toggle('paused', !running);
    }
    if (document.activeElement !== speed) {
      const exponent = speedExponent();
      speed.value = String(exponent);
      speedValue.textContent = formatSpeed(exponent);
    }
    const t = sim.state.t;
    clock.textContent = `t = ${formatTime(t)} · ${(t / sim.reference.period).toFixed(1)} T`;

    const worst = controller.issues[0]?.severity;
    const failed = sim.failure !== null;
    status.dataset.tone = failed || worst === 'danger' ? 'danger' : worst === 'warning' ? 'warning' : running ? 'ok' : 'idle';
    status.textContent = failed ? 'Failed' : worst === 'danger' ? 'Problem' : running ? (loop.stats.achieved < 0.95 ? `Running ${Math.round(100 * loop.stats.achieved)}%` : 'Running') : 'Paused';
    status.title = controller.readout.status;

    chartsToggle.setAttribute('aria-pressed', String(charts.settings.visible));
    chartsToggle.classList.toggle('on', charts.settings.visible);
  }
  return refresh;
}

function buildModulesMenu(shell: Shell, opener: HTMLButtonElement): HTMLElement {
  const menu = el('div', 'menu');
  menu.hidden = true;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Modules');
  const heading = el('p', 'menu-heading');
  heading.textContent = 'Show in the side panel';
  menu.appendChild(heading);
  const list = el('div', 'menu-list');
  menu.appendChild(list);
  const panelToggle = el('label', 'menu-item menu-panel');
  const panelBox = el('input');
  panelBox.type = 'checkbox';
  const panelText = el('span');
  panelText.innerHTML = '<b>Side panel</b><small>Hide it to give the view the whole width</small>';
  panelToggle.append(panelBox, panelText);
  panelBox.addEventListener('change', () => shell.setDockHidden(!panelBox.checked));
  const foot = el('div', 'menu-foot');
  const resetLayout = el('button', 'text-button');
  resetLayout.type = 'button';
  resetLayout.textContent = 'Reset layout';
  resetLayout.addEventListener('click', () => shell.resetLayout());
  foot.appendChild(resetLayout);
  menu.append(panelToggle, foot);

  const boxes = new Map<string, HTMLInputElement>();
  const fill = (): void => {
    if (boxes.size === 0) {
      for (const spec of shell.modules) {
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
        list.appendChild(item);
        boxes.set(spec.id, box);
      }
    }
    for (const [id, box] of boxes) box.checked = shell.isShown(id);
    panelBox.checked = !shell.dockHidden;
  };
  shell.onChange(() => {
    if (!menu.hidden) fill();
  });

  const close = (): void => {
    menu.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
  };
  opener.addEventListener('click', () => {
    if (!menu.hidden) return close();
    // On a phone the panel is a sheet that starts put away: this button is how to get it back.
    if (matchMedia(NARROW_QUERY).matches && shell.dockHidden) {
      shell.setDockHidden(false);
      return;
    }
    fill();
    menu.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target as Node) && !opener.contains(event.target as Node)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      close();
      opener.focus();
    }
  });
  return menu;
}

function formatSpeed(exponent: number): string {
  const value = 10 ** exponent;
  return `${value < 10 ? value.toPrecision(2) : Math.round(value)} orbits/s`;
}

function formatTime(t: number): string {
  const a = Math.abs(t);
  return a !== 0 && (a >= 1e5 || a < 1e-3) ? t.toExponential(2) : t.toFixed(2);
}
