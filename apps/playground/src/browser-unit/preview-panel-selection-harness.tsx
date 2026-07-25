/**
 * Browser-unit harness (ADR-0196): mounts the REAL PreviewPanel under the
 * client Solid runtime so the selection-reconcile createEffect actually runs
 * (the vitest lane renders the SERVER runtime — effects no-op there). Module
 * state persists across page.evaluate() imports (vite module cache), so specs
 * mount once and drive successive registry snapshots via publish.
 */
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { PreviewPanel, type PreviewPanelEntry } from '../components/PreviewPanel.tsx';

let publishPorts: ((entries: readonly PreviewPanelEntry[]) => void) | null = null;

export function mountPreviewPanelSelectionHarness(root: HTMLElement): void {
  const [ports, setPorts] = createSignal<readonly PreviewPanelEntry[]>([]);
  render(() => PreviewPanel({ ports }), root);
  publishPorts = setPorts;
}

/** One owner-registry snapshot, in registry order [dev-server, preview, node]. */
export function publishPreviewPanelPorts(entries: readonly PreviewPanelEntry[]): void {
  if (!publishPorts) throw new Error('preview-panel harness not mounted');
  publishPorts(entries);
}
