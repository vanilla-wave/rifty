export interface PlaygroundSaveOptions {
  readonly flushPendingEditorWrites: () => Promise<unknown>;
  readonly flushOwnerDurability: () => Promise<unknown>;
  readonly isCurrent: () => boolean;
  readonly reportSaved: () => void;
  readonly reportFailure: (error: unknown) => void;
}

/** Publish user-visible success only after the active storage backend settles. */
export async function savePlaygroundSession(options: PlaygroundSaveOptions): Promise<void> {
  try {
    await options.flushPendingEditorWrites();
    await options.flushOwnerDurability();
    if (options.isCurrent()) options.reportSaved();
  } catch (error) {
    if (options.isCurrent()) options.reportFailure(error);
  }
}
