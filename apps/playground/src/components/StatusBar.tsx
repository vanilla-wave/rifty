/**
 * Status bar (ADR-0075) — a 24px VSCode-style strip. Carries the relocated
 * `[data-storage-badge]` (same attributes/tone/title) so the m0-boot selector
 * keeps passing; adds the mode, active file, language, and a COI dot.
 */
import { Show } from 'solid-js';
import type { Mode } from '../adapters/useMode.ts';
import { statusStorageChip } from '../glue/degraded-storage.ts';

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

      <span class="rf-status__spacer" />

      <span class="rf-status__item">{props.language}</span>
      <span class="rf-status__item rf-status__export" data-disabled="true" aria-disabled="true">
        Export <span class="rf-pill rf-pill--soon">soon</span>
      </span>
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
