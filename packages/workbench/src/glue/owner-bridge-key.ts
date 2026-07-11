export type OwnerBridgeKey = string | number;

export function ownerBridgeChannelUrl(host: string, key: OwnerBridgeKey): string {
  return `ws://${host}.local/__rfv/${encodeURIComponent(String(key))}`;
}
