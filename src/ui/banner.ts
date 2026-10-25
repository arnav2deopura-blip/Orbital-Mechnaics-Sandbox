import type { Controller } from '../app/controller';
import type { Fix, Issue } from '../app/health';
import { learnHref } from '../app/router';
import { findPreset } from '../presets';
import { savePrefs } from './prefs';
import type { Prefs } from './prefs';
import type { Shell } from './shell';
import { el } from './shell';

// Over the top of the view: the most pressing warning about the run, in plain words, with buttons
// that fix it (health.ts says which), and on a first visit a card pointing at the Learn page.

const FIX_LABELS: Record<Exclude<Fix, 'suggested'>, string> = {
  bind: 'Slow the bodies so it stays together',
  ias15: 'Switch to IAS15 and restart',
  'smaller-step': 'Use a smaller step and restart',
  reset: 'Restart this run',
  frame: 'Frame all bodies',
  defaults: "Restore the preset's own values",
};

export function createBanner(shell: Shell, controller: Controller, prefs: Prefs): () => void {
  const banner = el('div', 'banner');
  banner.hidden = true;
  banner.setAttribute('role', 'alert');
  shell.overlay.appendChild(banner);
  if (!prefs.welcomed) shell.overlay.appendChild(welcomeCard(prefs));

  /** Dismissed warnings, by id, for the run they were dismissed in. */
  const dismissed = new Set<string>();
  let dismissedRun = controller.runId;
  /** Which of the open warnings is on show, when there is more than one. */
  let index = 0;
  let shownKey = '';

  const render = (issues: Issue[]): void => {
    const issue = issues[index];
    banner.dataset.tone = issue.severity;
    banner.replaceChildren();

    const head = el('div', 'banner-head');
    const icon = el('span', 'banner-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = issue.severity === 'info' ? 'i' : '!';
    const title = el('strong', 'banner-title');
    title.textContent = issue.title;
    head.append(icon, title);
    if (issues.length > 1) {
      const more = el('button', 'text-button banner-count');
      more.type = 'button';
      more.textContent = `${index + 1} of ${issues.length} ›`;
      more.title = 'Next warning';
      more.addEventListener('click', () => {
        index = (index + 1) % issues.length;
        render(issues);
      });
      head.appendChild(more);
    }
    const close = el('button', 'icon-button banner-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss this warning');
    close.title = 'Dismiss (it comes back if you restart)';
    close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    close.addEventListener('click', () => {
      dismissed.add(issue.id);
      shownKey = '';
      refresh();
    });
    head.appendChild(close);

    const detail = el('p', 'banner-detail');
    detail.textContent = issue.detail;
    banner.append(head, detail);

    const suggestion = issue.fixes.includes('suggested') ? controller.suggestion() : null;
    const suggested = suggestion ? findPreset(suggestion.presetId) : undefined;
    if (suggestion && suggested) {
      const why = el('p', 'banner-suggestion');
      why.textContent = `Closest preset to your values: ${suggested.name}. ${suggestion.why}`;
      banner.appendChild(why);
    }

    const actions = el('div', 'banner-actions');
    let primary = true;
    for (const fix of issue.fixes) {
      if (fix === 'suggested' && !suggested) continue;
      if (fix === 'defaults' && !(controller.preset.params?.length && controller.custom)) continue;
      const action = el('button', primary ? 'banner-button primary' : 'banner-button');
      action.type = 'button';
      action.textContent = fix === 'suggested' && suggested ? `Try ${suggested.name}` : FIX_LABELS[fix as Exclude<Fix, 'suggested'>];
      action.addEventListener('click', () => {
        controller.applyFix(fix);
        shownKey = '';
        refresh();
      });
      actions.appendChild(action);
      primary = false;
    }
    if (issue.learn) {
      const learn = el('a', 'learn-link banner-learn');
      learn.href = learnHref(issue.learn);
      learn.textContent = 'Why does this happen? →';
      actions.appendChild(learn);
    }
    banner.appendChild(actions);
  };

  const refresh = (): void => {
    if (controller.runId !== dismissedRun) {
      dismissedRun = controller.runId;
      dismissed.clear();
    }
    const issues = controller.issues.filter((issue) => !dismissed.has(issue.id));
    banner.hidden = issues.length === 0;
    if (issues.length === 0) {
      shownKey = '';
      return;
    }
    // Rebuild only when the set changes: the text of some warnings (an energy error) moves every
    // tick, and redrawing under the pointer would swallow clicks.
    const key = `${controller.runId}|${issues.map((issue) => issue.id).join(',')}|${controller.custom}`;
    if (key === shownKey) return;
    if (!shownKey.startsWith(`${controller.runId}|`) || index >= issues.length) index = 0;
    shownKey = key;
    render(issues);
  };
  return refresh;
}

function welcomeCard(prefs: Prefs): HTMLElement {
  const card = el('div', 'welcome');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'Welcome');
  card.innerHTML =
    '<strong>New here?</strong>' +
    '<p>This sandbox runs two or three bodies under gravity with five different numerical methods, and shows where each one goes wrong. ' +
    'The Learn page explains it all in plain language, with links that open each idea right here.</p>';
  const actions = el('div', 'banner-actions');
  const learn = el('a', 'banner-button primary');
  learn.href = learnHref();
  learn.textContent = 'Open the Learn page';
  const dismiss = el('button', 'banner-button');
  dismiss.type = 'button';
  dismiss.textContent = 'Just explore';
  const done = (): void => {
    prefs.welcomed = true;
    savePrefs(prefs);
    card.remove();
  };
  learn.addEventListener('click', done);
  dismiss.addEventListener('click', done);
  actions.append(learn, dismiss);
  const hint = el('p', 'welcome-hint');
  hint.textContent = 'Drag to orbit, scroll to zoom. Space plays and pauses, C shows the charts, M the module panel, F the orbits alone.';
  card.append(actions, hint);
  return card;
}
