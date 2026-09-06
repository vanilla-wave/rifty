import {
  type PortRegistrationOwner,
  isPortRegisteredBy,
  listPorts,
  onRegistryChange,
} from '@riftydev/net';
import { createNetBuiltinOverrides } from '@riftydev/net/register-builtins';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { riftyProcess, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { createModuleLoaderWithBuiltinOverrides } from '@riftydev/runtime-js/internal';
import type { FsSync } from '@riftydev/vfs';

export interface ResidentNodeEntryInput {
  readonly vfs: FsSync;
  readonly cwd: string;
  readonly entryPath: string;
  readonly args: readonly string[];
  readonly requestedPort: number;
  readonly timeoutMs?: number;
}

export interface StartedResidentNodeEntry {
  readonly port: number;
  readonly completion: Promise<void>;
}

function portInUseError(port: number): Error {
  const error = new Error(`resident port ${port} is already in use`);
  Object.assign(error, { code: 'EADDRINUSE' });
  return error;
}

function portOwnershipError(port: number, live = false): Error {
  const error = new Error(
    live
      ? `resident port ${port} is not live for the selected installed bin`
      : `resident port ${port} was not registered by the selected installed bin`,
  );
  error.name = 'SandboxResidentPortOwnershipError';
  return error;
}

async function waitForLivePort(
  port: number,
  owner: PortRegistrationOwner,
  completion: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let unsubscribe: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      unsubscribe = onRegistryChange((changed, action, registeredOwner) => {
        if (action !== 'register' || changed !== port) return;
        if (registeredOwner === owner) resolve();
        else reject(portOwnershipError(port));
      });
      timer = setTimeout(
        () =>
          reject(new Error(`resident bin did not listen on port ${port} within ${timeoutMs}ms`)),
        timeoutMs,
      );
      void completion.catch(reject);
      if (isPortRegisteredBy(port, owner)) resolve();
      else if (listPorts().includes(port)) reject(portOwnershipError(port));
    });
    await Promise.resolve();
    if (!isPortRegisteredBy(port, owner)) throw portOwnershipError(port, true);
  } finally {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Own entry execution, causal port registration and live readiness settlement. */
export async function startResidentNodeEntry(
  input: ResidentNodeEntryInput,
): Promise<StartedResidentNodeEntry> {
  if (listPorts().includes(input.requestedPort)) {
    throw portInUseError(input.requestedPort);
  }
  const owner = Symbol('toolchain resident bin');
  const builtinOverrides = createNetBuiltinOverrides(owner);
  const process = riftyProcess as unknown as { argv: string[]; exitCode?: number };
  process.argv = ['node', input.entryPath, ...input.args];
  process.exitCode = undefined;
  setProcessCwd(input.cwd);
  const completion = runNodeEntry({
    vfs: input.vfs,
    entryPath: input.entryPath,
    cwd: input.cwd,
    bin: true,
    createLoader: (vfs, options) =>
      createModuleLoaderWithBuiltinOverrides(vfs, options, builtinOverrides),
  });
  await waitForLivePort(input.requestedPort, owner, completion, input.timeoutMs ?? 10_000);
  return { port: input.requestedPort, completion };
}
