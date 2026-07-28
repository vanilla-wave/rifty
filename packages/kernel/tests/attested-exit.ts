/**
 * Test doubles that stand in for the worker runtime must speak its trusted
 * protocol: an exit frame counts only when it carries the attestation minted
 * in the kernel-owned output state (guests share the worker-global channel and
 * cannot reproduce it). Building the frame from the captured `init` spec keeps
 * the doubles honest — a double that skipped the stamp would be claiming an
 * authority the real child has to prove.
 */
import type { WorkerExitMessage } from '../src/worker-entry.ts';
import { type WorkerOutputState, workerOutputAttestation } from '../src/worker-stdio-drain.ts';

interface PostingWorker {
  readonly posted: readonly unknown[];
}

function capturedOutputState(worker: PostingWorker): WorkerOutputState {
  const init = worker.posted[0] as { readonly spec?: { readonly outputState?: WorkerOutputState } };
  const state = init?.spec?.outputState;
  if (!state) throw new Error('fake worker never received an init spec');
  return state;
}

/** The exit frame the real worker runtime would post for `code`. */
export function attestedExit(worker: PostingWorker, code: number): WorkerExitMessage {
  return { type: 'exit', code, attestation: workerOutputAttestation(capturedOutputState(worker)) };
}

/** Same frame wrapped as the `MessageEvent` a spawned Worker delivers. */
export function attestedExitEvent(worker: PostingWorker, code: number): MessageEvent {
  return new MessageEvent('message', { data: attestedExit(worker, code) });
}
