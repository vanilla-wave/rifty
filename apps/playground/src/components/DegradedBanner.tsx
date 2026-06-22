/**
 * Degraded banner (ADR-0165 §8) — honest-loud "persistence off" notice anchored
 * above the status bar. The PARENT gates mount via degradedBannerVisible(...);
 * this component renders the inner surface only. Distinct from the fatal COI
 * banner (which never reaches the UI).
 */
import { Icon } from './icons.tsx';

export function DegradedBanner(props: {
  onReEnable: () => void;
  onDismiss: () => void;
}) {
  return (
    <div class="rf-banner rf-banner--degraded" role="status" data-banner="degraded">
      <span class="rf-banner--degraded__ico" aria-hidden="true">
        <Icon name="triangle-exclamation-fill" size={17} />
      </span>
      <span class="rf-banner--degraded__body">
        <span class="rf-banner--degraded__title">Persistence is off — this session only</span>
        <span class="rf-banner--degraded__msg">
          OPFS isn't available, so projects and scratch live in memory and vanish when the tab
          closes. Saving still works for the session.
        </span>
      </span>
      <button
        type="button"
        class="rf-btn rf-btn--warn-ghost"
        data-action="reenable-storage"
        onClick={() => props.onReEnable()}
      >
        Re-enable
      </button>
      <button
        type="button"
        class="rf-iconbtn"
        data-action="dismiss-degraded"
        aria-label="Dismiss"
        onClick={() => props.onDismiss()}
      >
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}
