/**
 * Monaco web-worker wiring for Vite.
 *
 * Without `MonacoEnvironment.getWorker`, monaco-editor cannot spawn its
 * language-service workers: it falls back to a main-thread shim and the
 * TypeScript diagnostics adapter then throws `Cannot read properties of
 * undefined (reading 'toUrl')` on every validation pass — spamming the
 * console even though the editor stays usable. Providing real workers (bundled
 * by Vite's `?worker` suffix) removes that noise and moves syntax/diagnostics
 * off the UI thread.
 *
 * Side-effect module: import it once before the first `monaco.editor.create`.
 * monaco-editor declares `MonacoEnvironment` as an ambient global `let`, so we
 * assign through a typed `globalThis` cast (a strict-mode module can't write a
 * bare ambient identifier, and `let` globals aren't typed on `globalThis`).
 */
import type * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

(globalThis as typeof globalThis & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    // The playground only edits JavaScript, so the TypeScript worker covers
    // both 'javascript' and 'typescript' labels; everything else (core editor
    // services) uses the generic editor worker.
    if (label === 'typescript' || label === 'javascript') {
      return new TsWorker();
    }
    return new EditorWorker();
  },
};
