import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const lspTypes = readFileSync(here('./lsp-types.ts'), 'utf8');
const service = readFileSync(here('./service.ts'), 'utf8');
const protocol = readFileSync(here('./worker/protocol.ts'), 'utf8');
const endpoint = readFileSync(here('./worker/service-endpoint.ts'), 'utf8');

describe('TS trigger context source guards', () => {
  it('keeps completion trigger kind/character on the public options and TS call', () => {
    expect(lspTypes).toContain('export type CompletionTriggerKind');
    expect(lspTypes).toContain('readonly triggerCharacter?: CompletionTriggerCharacter');
    expect(lspTypes).toContain('readonly triggerKind?: CompletionTriggerKind');
    expect(service).toContain('function completionTriggerKindToTs');
    expect(service).toContain('triggerCharacter: options.triggerCharacter');
    expect(protocol).toContain('readonly options?: CompletionOptions');
  });

  it('keeps signature-help trigger reason on the public options, protocol, and TS call', () => {
    expect(lspTypes).toContain('export type SignatureHelpTriggerReason');
    expect(lspTypes).toContain('export interface SignatureHelpOptions');
    expect(protocol).toContain('readonly options?: SignatureHelpOptions');
    expect(endpoint).toContain('service.getSignatureHelp(');
    expect(endpoint).toContain('request.options');
    expect(service).toContain('function signatureHelpOptionsToTs');
    expect(service).toContain('service.getSignatureHelpItems(');
    expect(service).toContain('signatureHelpOptionsToTs(options)');
  });
});
