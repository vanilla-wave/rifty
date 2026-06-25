import type { OwnerBridgeKey } from './owner-bridge-key.ts';

const OWNER_BRIDGE_KEY_FIELD = 'ownerBridgeKey';

export function stampTsLspOwner(message: unknown, key: OwnerBridgeKey): unknown {
  if (!message || typeof message !== 'object') return message;
  return { ...message, [OWNER_BRIDGE_KEY_FIELD]: String(key) };
}

export function tsLspOwnerMatches(message: unknown, key: OwnerBridgeKey): boolean {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as { readonly ownerBridgeKey?: unknown }).ownerBridgeKey === String(key)
  );
}
