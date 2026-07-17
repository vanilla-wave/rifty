/**
 * Degraded-path derivations (ADR-0165 §8). Storage mode comes from the REAL
 * one-time BootResult probe (detectVfsBackend + persistence), NOT a manual
 * opfs↔memory toggle. Two distinct gates: the COI hard-assert is fatal and
 * never reaches here; this module owns ONLY the memory-backend degraded path.
 * Pure (no DOM, no solid-js) so it is unit-testable and shared by the status
 * bar badge and the save-flow toast (one source — a memory save can never
 * render identically to a durable one).
 */
import type { BootResult } from '../boot.ts';

export type StorageMode = 'opfs' | 'memory';

/** Degraded iff the chosen backend is memory. Best-effort OPFS keeps its own badge. */
export function storageModeFromBoot(boot: BootResult): StorageMode {
  return boot.vfsBoot.backend === 'memory' ? 'memory' : 'opfs';
}

export interface BannerGate {
  readonly storage: StorageMode;
  readonly bannerDismissed: boolean;
  readonly launcherOpen: boolean;
}

/** Banner shows ONLY in memory mode, undismissed, with the launcher closed. */
export function degradedBannerVisible(gate: BannerGate): boolean {
  return gate.storage === 'memory' && !gate.bannerDismissed && !gate.launcherOpen;
}

export interface SaveAffordance {
  readonly label: string;
  readonly badge: 'EPHEMERAL' | 'UNSAVED';
  readonly tone: 'ok' | 'warn';
  readonly ephemeral: boolean;
}

/** Memory saves are EPHEMERAL; OPFS saves are durable. Never collapse the two. */
export function saveAffordance(storage: StorageMode): SaveAffordance {
  return storage === 'memory'
    ? { label: 'EPHEMERAL', badge: 'EPHEMERAL', tone: 'warn', ephemeral: true }
    : { label: 'Saved', badge: 'UNSAVED', tone: 'ok', ephemeral: false };
}

/** Cmd/Ctrl+S acknowledgement must expose whether bytes survive this session. */
export function workspaceSaveMessage(storage: StorageMode): string {
  return storage === 'memory' ? 'Saved for this session · EPHEMERAL' : 'Saved';
}

export interface StorageChip {
  readonly label: string;
  readonly tone: 'ok' | 'warn';
  readonly icon: 'database' | 'triangle-exclamation-fill';
}

export function statusStorageChip(storage: StorageMode): StorageChip {
  return storage === 'memory'
    ? { label: 'Memory · session only', tone: 'warn', icon: 'triangle-exclamation-fill' }
    : { label: 'OPFS · persisted', tone: 'ok', icon: 'database' };
}
