import { Pane } from 'tweakpane';
import type { CameraMode, SceneView } from '../render/scene';

// tweakpane@4.0.5's typings extend FolderApi from @tweakpane/core, which it does not install, so
// `Pane` has no folder methods as far as TypeScript can tell, though the runtime API is intact.
// This types the slice used here. Installing @tweakpane/core as a dev dependency would make it
// redundant.
interface BindingApi {
  readonly element: HTMLElement;
  on(event: 'change', handler: (event: { value: number; last: boolean }) => void): BindingApi;
}
interface FolderApi {
  addFolder(params: { title: string; expanded?: boolean }): FolderApi;
  addBinding(target: object, key: string, params?: Record<string, unknown>): BindingApi;
  addButton(params: { title: string }): { on(event: 'click', handler: () => void): void };
}

const FOCUS_OPTIONS: Record<string, CameraMode> = {
  'Free orbit': 'free',
  'Center of mass': 'com',
  'Body 1': 'body0',
  'Body 2': 'body1',
  'Body 3': 'body2',
};

/**
 * The view controls (plan §7.1, §7.6): camera focus, trails, grid, body size and a small
 * performance readout. The bindings edit view.settings directly, which SceneView reads every
 * frame; only changes that need work (a new trail length) call into the view.
 */
export function createViewPanel(view: SceneView, container?: HTMLElement): Pane {
  const pane = new Pane({ title: 'View', container }) as Pane & FolderApi;
  const settings = view.settings;

  const camera = pane.addFolder({ title: 'Camera' });
  camera.addBinding(settings, 'cameraMode', { label: 'focus', options: FOCUS_OPTIONS });

  const trails = pane.addFolder({ title: 'Trails' });
  trails.addBinding(settings, 'showTrails', { label: 'show' });
  trails
    .addBinding(settings, 'trailLength', { label: 'length', min: 200, max: 20000, step: 100 })
    // Resizing reallocates, so wait for the end of a drag.
    .on('change', (event) => {
      if (event.last) view.setTrailLength(event.value);
    });
  trails.addBinding(settings, 'trailFade', { label: 'fade', min: 0, max: 6, step: 0.1 });
  trails.addButton({ title: 'Clear trails' }).on('click', () => view.clearTrails());

  const display = pane.addFolder({ title: 'Display' });
  display.addBinding(settings, 'showGrid', { label: 'grid' });
  const bodySize = display.addBinding(settings, 'bodyScale', { label: 'body size', min: 0.25, max: 8, step: 0.05 });
  bodySize.element.title =
    'Displayed radius is proportional to m^(1/3), with a minimum size in pixels. It is not a physical radius.';

  const perf = pane.addFolder({ title: 'Performance', expanded: false });
  perf.addBinding(view.stats, 'fps', { readonly: true, interval: 250, view: 'graph', min: 0, max: 144 });
  perf.addBinding(view.stats, 'frameMs', {
    label: 'frame ms',
    readonly: true,
    interval: 250,
    format: (value: number) => value.toFixed(1),
  });
  perf.addBinding(view.stats, 'renderMs', {
    label: 'render ms',
    readonly: true,
    interval: 250,
    format: (value: number) => value.toFixed(2),
  });

  return pane;
}
