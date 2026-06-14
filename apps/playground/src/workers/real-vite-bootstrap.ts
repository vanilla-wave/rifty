/// <reference lib="webworker" />

import { runProjectWorker } from '@riftydev/workbench/project-worker';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

await runProjectWorker({ sqlWasmUrl });
