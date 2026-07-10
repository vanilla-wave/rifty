/**
 * Project-index mirror + boot decision — headless core extracted from App.tsx
 * (ADR-0197, epic playground-testable-core, slice 2). Owns the PAGE in-memory
 * mirror of the owner-published project index (ADR-0165 §3), the store-hydrate
 * flow (presence hint, editor-context readiness), the §56 eventually-consistent
 * on-disk delete tracking, and the ONE-SHOT boot decision (first-run chooser vs
 * reload restore) + the first-run launcher policy (deep link / presence hint /
 * degraded fallback beat).
 *
 * No UI imports; every side effect goes through the injected ports below —
 * the behavioral-test seam (ADR-0197 §4).
 */
import { createSignal, untrack } from 'solid-js';
import { needsProjectChoiceOnBoot } from '../glue/project-boot-policy.ts';
import type { ProjectIndex } from '../glue/project-index.ts';

/** Page mirror of the owner's index bridge (structural ProjectIndexMirror subset). */
export interface IndexMirrorPort {
  /** Observe each owner reply; may replay a buffered frame synchronously. */
  subscribe(cb: (index: ProjectIndex) => void): () => void;
  /** Ask the owner to re-publish (recovers a pre-listener push). */
  request(): Promise<void> | void;
  dispose(): void;
}

export interface ProjectIndexBootDeps {
  /** Fold a fresh owner publish into the store mirror (launcher list survives respawns). */
  hydrateIndex(idx: ProjectIndex): void;
  /** Keep the page-side presence hint current for the NEXT cold boot. */
  recordPresenceHint(idx: ProjectIndex): void;
  /** TRUE first run (no hint) opens the chooser instantly, not on the first publish. */
  hasPresenceHint(): boolean;
  /** Post the durable on-disk delete to the CURRENT owner (read the port at fire time). */
  postDeleteProjectTree(id: string): Promise<unknown>;
  /** Adopt the real pre-pick `/scratch` tree as an internal hidden-empty Scratch. */
  activateHiddenEmptyScratch(): Promise<ProjectIndex>;
  /** Open the launcher on the Starters tab (first-run chooser). */
  openLauncherOnStarters(): void;
  closeLauncher(): void;
  resetEditorInitialFiles(): void;
  /** Intent-gated warm of the lazy editor stack once a project context is likely. */
  warmEditorStack(): void;
  /** Reload restore (workspace-lifecycle port): re-root/adopt + relaunch. */
  restore(idx: ProjectIndex): void;
  /** `?preset=` deep-link auto-pick (bypasses the chooser). */
  pickDeepLinkStarter(id: string): void;
  /** Degraded-path beat: NO index at all within this window → surface the gallery. */
  firstRunFallbackMs?: number;
}

export interface ProjectIndexBoot {
  /** Latest owner-published index (null before the first publish). */
  projectIndex(): ProjectIndex | null;
  /** Gates EditorHost mount until a real project context exists. */
  editorProjectContextReady(): boolean;
  setEditorProjectContextReady(ready: boolean): void;
  /** A pick/deep-link pre-empts the boot decision (no chooser flash / restore). */
  markBootDecisionMade(): void;
  /** User closed the launcher — the boot decision is made. */
  closeLauncher(): void;
  openFirstRunLauncher(): void;
  /** §56: track + post an on-disk delete; re-fired on owner re-attach until confirmed. */
  recordOnDiskDelete(id: string): void;
  /**
   * (Re)bind the index mirror to the CURRENT owner: drop the previous bridge,
   * subscribe + request (handshake discipline), retry until the first reply,
   * and re-fire pending on-disk deletes (a post dropped during an owner respawn
   * reaches no listener — re-posting is idempotent, ADR-0165 §56). App calls
   * this from a one-line `createEffect` on the owner signal (ADR-0197 §1).
   */
  attachOwner(mirror: IndexMirrorPort): void;
  dispose(): void;
  /**
   * Boot policy (ADR-0165 project-first + deep link), run once from onMount:
   * deep link → auto-pick; no presence hint → chooser NOW; else index-driven
   * with a degraded fallback beat. Returns the fallback-timer cancel.
   */
  startBootPolicy(deepLinkStarterId: string | undefined): () => void;
}

const FIRST_RUN_LAUNCHER_FALLBACK_MS = 8_000;
const INDEX_REQUEST_RETRY_MS = 250;

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createProjectIndexBoot(deps: ProjectIndexBootDeps): ProjectIndexBoot {
  const [projectIndex, setProjectIndex] = createSignal<ProjectIndex | null>(null);
  const [editorProjectContextReady, setEditorProjectContextReady] = createSignal(false);
  let initialBootDecisionMade = false;
  let autoOpenedFirstRunLauncher = false;
  let firstRunDismissPending = false;
  let hiddenActivationInFlight = false;
  let editorWarmRequested = false;
  // §56 durable-delete tracking: posted but not yet confirmed by an owner
  // re-publish — cleared once the published index no longer lists the id.
  const pendingOnDiskDeletes = new Set<string>();

  let detachMirror: (() => void) | null = null;

  function openFirstRunLauncher(): void {
    autoOpenedFirstRunLauncher = true;
    deps.openLauncherOnStarters();
  }

  function closeLauncher(): void {
    const dismissesFirstRun = autoOpenedFirstRunLauncher && !editorProjectContextReady();
    autoOpenedFirstRunLauncher = false;
    deps.closeLauncher();
    if (!dismissesFirstRun) {
      initialBootDecisionMade = true;
      return;
    }

    // The chooser may paint before the owner's first index. Do not invent an
    // empty scratch yet: wait for the authoritative publish so a persisted
    // project/scratch can win and restore at its real owner root.
    firstRunDismissPending = true;
    const current = untrack(projectIndex);
    if (current !== null) continueFirstRunDismiss(current);
  }

  function warmEditorStack(): void {
    if (editorWarmRequested) return;
    editorWarmRequested = true;
    deps.warmEditorStack();
  }

  function foldIndex(idx: ProjectIndex): void {
    setProjectIndex(idx);
    deps.recordPresenceHint(idx);
    deps.hydrateIndex(idx);
    const wasReady = editorProjectContextReady();
    const ready = !needsProjectChoiceOnBoot(idx);
    if (ready) warmEditorStack();
    // Never let a stale/in-flight scratch:null publish RE-HIDE an editor already
    // shown: once the boot decision is made a needs-choice index is a lagging
    // owner mirror, not a real return to the chooser — flipping it false here
    // would unmount/remount EditorHost mid-pick (stale editorApi + TS-LS churn).
    if (ready || !initialBootDecisionMade) {
      setEditorProjectContextReady(ready);
    }
    if (ready && !wasReady) deps.resetEditorInitialFiles();
    // A durable delete is CONFIRMED once the published index no longer lists it.
    for (const id of pendingOnDiskDeletes) {
      if (!idx.projects.some((p) => p.id === id)) pendingOnDiskDeletes.delete(id);
    }
  }

  function finishFirstRunDismiss(idx: ProjectIndex): void {
    if (!firstRunDismissPending) return;
    firstRunDismissPending = false;
    initialBootDecisionMade = true;
    deps.restore(idx);
  }

  function startHiddenEmptyActivation(): void {
    if (!firstRunDismissPending || hiddenActivationInFlight) return;
    hiddenActivationInFlight = true;
    void deps.activateHiddenEmptyScratch().then(
      (idx) => {
        hiddenActivationInFlight = false;
        if (!firstRunDismissPending) return;
        foldIndex(idx);
        if (needsProjectChoiceOnBoot(idx)) {
          firstRunDismissPending = false;
          console.error('[project-index] hidden-empty activation returned a needs-choice index');
          openFirstRunLauncher();
          return;
        }
        finishFirstRunDismiss(idx);
      },
      (err: unknown) => {
        hiddenActivationInFlight = false;
        if (!firstRunDismissPending) return;
        firstRunDismissPending = false;
        console.error('[project-index] hidden-empty activation failed', err);
        openFirstRunLauncher();
      },
    );
  }

  function continueFirstRunDismiss(idx: ProjectIndex): void {
    if (!firstRunDismissPending) return;
    if (needsProjectChoiceOnBoot(idx)) startHiddenEmptyActivation();
    else finishFirstRunDismiss(idx);
  }

  function onIndexPublished(idx: ProjectIndex): void {
    foldIndex(idx);
    if (firstRunDismissPending) {
      continueFirstRunDismiss(idx);
      return;
    }
    // ONE-SHOT boot decision: first-run chooser on a needs-choice publish, else
    // close a flashed chooser and restore the persisted active project.
    if (!initialBootDecisionMade) {
      initialBootDecisionMade = true;
      if (needsProjectChoiceOnBoot(idx)) {
        openFirstRunLauncher();
        return;
      }
      if (autoOpenedFirstRunLauncher) {
        autoOpenedFirstRunLauncher = false;
        deps.closeLauncher();
      }
      deps.restore(idx);
    }
  }

  function attachOwner(mirror: IndexMirrorPort): void {
    // untrack: the publish flow reads signals (editorProjectContextReady) and a
    // buffered frame replays SYNCHRONOUSLY on subscribe — a caller's effect must
    // key on the OWNER signal alone (the attachOwner resubscribe-storm trap).
    untrack(() => {
      detachMirror?.();
      let sawIndexReply = false;
      const unsub = mirror.subscribe((idx) => {
        sawIndexReply = true;
        onIndexPublished(idx);
      });
      void mirror.request(); // owner re-publishes (recovers a pre-listener push)
      const retryRequest = setInterval(() => {
        if (!sawIndexReply) void mirror.request();
      }, INDEX_REQUEST_RETRY_MS);
      for (const id of pendingOnDiskDeletes) {
        void deps
          .postDeleteProjectTree(id)
          .catch((err: unknown) => console.error('[project-index] retry delete failed', err));
      }
      detachMirror = (): void => {
        clearInterval(retryRequest);
        unsub();
        mirror.dispose();
        detachMirror = null;
      };
    });
  }

  function recordOnDiskDelete(id: string): void {
    pendingOnDiskDeletes.add(id);
    void deps
      .postDeleteProjectTree(id)
      .catch((err: unknown) => console.error('[project-index] delete failed', err));
  }

  function startBootPolicy(deepLinkStarterId: string | undefined): () => void {
    if (deepLinkStarterId !== undefined) {
      // Pre-empt the chooser synchronously (the pick only flips this after its
      // awaits) so a fast owner index publish can't flash the first-run launcher.
      initialBootDecisionMade = true;
      deps.pickDeepLinkStarter(deepLinkStarterId);
      return () => {};
    }
    if (!deps.hasPresenceHint()) {
      // TRUE first run: open the chooser NOW — waiting for the first owner index
      // publish (~1.5-3s dev, more hosted) reads as a dead page. The publish
      // still arbitrates: needs-choice keeps it open; a stale hint closes it.
      openFirstRunLauncher();
      return () => {};
    }
    warmEditorStack();
    // Returning user: the chooser is INDEX-DRIVEN — the first publish decides.
    // The timer survives only as a degraded fallback: no index AT ALL within the
    // beat = owner boot is broken — surface the gallery rather than a blank IDE.
    const timer = setTimeout(() => {
      if (!initialBootDecisionMade && untrack(projectIndex) === null) openFirstRunLauncher();
    }, deps.firstRunFallbackMs ?? FIRST_RUN_LAUNCHER_FALLBACK_MS);
    return () => clearTimeout(timer);
  }

  return {
    projectIndex,
    editorProjectContextReady,
    setEditorProjectContextReady,
    markBootDecisionMade: () => {
      initialBootDecisionMade = true;
      firstRunDismissPending = false;
      autoOpenedFirstRunLauncher = false;
    },
    closeLauncher,
    openFirstRunLauncher,
    recordOnDiskDelete,
    attachOwner,
    dispose: () => detachMirror?.(),
    startBootPolicy,
  };
}
