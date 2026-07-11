import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  flushOwnerDurable,
  gotoHarness,
  ownerLogs,
  readOwnerFile,
  writeOwnerFile,
} from './fixtures.ts';

const VFS_SNAPSHOT_PORT_URL = `/@fs${fileURLToPath(
  new URL('../../packages/workbench/src/glue/vfs-snapshot-port.ts', import.meta.url),
)}`;
const VFS_WRITE_PORT_URL = `/@fs${fileURLToPath(
  new URL('../../packages/workbench/src/glue/vfs-write-port.ts', import.meta.url),
)}`;

/**
 * Owner publish + persistence contracts against the REAL owner worker
 * (browser-unit lane, ADR-0196) — formerly source-grep-pinned:
 *   1. Every owner mutation refresh hook pushes a FRESH file snapshot: a
 *      vfs-write is followed by an unsolicited `snapshot` frame containing the
 *      new path (onVfsWrite → publishOwnerState → publishVfsSnapshot).
 *   2. The BroadcastChannel vfs-write bridge (serveVfsWrites) applies frames
 *      without the kernel-IPC ack path.
 *   3. The owner wires the OPFS backend (initBackend) and its tree survives an
 *      owner respawn of the same workspace.
 */

test('vfs-write pushes a fresh snapshot; BroadcastChannel write bridge applies frames', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, { workspaceId: 'bu-publish', hiddenEmptyBoot: true });

  const result = await page.evaluate(
    async ({ snapshotPortUrl, writePortUrl }) => {
      const w = window as unknown as {
        __buOwner: {
          snapshotPort: string | number;
          writeFrameAcked(frame: { type: 'write'; path: string; data: Uint8Array }): Promise<void>;
          readFileBytes(path: string): Promise<Uint8Array>;
        };
      };
      const handle = w.__buOwner;
      const snapshotPort = handle.snapshotPort;
      const [snapshotPortModule, vfsWritePort] = await Promise.all([
        import(snapshotPortUrl),
        import(writePortUrl),
      ]);

      // 1. Subscribe (passively — no snapshot-req), then mutate: the owner must
      //    PUSH a fresh snapshot frame carrying the new file.
      const pushed = new Promise<string[] | null>((resolve) => {
        const timer = setTimeout(() => {
          tear();
          resolve(null);
        }, 15_000);
        const tear = snapshotPortModule.subscribeVfsSnapshot(
          snapshotPort,
          (frame: { entries: readonly { path: string }[] }) => {
            const paths = frame.entries.map((e) => e.path);
            if (paths.includes('/scratch/push-probe.txt')) {
              clearTimeout(timer);
              tear();
              resolve(paths);
            }
          },
        );
      });
      await handle.writeFrameAcked({
        type: 'write',
        path: '/scratch/push-probe.txt',
        data: new TextEncoder().encode('push-probe'),
      });
      const pushedPaths = await pushed;

      // 2. BroadcastChannel write bridge (no ack, no kernel IPC): the frame must
      //    land in the owner tree, observable through readFileBytes.
      const bcContent = `bc-bridge-write ${Date.now().toString(36)}`;
      vfsWritePort.sendVfsWrite(snapshotPort, {
        type: 'write',
        path: '/scratch/bc-bridge.txt',
        data: new TextEncoder().encode(bcContent),
      });
      let bcReadBack: string | null = null;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          bcReadBack = new TextDecoder().decode(
            await handle.readFileBytes('/scratch/bc-bridge.txt'),
          );
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      return { pushedPaths, bcReadBack, bcContent };
    },
    { snapshotPortUrl: VFS_SNAPSHOT_PORT_URL, writePortUrl: VFS_WRITE_PORT_URL },
  );

  expect(result.pushedPaths).not.toBeNull();
  expect(result.pushedPaths).toContain('/scratch/push-probe.txt');
  expect(result.bcReadBack).toBe(result.bcContent);
});

test('hidden-empty owner stays hidden; OPFS tree survives an owner respawn', async ({ page }) => {
  await gotoHarness(page);
  await bootOwner(page, { workspaceId: 'bu-persist', hiddenEmptyBoot: true });

  // Hidden first-run boot: NO welcome README / starter seed (the launcher owns
  // the first pick) — the read must fail with a real owner error, not content.
  const readme = await readOwnerFile(page, '/scratch/README.md');
  expect(readme.ok).toBe(false);

  // OPFS backend wired before serving (initBackend) — owner log is the seam.
  expect(await ownerLogs(page)).toContain('VFS backend: opfs');

  const marker = `persist-probe ${Date.now().toString(36)}`;
  await writeOwnerFile(page, '/scratch/persist-probe.txt', marker);
  // Durability barrier (ADR-0187): the write ack only proves the in-memory
  // mirror; flushDurable drains the OPFS write-through and rejects on persist
  // failures — the respawn below reads from disk, deterministically.
  await flushOwnerDurable(page);
  await closeOwner(page);

  // Same workspace id → same OPFS scope: a respawned owner must see the file.
  await bootOwner(page, { workspaceId: 'bu-persist', hiddenEmptyBoot: true });
  const readBack = await readOwnerFile(page, '/scratch/persist-probe.txt');
  expect(readBack.ok).toBe(true);
  expect(readBack.text).toBe(marker);
});
