/**
 * Guarded owner file reads — shared by the workspace-files and SCM cores
 * (ADR-0197, epic playground-testable-core, slice 4). Every page-side byte read
 * goes to the LIVE owner (single store owner; the page holds no authoritative
 * fs) and re-asserts the owner did not die/respawn mid-read — a switch tearing
 * the owner down must fail the read loud, never serve stale bytes.
 */
import { basename } from '@riftydev/vfs';

export interface FileReadOwnerLike {
  readonly root: string;
  readonly snapshotPort: unknown;
  isAlive(): boolean;
  readFileBytes(path: string): Promise<Uint8Array>;
}

export interface OwnerFileReaderDeps<O extends FileReadOwnerLike> {
  currentOwner(): O;
  /** The non-isolated-host stub (ADR-0146) — never readable. */
  ownerUnavailable(owner: O): boolean;
}

export interface OwnerFileReader<O extends FileReadOwnerLike> {
  /** Throws when the owner is unavailable/dead or is no longer the live owner. */
  assertOwnerAlive(owner: O, path: string, action: string): void;
  /** Guarded read: asserts before AND after (owner change mid-read fails loud). */
  readBytes(owner: O, path: string, action: string): Promise<Uint8Array>;
}

export function createOwnerFileReader<O extends FileReadOwnerLike>(
  deps: OwnerFileReaderDeps<O>,
): OwnerFileReader<O> {
  function assertOwnerAlive(owner: O, path: string, action: string): void {
    const current = deps.currentOwner();
    if (deps.ownerUnavailable(owner) || !owner.isAlive()) {
      throw new Error(`workspace owner is unavailable — cannot ${action} ${basename(path)}`);
    }
    if (
      current !== owner ||
      current.root !== owner.root ||
      current.snapshotPort !== owner.snapshotPort
    ) {
      throw new Error(`workspace owner changed while ${action}ing ${basename(path)}`);
    }
  }

  async function readBytes(owner: O, path: string, action: string): Promise<Uint8Array> {
    assertOwnerAlive(owner, path, action);
    const bytes = await owner.readFileBytes(path);
    assertOwnerAlive(owner, path, action);
    return bytes;
  }

  return { assertOwnerAlive, readBytes };
}
