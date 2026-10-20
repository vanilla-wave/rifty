import { registerNetBuiltins } from '@riftydev/net/register-builtins';
/// <reference lib="webworker" />
import { NO_COI_CHILD_NAME, installNoCoiChildWorker } from '@riftydev/runtime-js/internal';

declare const self: DedicatedWorkerGlobalScope;
registerNetBuiltins();
if (self.name === NO_COI_CHILD_NAME) installNoCoiChildWorker();
else void import('./no-coi-toolchain-owner.ts');
