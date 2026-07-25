/// <reference lib="webworker" />

import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { runWorkbenchOwner } from './workbench-owner-runtime.ts';
import { installBundleLocalBuffer, installRuntimeGlobals } from './worker-runtime-globals.ts';

registerNetBuiltins();
registerSqliteBuiltin();

const ipc = installRuntimeGlobals();
installBundleLocalBuffer();
setProcessCwd('/');
await runWorkbenchOwner(ipc);
