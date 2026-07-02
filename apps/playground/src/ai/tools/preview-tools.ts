/**
 * Preview tools (ADR-0190 tool surface, PASS 2): operate on the REAL
 * same-origin preview the user sees — `preview_fetch` via page `fetch`
 * against the SW-routed `/preview/<port>/…`, and `preview_query` /
 * `preview_click` / `preview_type` against the PreviewPanel iframe's DOM
 * (`frame.contentDocument`). No preview / not-committed frame → loud error.
 * Names + observable behavior are bench-measured (ADR-0191): DOM tools act on
 * the CURRENT document, no implicit waiting.
 */
// typebox comes via Pi's re-export (ADR-0190 decision) — never @sinclair/typebox.
import { Type } from '@earendil-works/pi-ai';
import type { AiAppContext } from '../app-context.ts';
import { type DefinedAiTool, cappedResult, defineAiTool } from './tool-def.ts';

const NO_PREVIEW =
  'no preview is running — start the dev server first (e.g. run `vite` or `npm run dev` in the shell)';

function committedPreviewDoc(ctx: AiAppContext): { doc: Document; win: Window } {
  const frame = ctx.preview.frame();
  if (!frame) throw new Error(NO_PREVIEW);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  // NOT a /preview/-path check: an SPA router may pushState the iframe URL to
  // '/' right after commit; only a never-navigated frame stays on about:blank.
  if (!win || !doc || doc.location.href === 'about:blank') {
    throw new Error(
      'the preview frame has not committed a document yet — wait for the dev server to serve, then retry',
    );
  }
  return { doc, win };
}

function activePreviewPort(ctx: AiAppContext, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const src = ctx.preview.frame()?.getAttribute('src') ?? '';
  const fromFrame = /^\/preview\/(\d+)\//.exec(src)?.[1];
  if (fromFrame !== undefined) return Number(fromFrame);
  const last = ctx.preview.ports().at(-1);
  if (last !== undefined) return last;
  throw new Error(NO_PREVIEW);
}

function queryAll(doc: Document, selector: string): Element[] {
  try {
    return [...doc.querySelectorAll(selector)];
  } catch (err) {
    throw new Error(`invalid CSS selector ${JSON.stringify(selector)} — ${(err as Error).message}`);
  }
}

function requireMatch(doc: Document, selector: string): Element {
  const first = queryAll(doc, selector)[0];
  if (!first) {
    throw new Error(`selector ${JSON.stringify(selector)} matched nothing in the preview document`);
  }
  return first;
}

/**
 * Set a value the framework can see: React tracks inputs through the native
 * value setter, so write via the FRAME realm's prototype descriptor, then
 * dispatch real `input`/`change` events from that realm.
 */
function setElementValue(win: Window, element: Element, text: string): string {
  const w = win as Window & typeof globalThis;
  const fire = (type: 'input' | 'change'): void => {
    element.dispatchEvent(new w.Event(type, { bubbles: true }));
  };
  if (element instanceof w.HTMLInputElement || element instanceof w.HTMLTextAreaElement) {
    const proto =
      element instanceof w.HTMLTextAreaElement
        ? w.HTMLTextAreaElement.prototype
        : w.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) throw new Error('preview_type: native value setter unavailable');
    setter.call(element, text);
    fire('input');
    fire('change');
    return element.tagName.toLowerCase();
  }
  if (element instanceof w.HTMLSelectElement) {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value')?.set;
    if (!setter) throw new Error('preview_type: native value setter unavailable');
    setter.call(element, text);
    fire('input');
    fire('change');
    return 'select';
  }
  if (element instanceof w.HTMLElement && element.isContentEditable) {
    element.textContent = text;
    fire('input');
    return 'contenteditable';
  }
  throw new Error(
    `preview_type: element <${element.tagName.toLowerCase()}> is not an input/textarea/select/contenteditable`,
  );
}

export function buildPreviewTools(ctx: AiAppContext): DefinedAiTool[] {
  const previewFetch = defineAiTool({
    name: 'preview_fetch',
    label: 'Preview fetch',
    snippet: 'HTTP GET against the running preview server',
    description:
      'Fetch a path from the running preview server (same-origin /preview/<port>/… route). ' +
      'Returns the status and the response body (capped at 16 KiB). A non-2xx status is a ' +
      'result, not an error. Fails when no preview server is running.',
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "Path to fetch, e.g. '/' or '/src/App.tsx'" }),
      ),
      port: Type.Optional(Type.Number({ description: 'Preview port (default: the visible one)' })),
    }),
    execute: async (params) => {
      const port = activePreviewPort(ctx, params.port);
      const rawPath = params.path ?? '/';
      const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      const url = `/preview/${port}${path}`;
      let response: Response;
      try {
        response = await fetch(url, { cache: 'no-store' });
      } catch (err) {
        throw new Error(`preview_fetch: GET ${url} failed — ${(err as Error).message}`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();
      return cappedResult(
        `${response.status} ${response.statusText}\ncontent-type: ${contentType}\n\n${body}`,
        { url, status: response.status, bytes: body.length },
      );
    },
  });

  const previewQuery = defineAiTool({
    name: 'preview_query',
    label: 'Preview query',
    snippet: 'querySelector against the live preview DOM',
    description:
      'Run a CSS selector against the visible preview iframe document. Returns the match ' +
      'count and the outerHTML of the first matches (capped). Operates on the CURRENT DOM — ' +
      'no waiting. Fails when no preview is running.',
    parameters: Type.Object({
      selector: Type.String({ description: 'CSS selector' }),
      limit: Type.Optional(Type.Number({ description: 'Max elements to print (default 3)' })),
    }),
    execute: (params) => {
      const { doc } = committedPreviewDoc(ctx);
      const matches = queryAll(doc, params.selector);
      const limit = Math.max(1, Math.floor(params.limit ?? 3));
      const shown = matches.slice(0, limit).map((el) => el.outerHTML);
      const body =
        matches.length === 0
          ? 'no matches'
          : `${matches.length} match(es)\n\n${shown.join('\n---\n')}`;
      return Promise.resolve(
        cappedResult(body, { selector: params.selector, count: matches.length }),
      );
    },
  });

  const previewClick = defineAiTool({
    name: 'preview_click',
    label: 'Preview click',
    snippet: 'click an element in the live preview',
    description:
      'Click the first element matching a CSS selector inside the visible preview iframe ' +
      '(real element click — bubbles through the app). Fails when the selector matches nothing.',
    parameters: Type.Object({
      selector: Type.String({ description: 'CSS selector of the element to click' }),
    }),
    execute: (params) => {
      const { doc, win } = committedPreviewDoc(ctx);
      const element = requireMatch(doc, params.selector);
      const w = win as Window & typeof globalThis;
      if (element instanceof w.HTMLElement) {
        element.click();
      } else {
        element.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      return Promise.resolve(
        cappedResult(`clicked ${params.selector} (<${element.tagName.toLowerCase()}>)`, {
          selector: params.selector,
        }),
      );
    },
  });

  const previewType = defineAiTool({
    name: 'preview_type',
    label: 'Preview type',
    snippet: 'type/set a value into a preview input',
    description:
      'Set the value of the first input/textarea/select/contenteditable matching a CSS ' +
      'selector inside the visible preview iframe, dispatching real input/change events ' +
      '(framework-visible). Fails on no match or a non-editable element.',
    parameters: Type.Object({
      selector: Type.String({ description: 'CSS selector of the input' }),
      text: Type.String({ description: 'Value to set' }),
    }),
    execute: (params) => {
      const { doc, win } = committedPreviewDoc(ctx);
      const element = requireMatch(doc, params.selector);
      const kind = setElementValue(win, element, params.text);
      return Promise.resolve(
        cappedResult(`typed into ${params.selector} (<${kind}>): ${params.text}`, {
          selector: params.selector,
        }),
      );
    },
  });

  return [previewFetch, previewQuery, previewClick, previewType];
}
