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
 *
 * The file explorer (ADR-0075) can open `.json` / `.css` / `.html` files, so we
 * wire their language-service workers too — otherwise those labels would fall
 * to the generic editor worker (wrong proxy) and throw on validation.
 */
import type * as monaco from 'monaco-editor';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

(globalThis as typeof globalThis & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    // The TypeScript worker covers both 'javascript' and 'typescript'; json /
    // css / html get their own services; everything else (core editor
    // services) uses the generic editor worker.
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      default:
        return new EditorWorker();
    }
  },
};
