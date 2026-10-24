import { Euler } from './euler';
import { IAS15 } from './ias15';
import { Leapfrog } from './leapfrog';
import { RK4 } from './rk4';
import type { Integrator, IntegratorId } from './types';
import { WH } from './wh';

/** A new, uninitialized integrator. symplecticEuler picks the semi-implicit form of Euler and is ignored by the others. */
export function createIntegrator(id: IntegratorId, symplecticEuler = false): Integrator {
  switch (id) {
    case 'euler':
      return new Euler(symplecticEuler);
    case 'leapfrog':
      return new Leapfrog();
    case 'rk4':
      return new RK4();
    case 'wh':
      return new WH();
    case 'ias15':
      return new IAS15();
  }
}
