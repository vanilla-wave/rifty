let editorStackWarm: Promise<unknown> | undefined;

export function warmEditorStack(): void {
  if (editorStackWarm !== undefined) return;
  editorStackWarm = Promise.all([
    import('../components/EditorHost.tsx'),
    import('../glue/ts-ls-monaco-providers.ts'),
  ]).catch((error: unknown) => {
    editorStackWarm = undefined;
    console.warn('[editor] lazy stack warm failed', error);
  });
}
