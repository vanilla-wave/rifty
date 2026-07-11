import { statusStorageChip } from '@riftydev/workbench';
/**
 * Status bar (ADR-0075) — a 24px VSCode-style strip. Carries the relocated
 * `[data-storage-badge]` (same attributes/tone/title) so the m0-boot selector
 * keeps passing; adds the mode, active file, language, and a COI dot.
 */
import { Show } from 'solid-js';
import type { Mode } from '../adapters/useMode.ts';

export function StatusBar(props: {
  mode: Mode;
  modeLabel: string;
  activeFile: string;
  language: string;
  isOpfs: boolean;
  storageMode?: 'opfs' | 'memory';
  storagePersisted?: boolean;
  storageUsage?: number;
  storageQuota?: number;
  storageReason?: string;
  coi: boolean;
  activeName?: string;
  activeStarter?: string;
  dirty?: boolean;
  /** Click handler for the Export button (downloads the workspace archive). */
  onExport?: () => void;
  /** Disable Export (e.g. while the dev server is running). */
  exportDisabled?: boolean;
  /** Tooltip explaining what Export does / why it is disabled. */
  exportTitle?: string;
  gitBranch?: string;
}) {
  const memory = (): boolean => props.storageMode === 'memory' || !props.isOpfs;
  const storageLabel = (): string => {
    if (memory()) return statusStorageChip('memory').label; // 'Memory · session only'
    if (props.storagePersisted === undefined) return 'OPFS · unknown';
    if (props.storagePersisted === false) return 'OPFS · best effort';
    return 'OPFS · persisted';
  };
  const storageTone = (): 'ok' | 'warn' =>
    !memory() && props.storagePersisted === true ? 'ok' : 'warn';
  const storageTitle = (): string => {
    if (props.storageReason) return props.storageReason;
    if (props.storageUsage !== undefined && props.storageQuota !== undefined) {
      return `${props.storageUsage} / ${props.storageQuota} bytes`;
    }
    return '';
  };

  return (
    <footer class="rf-statusbar" data-storage-mode={memory() ? 'memory' : 'opfs'}>
      <Show when={props.activeName}>
        <span class="rf-status__item rf-status__project">
          {props.activeName}
          <Show when={props.activeStarter}>
            <span class="rf-status__starter"> · {props.activeStarter}</span>
          </Show>
        </span>
      </Show>
      <Show when={props.dirty}>
        <span class="rf-status__unsaved" data-ephemeral={!props.isOpfs}>
          {props.isOpfs ? 'UNSAVED' : 'EPHEMERAL'}
        </span>
      </Show>
      <span class="rf-status__item rf-status__mode" data-mode={props.mode}>
        <span class="rf-status__dot" />
        {props.modeLabel}
      </span>
      <span class="rf-status__item rf-status__file" title={props.activeFile}>
        {props.activeFile}
      </span>
      <Show when={props.gitBranch}>
        {(branch) => (
          <span class="rf-status__item rf-status__branch" title="rifty-git branch">
            {branch()}
          </span>
        )}
      </Show>

      <span class="rf-status__spacer" />

      <span class="rf-status__item">{props.language}</span>
      <button
        type="button"
        class="rf-status__item rf-status__export"
        onClick={() => props.onExport?.()}
        disabled={props.exportDisabled}
        title={props.exportTitle}
      >
        Export
      </button>
      <span
        class="rf-status__item rf-status__badge"
        data-storage-badge
        data-tone={storageTone()}
        title={storageTitle()}
      >
        <span class="rf-status__dot" />
        {storageLabel()}
      </span>
      <span
        class="rf-status__item rf-status__coi"
        data-coi={props.coi}
        title={props.coi ? 'Cross-origin isolated' : 'Not cross-origin isolated'}
      >
        <span class="rf-status__dot" />
        COI
      </span>
    </footer>
  );
}
