let activeProjectReady: Promise<void> = Promise.resolve();

/** Replace the owner-local barrier whenever the active project changes. */
export function setActiveProjectReady(ready: Promise<void>): void {
  activeProjectReady = ready;
}

/** Host-worker extensions await the same dependency barrier as terminal runs. */
export function waitForActiveProjectReady(): Promise<void> {
  return activeProjectReady;
}
