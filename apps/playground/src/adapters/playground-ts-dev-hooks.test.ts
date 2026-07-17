import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorApi } from '../components/editor-host-core.ts';
import type { TsLanguageServiceProvidersHandle } from '../glue/ts-ls-monaco-providers.ts';
import { installPlaygroundTsDevHooks } from './playground-ts-dev-hooks.ts';

const HOOK_KEYS = [
  '__riftyTsHover',
  '__riftyTsDefinition',
  '__riftyTsCompletions',
  '__riftyTsCompletionItems',
  '__riftyTsReferences',
  '__riftyTsPrepareRename',
  '__riftyTsRenameEdits',
  '__riftyTsSignatureHelp',
  '__riftyTsCodeFixes',
  '__riftyTsOrganizeImports',
  '__riftyTsFormat',
  '__riftyTsRangeSemanticTokenCount',
  '__riftyTsReinit',
] as const;

const globals = globalThis as unknown as Record<string, unknown>;

function fakeEditorApi(): EditorApi {
  return Object.freeze({ monaco: Object.freeze({}) }) as unknown as EditorApi;
}

function fakeProviders(): TsLanguageServiceProvidersHandle {
  return Object.freeze({
    providers: Object.freeze({}),
    dispose() {},
  }) as unknown as TsLanguageServiceProvidersHandle;
}

afterEach(() => {
  for (const key of HOOK_KEYS) delete globals[key];
});

describe('Playground TypeScript DEV hooks', () => {
  it('installs provider hooks, delegates reinit, and only clears hooks owned by its binding', async () => {
    const firstReinitialize = vi.fn(async () => true);
    const secondReinitialize = vi.fn(async () => false);
    const api = fakeEditorApi();
    const providers = fakeProviders();

    const first = installPlaygroundTsDevHooks({ api, providers, reinitialize: firstReinitialize });
    expect(globals.__riftyTsHover).toBeTypeOf('function');
    expect(await (globals.__riftyTsReinit as () => Promise<boolean>)()).toBe(true);
    expect(firstReinitialize).toHaveBeenCalledOnce();

    const second = installPlaygroundTsDevHooks({
      api,
      providers,
      reinitialize: secondReinitialize,
    });
    first.dispose();
    expect(await (globals.__riftyTsReinit as () => Promise<boolean>)()).toBe(false);
    expect(secondReinitialize).toHaveBeenCalledOnce();

    const replacementHover = vi.fn();
    globals.__riftyTsHover = replacementHover;
    second.dispose();
    expect(globals.__riftyTsReinit).toBeUndefined();
    expect(globals.__riftyTsHover).toBe(replacementHover);
  });
});
