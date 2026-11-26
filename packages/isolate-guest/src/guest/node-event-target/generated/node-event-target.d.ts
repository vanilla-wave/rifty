/** Node v24.16.0 `internal/event_target` and `internal/abort_controller` module exports over the
 * given bindings (generate-node-event-target.mjs). */
export default function createNodeEventTarget(
  primordials: Readonly<Record<string, unknown>>,
  internalBinding: (id: string) => unknown,
  bind: (id: string) => unknown,
  process: unknown,
): {
  readonly eventTarget: Readonly<Record<string, unknown>>;
  readonly abortController: Readonly<Record<string, unknown>>;
};
