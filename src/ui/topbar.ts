import type { Controller } from '../app/controller';
import { findPreset, presetsFor } from '../presets';
import { bodyCountOf } from '../presets/schema';
import type { Preset } from '../presets/schema';
import type { BodyCount } from '../sim/types';
import type { Charts } from './charts';
import { INTEGRATOR_OPTIONS } from './modules/common';
import { chooseIntegrator, integratorChoice } from './modules/method';
import type { Shell } from './shell';
import { el } from './shell';

// The instrument bar: what is always needed (the preset, play and pause, speed, the method, the
// time and the state of the run), and the switches for the rest (the charts, the module panel).
// The page switch (Simulator, Learn) and the arrangements are in the masthead above it.

const ICONS = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z" fill="currentColor"/></svg>',
  step: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5v9l6.5-4.5z" fill="currentColor"/><path d="M11 3.5h1.8v9H11z" fill="currentColor"/></svg>',
  reset: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3 2.8v3.4h3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  charts: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h11M4 11V7.5M7 11V4.5M10 11V8M13 11V6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  modules: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 2.5v11" stroke="currentColor" stroke-width="1.4"/></svg>',
};

/** Menu groups for the presets: the classics, the hierarchical systems, the Šuvakov family, and the sandbox. */
function presetGroup(preset: Preset): string {
  if (preset.id.startsWith('sandbox')) return 'Your own';
  if (bodyCountOf(preset) === 2) return 'The Kepler problem';
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

  // ---- bodies: two or three ---------------------------------------------------------------
  const bodies = el('div', 'segmented');
  bodies.setAttribute('role', 'radiogroup');
  bodies.setAttribute('aria-label', 'Number of bodies');
  const segments = new Map<BodyCount, HTMLButtonElement>();
  for (const count of [2, 3] as const) {
    const segment = el('button', 'segment');
    segment.type = 'button';
    segment.setAttribute('role', 'radio');
    segment.textContent = String(count);
    segment.title = count === 2 ? 'Two bodies: the Kepler problem, solved exactly' : 'Three bodies: no general solution, and chaos';
    segment.addEventListener('click', () => controller.setBodyCount(count));
    segment.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const other = count === 2 ? 3 : 2;
      controller.setBodyCount(other);
      segments.get(other)?.focus();
    });
    segments.set(count, segment);
    bodies.appendChild(segment);
  }

  // ---- preset ----------------------------------------------------------------------------
  // Only the presets with this many bodies: the switch above decides which.
  const preset = el('select', 'bar-select preset-select');
  const fillPresets = (count: BodyCount): void => {
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const p of presetsFor(count)) {
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
    preset.replaceChildren(...groups.values());
  };
  let shownCount: BodyCount = controller.bodyCount;
  fillPresets(shownCount);
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
  const clockTime = el('span', 'clock-time');
  const clockUnit = el('span', 'clock-unit');
  clock.append(clockTime, clockUnit);
  const status = el('div', 'status-pill');
  status.setAttribute('role', 'status');
  hud.append(status, clock);
  // The plate's caption, as a figure in a journal has one: what is drawn and how it was computed.
  const caption = el('p', 'plate-caption');
  shell.viewport.append(hud, caption);

  // ---- switches --------------------------------------------------------------------------
  const chartsToggle = button('bar-button toggle', `${ICONS.charts}<span>Charts</span>`, 'Show charts', 'Show or hide the charts under the view (C)');
  chartsToggle.addEventListener('click', () => {
    charts.settings.visible = !charts.settings.visible;
    charts.update();
    refresh();
  });
  const modulesToggle = button('bar-button toggle', `${ICONS.modules}<span>Modules</span>`, 'Show the module panel', 'Show or hide the module panel on the right (M)');
  modulesToggle.addEventListener('click', () => {
    shell.setDockHidden(!shell.dockHidden);
    refresh();
  });
  const switches = el('div', 'bar-group switches');
  switches.append(chartsToggle, modulesToggle);

  const main = el('div', 'bar-main');
  // Not a <label>: a click on its caption would press the first segment.
  const bodiesField = el('div', 'bar-field bodies-field');
  const bodiesCaption = el('span', 'bar-caption');
  bodiesCaption.id = 'bodies-caption';
  bodiesCaption.textContent = 'Bodies';
  bodies.setAttribute('aria-labelledby', bodiesCaption.id);
  bodiesField.append(bodiesCaption, bodies);
  main.append(bodiesField, labelled('Preset', preset), transport, speedLabel, labelled('Method', method));
  bar.append(main, switches);

  // Space plays and pauses, C shows the charts, M the module panel, F puts everything away but the
  // orbits (and brings it back): not while typing in a field, nor on the Learn page.
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (document.documentElement.dataset.page === 'learn') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (target && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName))) return;
    if (event.key === ' ') {
      event.preventDefault();
      play.click();
    } else if (event.key === 'c' || event.key === 'C') {
      chartsToggle.click();
    } else if (event.key === 'm' || event.key === 'M') {
      modulesToggle.click();
    } else if (event.key === 'f' || event.key === 'F') {
      shell.toggleOrbitsOnly();
      refresh();
    }
  });

  let shownRunning: boolean | null = null;
  function refresh(): void {
    if (controller.bodyCount !== shownCount) {
      shownCount = controller.bodyCount;
      fillPresets(shownCount);
    }
    for (const [count, segment] of segments) {
      const on = count === shownCount;
      segment.setAttribute('aria-checked', String(on));
      segment.tabIndex = on ? 0 : -1;
      segment.classList.toggle('on', on);
    }
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
    clockTime.textContent = formatTime(t);
    clockUnit.textContent = `t · ${(t / sim.reference.period).toFixed(1)} T`;
    const text = captionText(controller);
    if (caption.textContent !== text) caption.textContent = text;

    const worst = controller.issues[0]?.severity;
    const failed = controller.failed;
    status.dataset.tone = failed || worst === 'danger' ? 'danger' : worst === 'warning' ? 'warning' : running ? 'ok' : 'idle';
    status.textContent = failed ? 'Failed' : worst === 'danger' ? 'Problem' : running ? (loop.stats.achieved < 0.95 ? `Running ${Math.round(100 * loop.stats.achieved)}%` : 'Running') : 'Paused';
    status.title = controller.readout.status;

    chartsToggle.setAttribute('aria-pressed', String(charts.settings.visible));
    chartsToggle.classList.toggle('on', charts.settings.visible);
    modulesToggle.setAttribute('aria-pressed', String(!shell.dockHidden));
    modulesToggle.classList.toggle('on', !shell.dockHidden);
  }
  return refresh;
}

/** "Kepler orbit · eccentricity 0.50 · mass ratio 0.30 · IAS15": the figure's caption. */
function captionText(controller: Controller): string {
  const { preset, params } = controller;
  const shown = (preset.params ?? []).filter((spec) => spec.key !== 'tilt').slice(0, 3);
  const settings = shown.map((spec) => `${spec.label} ${+Number(params[spec.key]).toPrecision(3)}`);
  const choice = integratorChoice(controller);
  const method = Object.entries(INTEGRATOR_OPTIONS).find(([, id]) => id === choice)?.[0] ?? choice;
  return [preset.name, ...settings, method].join(' · ');
}

function formatSpeed(exponent: number): string {
  const value = 10 ** exponent;
  return `${value < 10 ? value.toPrecision(2) : Math.round(value)} orbits/s`;
}

function formatTime(t: number): string {
  const a = Math.abs(t);
  return a !== 0 && (a >= 1e5 || a < 1e-3) ? t.toExponential(2) : t.toFixed(2);
}
