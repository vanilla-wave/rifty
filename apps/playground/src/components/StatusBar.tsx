/**
 * Status bar (ADR-0075) — a 24px VSCode-style strip. Carries the relocated
 * `[data-storage-badge]` (same attributes/tone/title) so the m0-boot selector
 * keeps passing; adds the mode, active file, language, and a COI dot.
 */
import type { Mode } from '../adapters/useMode.ts';

export function StatusBar(props: {
  mode: Mode;
  modeLabel: string;
  activeFile: string;
  language: string;
  isOpfs: boolean;
  storageReason?: string;
  coi: boolean;
}) {
  return (
    <footer class="rf-statusbar">
      <span class="rf-status__item rf-status__mode" data-mode={props.mode}>
        <span class="rf-status__dot" />
        {props.modeLabel}
      </span>
      <span class="rf-status__item rf-status__file" title={props.activeFile}>
        {props.activeFile}
      </span>

      <span class="rf-status__spacer" />

      <span class="rf-status__item">{props.language}</span>
      <span
        class="rf-status__item rf-status__badge"
        data-storage-badge
        data-tone={props.isOpfs ? 'ok' : 'warn'}
        title={props.storageReason ?? ''}
      >
        <span class="rf-status__dot" />
        {props.isOpfs ? 'OPFS · persisted' : 'in-memory'}
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
