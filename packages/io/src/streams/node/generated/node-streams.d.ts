/** Node v24.16.0's stream core (generate-node-streams.mjs): Node's builtin loader over the bindings. */
export const PRIMORDIALS: readonly string[];
export const BINDINGS: readonly string[];
export const INTERNAL_BINDINGS: readonly string[];
export default function createNodeStreamCore(
  primordials: Readonly<Record<string, unknown>>,
  internalBinding: (id: string) => unknown,
  bind: (id: string) => unknown,
  process: object,
): (id: string) => unknown;
