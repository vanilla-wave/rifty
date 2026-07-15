interface CloseableProjectVfs {
  close(): Promise<void>;
}

export interface WorkbenchProjectCompositionOptions<Vfs extends CloseableProjectVfs, Runtime> {
  readonly createVfs: () => Vfs;
  readonly createRuntime: () => Runtime;
}

export interface WorkbenchProjectComposition<Vfs extends CloseableProjectVfs, Runtime> {
  readonly vfs: Vfs;
  readonly runtime: Runtime;
}

/** Runtime construction owns cleanup of the already-created Project VFS. */
export async function createWorkbenchProjectComposition<Vfs extends CloseableProjectVfs, Runtime>(
  options: WorkbenchProjectCompositionOptions<Vfs, Runtime>,
): Promise<WorkbenchProjectComposition<Vfs, Runtime>> {
  const vfs = options.createVfs();
  try {
    return Object.freeze({ vfs, runtime: options.createRuntime() });
  } catch (constructionError) {
    try {
      await vfs.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [constructionError, cleanupError],
        'Workbench project construction and VFS cleanup failed',
      );
    }
    throw constructionError;
  }
}
