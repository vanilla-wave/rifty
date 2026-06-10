import { describe, expect, it, vi } from 'vitest';
import {
  extractAiCommandPrompt,
  readAiCommandSuggestionConfig,
  suggestAiCommand,
} from './terminal-ai-suggestions.ts';

describe('terminal AI command suggestions', () => {
  it('is disabled without an endpoint URL', () => {
    expect(readAiCommandSuggestionConfig({})).toBeNull();
    expect(readAiCommandSuggestionConfig({ VITE_RIFTY_AI_COMMAND_SUGGEST_URL: '  ' })).toBeNull();
  });

  it('reads endpoint and optional client-visible key from env', () => {
    expect(
      readAiCommandSuggestionConfig({
        VITE_RIFTY_AI_COMMAND_SUGGEST_URL: '/ai/commands',
        VITE_RIFTY_AI_COMMAND_SUGGEST_KEY: 'dev-key',
      }),
    ).toEqual({ url: '/ai/commands', key: 'dev-key' });
  });

  it('extracts non-empty # prompts only', () => {
    expect(extractAiCommandPrompt('# list files')).toBe('list files');
    expect(extractAiCommandPrompt('  # show cwd')).toBe('show cwd');
    expect(extractAiCommandPrompt('#   ')).toBeNull();
    expect(extractAiCommandPrompt('echo # literal')).toBeNull();
  });

  it('posts prompt context and accepts command-shaped responses', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ command: 'ls -la' }),
    }));

    await expect(
      suggestAiCommand(
        { url: '/ai/commands', key: 'dev-key' },
        {
          prompt: 'list files',
          cwd: '/workspace',
          mode: 'dev',
          commands: ['ls', 'pwd'],
        },
        fetcher,
      ),
    ).resolves.toBe('ls -la');

    expect(fetcher).toHaveBeenCalledWith(
      '/ai/commands',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer dev-key' }),
        body: expect.stringContaining('"prompt":"list files"'),
      }),
    );
  });

  it('rejects suggestions outside the allowed command set or with shell joiners', async () => {
    const base = {
      prompt: 'remove everything',
      cwd: '/workspace',
      mode: 'dev' as const,
      commands: ['ls', 'pwd'],
    };
    await expect(
      suggestAiCommand({ url: '/ai/commands' }, base, async () => ({
        ok: true,
        status: 200,
        json: async () => ({ command: 'rm -rf /' }),
      })),
    ).resolves.toBeNull();
    await expect(
      suggestAiCommand({ url: '/ai/commands' }, base, async () => ({
        ok: true,
        status: 200,
        json: async () => ({ suggestion: 'ls && rm x' }),
      })),
    ).resolves.toBeNull();
    await expect(
      suggestAiCommand({ url: '/ai/commands' }, base, async () => ({
        ok: true,
        status: 200,
        json: async () => ({ suggestion: 'ls\npwd' }),
      })),
    ).resolves.toBeNull();
  });

  it('returns null for network failures, non-ok responses, and non-object payloads', async () => {
    const request = {
      prompt: 'list',
      cwd: '/workspace',
      mode: 'dev' as const,
      commands: ['ls'],
    };

    await expect(
      suggestAiCommand({ url: '/ai/commands' }, request, async () => ({
        ok: false,
        status: 500,
        json: async () => ({ command: 'ls' }),
      })),
    ).resolves.toBeNull();
    await expect(
      suggestAiCommand({ url: '/ai/commands' }, request, async () => ({
        ok: true,
        status: 200,
        json: async () => 'ls',
      })),
    ).resolves.toBeNull();
    await expect(
      suggestAiCommand({ url: '/ai/commands' }, request, async () => {
        throw new Error('offline');
      }),
    ).resolves.toBeNull();
  });
});
