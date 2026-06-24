import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./ts-ls-monaco-providers.ts', import.meta.url)),
  'utf8',
);

describe('rifty TS Monaco provider source guards', () => {
  it('filters TS code-action commands both on the action and inside WorkspaceEdit', () => {
    expect(source).toContain('function hasTsSideEffectCommands(action: LspCodeAction)');
    expect(source).toContain('hasWorkspaceEditCommands(action.edit)');
    expect(source).toContain('canApplyInMonacoEditor(refactor)');
    expect(source).not.toContain(
      'if (refactor.commands && refactor.commands.length > 0) continue;',
    );
  });

  it('passes Monaco completion and signature trigger context through to the TS service', () => {
    expect(source).toContain('const TS_COMPLETION_TRIGGER_CHARACTERS');
    expect(source).toContain('completionOptionsFromMonaco(context)');
    expect(source).toContain('completionOptionsFromModel(model, context)');
    expect(source).toContain('triggerCharacter: context.triggerCharacter');
    expect(source).toContain('options: completionOptionsFromModel(model, context)');
    expect(source).toContain('client.getCompletionDetails(');
    expect(source).toContain('ctx.options');
    expect(source).toContain('const TS_SIGNATURE_TRIGGER_CHARACTERS');
    expect(source).toContain('signatureHelpOptionsFromMonaco(context)');
    expect(source).toContain('client.getSignatureHelp(');
    expect(source).not.toContain('async provideCompletionItems(model, position, _context, token)');
    expect(source).not.toContain('async provideSignatureHelp(model, position, token, _context)');
  });

  it('uses definition links and preserves new-file workspace edits', () => {
    expect(source).toContain('function toMonacoLocationLink(');
    expect(source).toContain('client.getDefinitionLinks(');
    expect(source).not.toContain('const locations = await client.getDefinition(path');
    expect(source).toContain('edit.newFiles?.includes(uri)');
    expect(source).toContain('bridge.canEnsureModel(uri, { isNewFile })');
    expect(source).toContain('bridge.ensureModel(uri, { isNewFile })');
  });

  it('maps TS completion metadata into visible Monaco completion affordances', () => {
    expect(source).toContain('function hasDeprecatedModifier(');
    expect(source).toContain('monaco.languages.CompletionItemTag.Deprecated');
    expect(source).toContain('preselect: entry.isRecommended === true');
    expect(source).toContain('entry.sourceDisplay');
    expect(source).toContain('resolved.sourceDisplay');
  });

  it('applies resolved completion workspace edits through a Monaco command', () => {
    expect(source).toContain('APPLY_COMPLETION_WORKSPACE_EDIT_COMMAND');
    expect(source).toContain('monaco.editor.registerCommand(');
    expect(source).toContain('resolved.additionalTextEditChanges');
    expect(source).toContain('arguments: [resolved.additionalTextEditChanges]');
    expect(source).toContain('applyWorkspaceTextEdit(edit, bridge)');
  });

  it('does not partially apply workspace edits when any Monaco target cannot be opened', () => {
    expect(source).toContain('function resolveWorkspaceEditTargets(');
    expect(source).toContain('for (const uri of Object.keys(edit.changes))');
    expect(source).toContain('if (!bridge.canEnsureModel(uri, { isNewFile })) return null;');
    expect(source).toContain('return null;');
    expect(source).not.toContain('if (!resource) continue;');
    expect(source).not.toContain('if (!model) continue;');
    const helperStart = source.indexOf('function resolveWorkspaceEditTargets(');
    const helperEnd = source.indexOf('function toMonacoWorkspaceTextEdits(');
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperBody = source.slice(helperStart, helperEnd);
    expect(helperBody.indexOf('bridge.canEnsureModel(uri, { isNewFile })')).toBeLessThan(
      helperBody.indexOf('bridge.ensureModel(uri, { isNewFile })'),
    );
  });

  it('does not fall back to same-file completion edits when a workspace edit has commands', () => {
    const resolveStart = source.indexOf('async resolveCompletionItem(');
    const referenceStart = source.indexOf('const referenceProvider');
    expect(resolveStart).toBeGreaterThanOrEqual(0);
    expect(referenceStart).toBeGreaterThan(resolveStart);
    const body = source.slice(resolveStart, referenceStart);
    const workspaceEditBranch = body.indexOf(
      'if (resolved.additionalTextEditChanges !== undefined) {',
    );
    const commandGuard = body.indexOf(
      'hasWorkspaceEditCommands(resolved.additionalTextEditChanges)',
    );
    const sameFileFallback = body.indexOf('resolved.additionalTextEdits !== undefined');
    expect(workspaceEditBranch).toBeGreaterThanOrEqual(0);
    expect(commandGuard).toBeGreaterThan(workspaceEditBranch);
    expect(sameFileFallback).toBeGreaterThan(commandGuard);
  });

  it('resolves code-action edits lazily so discovery has no new-file side effects', () => {
    const provideStart = source.indexOf('async provideCodeActions(');
    const resolveStart = source.indexOf('async resolveCodeAction(');
    expect(provideStart).toBeGreaterThanOrEqual(0);
    expect(resolveStart).toBeGreaterThan(provideStart);
    const provideBody = source.slice(provideStart, resolveStart);
    expect(provideBody).not.toContain('bridge.ensureModel(uri, { isNewFile })');
    expect(provideBody).not.toContain('toMonacoWorkspaceTextEdits(');
    expect(source).toContain('function toMonacoLazyCodeAction(');
    expect(source).toContain('async resolveCodeAction(action, token)');
    expect(source).toContain('toMonacoResolvedCodeAction(action, bridge)');
  });

  it('does not expose editor code actions that need unsupported post-edit rename', () => {
    expect(source).toContain('function canApplyInMonacoEditor(action: LspCodeAction)');
    expect(source).toContain('action.edit?.renameLocation');
    expect(source).toContain('canApplyInMonacoEditor(refactor)');
  });

  it('passes editor formatting options through TS code-action edit APIs', () => {
    expect(source).toContain('function actionEditOptionsFromModel(');
    expect(source).toContain('const actionEditOptions = actionEditOptionsFromModel(model);');
    expect(source).toContain('const fixes = await client.getCodeFixes(');
    expect(source).toContain('[code],\n          actionEditOptions,');
    expect(source).toContain('client.getCombinedCodeFix(path, fix.fixId, actionEditOptions)');
    expect(source).toContain('client.organizeImports(path, actionEditOptions)');
    expect(source).toContain('client.getRefactorActions(\n        path,');
    expect(source).toContain('monacoToLspRange(range),\n        actionEditOptions,');
  });
});
