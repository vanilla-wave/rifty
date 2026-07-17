export type PlaygroundSidebarView = 'explorer' | 'presets' | 'scm';
export type PlaygroundSelectableSidebarView = Exclude<PlaygroundSidebarView, 'presets'>;

export interface PlaygroundSidebarViewOptions {
  readonly currentView: () => PlaygroundSidebarView;
  readonly sidebarCollapsed: () => boolean;
  readonly flushPendingWrites: () => Promise<unknown>;
  readonly refreshScm: () => Promise<unknown>;
  readonly selectView: (view: PlaygroundSelectableSidebarView) => void;
}

/** Preserve editor bytes before the status snapshot that reveals GIT. */
export async function selectPlaygroundSidebarView(
  view: PlaygroundSelectableSidebarView,
  options: PlaygroundSidebarViewOptions,
): Promise<void> {
  const willShow = options.currentView() !== view || options.sidebarCollapsed();
  if (view === 'scm' && willShow) {
    await options.flushPendingWrites();
    await options.refreshScm();
  }
  options.selectView(view);
}
