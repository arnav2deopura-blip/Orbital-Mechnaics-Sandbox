import type { BindingApi } from '@tweakpane/core';
import type { Controller } from '../../app/controller';
import { learnHref } from '../../app/router';
import { captureState, shareUrl } from '../../app/urlState';
import type { Preset } from '../../presets/schema';
import type { SceneView } from '../../render/scene';
import type { ModuleSpec } from '../shell';
import { el } from '../shell';
import { learnLink, paneIn, prose, REFRESH_MS, setTitle } from './common';

// The System module: what the loaded preset shows, its sliders (plan §8.1), and a link that
// restores the run (plan §7.8). The preset itself is chosen in the top bar.

export function systemModule(controller: Controller, view: SceneView): ModuleSpec {
  return {
    id: 'system',
    group: 'system',
    title: 'System',
    summary: 'What this preset shows, its sliders, and a link to this run',
    shownByDefault: true,
    build(body) {
      const name = el('h3', 'module-title');
      const about = prose(body);
      const checked = prose(body, '', 'module-meta');
      body.prepend(name);
      const learn = learnLink(body, 'Read about this preset →');

      const pane = paneIn(body);
      const params = pane.addFolder({ title: 'Parameters' });
      let sliders: BindingApi[] = [];
      let shown: Preset | null = null;

      const rebuild = (preset: Preset): void => {
        shown = preset;
        name.textContent = preset.name;
        about.textContent = preset.demonstrates;
        checked.textContent = preset.verified ? `Checked by a test: ${preset.verifiedBy ?? 'behaves as described'}.` : 'Not independently checked.';
        checked.classList.toggle('verified', preset.verified);
        learn.href = learnHref(`preset-${preset.id}`);
        for (const slider of sliders) slider.dispose();
        sliders = (preset.params ?? []).map((spec) => {
          const binding = params
            .addBinding(controller.params, spec.key, { label: spec.label, min: spec.min, max: spec.max, step: spec.step })
            // Loading restarts the run, so wait for the end of a drag.
            .on('change', (event) => {
              if (event.last) controller.applyParams();
            });
          setTitle(binding, spec.hint);
          return binding;
        });
        params.hidden = sliders.length === 0;
      };

      const link = { message: '' };
      const share = pane.addButton({ title: 'Copy link to this run' });
      share.on('click', () => {
        const url = shareUrl(captureState(controller, view), location.href);
        history.replaceState(null, '', url);
        if (!navigator.clipboard) {
          link.message = 'link is in the address bar';
          return;
        }
        navigator.clipboard.writeText(url).then(
          () => (link.message = 'link copied'),
          () => (link.message = 'link is in the address bar'),
        );
      });
      setTitle(share, 'Puts a link in the address bar and on the clipboard that restores the preset, its parameters, the method and settings, any edited bodies (z included) and the view.');
      pane.addBinding(link, 'message', { label: '', readonly: true, interval: REFRESH_MS });

      return () => {
        if (controller.preset !== shown) rebuild(controller.preset);
        pane.refresh();
      };
    },
  };
}
