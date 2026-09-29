/**
 * Default JSON fork IPC on the Worker route: top-level `send()` refusals in
 * the parent and the child carry Node's `Received …` text (ADR-0448).
 */
import type { ParityCase } from '../../src/types.ts';
import { JSON_REFUSAL_CODE, JSON_REFUSAL_FILES } from './json-ipc-refusal-program.ts';

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: { files: JSON_REFUSAL_FILES },
  code: JSON_REFUSAL_CODE,
};

export default c;
