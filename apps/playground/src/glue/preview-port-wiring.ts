import { bridgeCrossRealmPreview, registerPort, unregisterPort } from '@riftydev/net';
import { mountPlaygroundPreviewBridge } from './preview-bridge-wiring.ts';

/**
 * Mount one page-side SW → cross-realm preview route. The owner token selects
 * the current page registration; preview scope selects the exact child server.
 * Teardown revokes every hop so a reused port cannot reach a retired project.
 */
export function wirePreviewBridge(
  port: number,
  ownerToken: string,
  previewScope?: string,
): () => void {
  const previewBridge = bridgeCrossRealmPreview(
    port,
    previewScope === undefined ? {} : { scope: previewScope },
  );
  registerPort(port, previewBridge);
  const tearSwBridge = mountPlaygroundPreviewBridge(previewBridge, {
    ownerToken,
    ports: [port],
  });
  return (): void => {
    tearSwBridge();
    unregisterPort(port);
    previewBridge.dispose();
  };
}
