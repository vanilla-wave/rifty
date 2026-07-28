interface NodeProcessBootstrapIdentity {
  readonly pid: number;
  readonly ppid: number;
}

export interface ActiveNodeProcessBootstrap {
  readonly process: object;
  readonly identity: NodeProcessBootstrapIdentity | null;
  readonly federated: boolean;
}

const identities = new WeakMap<object, NodeProcessBootstrapIdentity>();
let activeProcess: object | null = null;
let activeProcessFederated = false;

export function attachNodeProcessBootstrapIdentity(
  process: object,
  identity: NodeProcessBootstrapIdentity,
): void {
  identities.set(process, Object.freeze({ pid: identity.pid, ppid: identity.ppid }));
}

export function readNodeProcessBootstrapIdentity(
  process: object,
): NodeProcessBootstrapIdentity | null {
  return identities.get(process) ?? null;
}

/** Runtime-owned realm binding; guest replacement of globalThis.process cannot replace it. */
export function setActiveNodeProcessBootstrap(process: object | null, federated = false): void {
  activeProcess = process;
  activeProcessFederated = process === null ? false : federated;
}

export function readActiveNodeProcessBootstrap(): ActiveNodeProcessBootstrap | null {
  if (activeProcess === null) return null;
  return {
    process: activeProcess,
    identity: readNodeProcessBootstrapIdentity(activeProcess),
    federated: activeProcessFederated,
  };
}
