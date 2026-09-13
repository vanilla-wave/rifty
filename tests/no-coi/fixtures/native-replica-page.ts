import type { Page } from '@playwright/test';
import {
  nativeReplicaEntries,
  nativeSegmentRecords,
  nativeWriteBytes,
  observeNativeReplicaWrites,
} from '../../browser-unit/fixtures/native-replica-observer.ts';

// Runtime console evaluation cannot import the browser fixture through its guest VFS.
export const nativeReplicaProbeSource = [
  nativeWriteBytes,
  nativeSegmentRecords,
  nativeReplicaEntries,
  observeNativeReplicaWrites,
]
  .map((fn) => fn.toString())
  .join('\n');

/** Independent native HEAD/segment custody; never read the owner's live mirror. */
export function nativeReplicaTree(page: Page, namespace?: string, prefix = '') {
  return page.evaluate(
    async ({ url, namespace, prefix }) => {
      const { nativeReplicaEntries } = await import(/* @vite-ignore */ url);
      let root = await navigator.storage.getDirectory();
      if (namespace !== undefined) root = await root.getDirectoryHandle(namespace);
      const records = await nativeReplicaEntries(root);
      const result: { path: string; sha256: string }[] = [];
      for (const record of records.values()) {
        if (record.kind !== 'file' || !record.path.startsWith(`${prefix}/`)) continue;
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', record.bytes));
        result.push({
          path: record.path,
          sha256: [...digest].map((n) => n.toString(16).padStart(2, '0')).join(''),
        });
      }
      return result.toSorted((a, b) => a.path.localeCompare(b.path));
    },
    {
      url: `/@fs${process.cwd().replaceAll('\\', '/')}/tests/browser-unit/fixtures/native-replica-observer.ts`,
      namespace,
      prefix,
    },
  );
}
