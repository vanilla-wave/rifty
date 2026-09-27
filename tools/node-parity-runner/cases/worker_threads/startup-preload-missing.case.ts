import { workerStartupOptionsCases } from '../../../../tests/browser-unit/fixtures/worker-startup-options-cases.ts';
import type { ParityCase } from '../../src/types.ts';

const fixture = workerStartupOptionsCases[2]!;
const c: ParityCase = {
  kind: 'worker-env',
  cwd: '/scratch',
  setup: {
    files: Object.fromEntries(
      Object.entries(fixture.files).map(([path, source]) => [`scratch/${path}`, source]),
    ),
  },
  code: fixture.parent,
  expectedPhysicalWorkers: fixture.workers,
};
export default c;
