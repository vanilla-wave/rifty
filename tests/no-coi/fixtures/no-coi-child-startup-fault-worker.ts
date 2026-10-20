/// <reference lib="webworker" />
import { NO_COI_CHILD_NAME } from '@riftydev/runtime-js/internal';

declare const self: DedicatedWorkerGlobalScope;
if (self.name === NO_COI_CHILD_NAME) throw new Error('child-startup-failure');
void import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
