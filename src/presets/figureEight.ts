import type { Preset } from './schema';

const PERIOD = 6.32591398;
const x1: [number, number, number] = [0.97000436, -0.24308753, 0];
const v3: [number, number, number] = [-0.93240737, -0.86473146, 0];

/** Plan §8.3: Chenciner & Montgomery figure-eight, G = 1, unit masses. */
export const FIGURE_EIGHT: Preset = {
  id: 'figure-eight',
  name: 'Figure-eight',
  tags: ['periodic', 'stable'],
  demonstrates: 'A famous periodic orbit: three equal masses chasing each other along one figure-eight curve.',
  units: 'nbody',
  G: 1,
  bodies: [
    { name: 'Body 1', m: 1, x: x1, v: [-v3[0] / 2, -v3[1] / 2, 0] },
    { name: 'Body 2', m: 1, x: [-x1[0], -x1[1], 0], v: [-v3[0] / 2, -v3[1] / 2, 0] },
    { name: 'Body 3', m: 1, x: [0, 0, 0], v: v3 },
  ],
  period: PERIOD,
  recommended: { integrator: 'leapfrog', dt: PERIOD / 4000 },
  source: 'Moore 1993, PRL 70, 3675; Chenciner & Montgomery 2000, Ann. Math. 152',
  verified: true,
  verifiedBy: 'returns to its start after one period to better than 1e-6 (IAS15 at 1e-12)',
};
