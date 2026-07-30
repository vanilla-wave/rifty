import { parentPort, workerData } from 'node:worker_threads';
import { runInRiftyInCurrentRealm } from './run-in-rifty.ts';
import type { NodeCliEvalPreviewProbe, NodeCliEvalVfsProbe } from './run-in-rifty.ts';
import type { ParityCase } from './types.ts';

interface WorkerRequest {
  readonly testCase: ParityCase;
  readonly stdinTimeoutMs: number;
  readonly nodeCliEvalVfsProbe?: NodeCliEvalVfsProbe;
  readonly nodeCliEvalPreviewProbe?: NodeCliEvalPreviewProbe;
}

function serializeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: 'Error', message: String(error) };
}

if (parentPort === null) throw new Error('rifty parity Worker has no parent port');
const request = workerData as WorkerRequest;

try {
  const stdout = await runInRiftyInCurrentRealm(request.testCase, {
    stdinTimeoutMs: request.stdinTimeoutMs,
    nodeCliEvalVfsProbe: request.nodeCliEvalVfsProbe,
    nodeCliEvalPreviewProbe: request.nodeCliEvalPreviewProbe,
  });
  parentPort.postMessage({ ok: true, stdout });
} catch (error) {
  parentPort.postMessage({ ok: false, error: serializeError(error) });
}
