import type { Controller } from '../../app/controller';
import type { PlaneMode, SnapView } from '../../render/frame';
import type { CameraMode, SceneView } from '../../render/scene';
import type { ModuleSpec } from '../shell';
import { learnLink, paneIn, setTitle } from './common';

// The View module (plan §7.6, §7.7): camera, the 3D aids, trails and body size. These edit
// view.settings directly, which SceneView reads every frame; only changes that need work (a new
// trail length) call into the view.

const FOCUS_OPTIONS: Record<string, CameraMode> = {
  'Free orbit': 'free',
  'Center of mass': 'com',
  'Co-rotating (about z)': 'corotating',
  'Body 1': 'body0',
  'Body 2': 'body1',
  'Body 3': 'body2',
};

const PLANE_OPTIONS: Record<string, PlaneMode> = {
  'z = 0': 'xy',
  'Perpendicular to L': 'angular',
};

const SNAP_VIEWS: [string, SnapView][] = [
  ['Top view', 'top'],
  ['Front view', 'front'],
  ['Side view', 'side'],
  ['Isometric view', 'iso'],
];

export function viewModule(controller: Controller, view: SceneView): ModuleSpec {
  return {
    id: 'view',
    title: 'View',
    summary: 'Camera, grid, drop lines, arrows and trails',
    shownByDefault: true,
    collapsedByDefault: true,
    build(body) {
      const settings = view.settings;
      const pane = paneIn(body);

      const camera = pane.addFolder({ title: 'Camera' });
      camera.addBinding(settings, 'cameraMode', { label: 'focus', options: FOCUS_OPTIONS });
      const frame = camera.addButton({ title: 'Frame all bodies' });
      frame.on('click', () => view.frameAll(controller.sim.state));
      setTitle(frame, 'Follow the center of mass and pull back until every body is in view.');
      for (const [title, snap] of SNAP_VIEWS) camera.addButton({ title }).on('click', () => view.snapCamera(snap));

      const space = pane.addFolder({ title: 'Space (3D)', expanded: false });
      setTitle(
        space.addBinding(settings, 'planeMode', { label: 'plane', options: PLANE_OPTIONS }),
        'The reference plane for the grid, drop lines and shadows. "Perpendicular to L" is the system\'s natural plane ' +
          '(the plane through the center of mass perpendicular to the angular momentum, which never moves). ' +
          'It falls back to z = 0 when the angular momentum is about zero.',
      );
      space.addBinding(settings, 'showGrid', { label: 'floor grid' });
      space.addBinding(settings, 'showWalls', { label: 'back walls' });
      setTitle(space.addBinding(settings, 'showDropLines', { label: 'drop lines' }), "A line from each body to the plane: its length is the body's height above it.");
      space.addBinding(settings, 'showShadows', { label: 'shadows' });
      space.addBinding(settings, 'showAxes', { label: 'axes' });
      setTitle(
        space.addBinding(settings, 'orthographic', { label: 'orthographic' }),
        'A very narrow field of view, which looks orthographic: parallel lines stay parallel and size does not change with depth. Good for reading heights off a front or side view.',
      );
      setTitle(space.addBinding(settings, 'tintTrails', { label: 'tint trails by z' }), 'Trails shift toward pink above the reference plane and toward blue below it.');
      setTitle(
        space.addBinding(settings, 'showVelocity', { label: 'velocity arrows' }),
        'Arrow lengths are logarithmic: a body ten times faster than the typical one is not drawn ten times as long.',
      );
      setTitle(space.addBinding(settings, 'showAcceleration', { label: 'accel. arrows' }), 'The pull on each body from the other two. Logarithmic lengths, like the velocity arrows.');

      const trails = pane.addFolder({ title: 'Trails', expanded: false });
      trails.addBinding(settings, 'showTrails', { label: 'show' });
      trails
        .addBinding(settings, 'trailLength', { label: 'length', min: 200, max: 20000, step: 100 })
        // Resizing reallocates, so wait for the end of a drag.
        .on('change', (event) => {
          if (event.last) view.setTrailLength(event.value);
        });
      trails.addBinding(settings, 'trailFade', { label: 'fade', min: 0, max: 6, step: 0.1 });
      setTitle(
        trails.addBinding(settings, 'trailFrame', { label: 'frame', options: { 'Follows focus': 'focus', World: 'world' } }),
        'Following a body, its trail is a point and the others trace their orbits about it. Changing the frame clears the trails.',
      );
      trails.addButton({ title: 'Clear trails' }).on('click', () => view.clearTrails());

      const display = pane.addFolder({ title: 'Display', expanded: false });
      setTitle(
        display.addBinding(settings, 'bodyScale', { label: 'body size', min: 0.25, max: 8, step: 0.05 }),
        'Displayed radius is proportional to m^(1/3), with a minimum size in pixels. It is not a physical radius.',
      );
      learnLink(body, 'Learn about the third dimension →', 'three-dimensions');
      return () => pane.refresh();
    },
  };
}
