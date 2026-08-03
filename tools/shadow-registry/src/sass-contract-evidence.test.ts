import { describe, expect, it } from 'vitest';
import deadlock from './fixtures/sass-1.100.0-async-importer-deadlock.json';
import sassTranscript from './fixtures/sass-1.100.0-contract.json';
import environment from './fixtures/sass-1.100.0-node-oracle-environment.json';
import embeddedTranscript from './fixtures/sass-embedded-1.100.0-contract.json';

describe('Sass 1.100.0 exact Node differential evidence', () => {
  it('pins the exact oracle environment and package identities', () => {
    expect(environment).toMatchObject({
      schema: 1,
      node: 'v24.16.0',
      platform: 'darwin',
      arch: 'arm64',
      packages: [
        {
          name: 'sass',
          version: '1.100.0',
          integrity:
            'sha512-B5j0rYMlinhhOo9tjQebMVVn0TfyXAF+wB3b2ggZUuJ/is/Y+7+JGjirAMxHZ9Z3hIP98NPfamlAkBHa1lAaXQ==',
        },
        {
          name: 'sass-embedded',
          version: '1.100.0',
          integrity:
            'sha512-Ut8wlQSk19tm7jMK6mz6cF1+e+E7tUnW2tM02zQDPnOTcVbV8qCQG8UWxZkkNlY50+hV3hqP24OOkUlMz8xBpw==',
        },
      ],
      platformPackage: {
        name: 'sass-embedded-darwin-arm64',
        version: '1.100.0',
        integrity:
          'sha512-1PVlYi61POo93IT/FfrG1mc1tAHxeSTyUALF2aOFmXGWjVXr3bQzEQiBGCOvQbj/ix+5hNyXFXcEMEyKvtUJJA==',
      },
    });
  });

  it('records all exact matches and only the finite adapted divergence rows', () => {
    expect(sassTranscript).toMatchObject({
      schema: 2,
      oracle: 'sass@1.100.0',
      version:
        'dart-sass\t1.100.0\t(Sass Compiler)\t[Dart]\ndart2js\t3.12.0\t(Dart Compiler)\t[Dart]',
    });
    expect(embeddedTranscript).toMatchObject({
      schema: 2,
      oracle: 'sass-embedded@1.100.0',
      version: 'sass-embedded\t1.100.0',
    });

    for (const row of ['compile', 'sourceMap', 'importers', 'logger'] as const) {
      expect(sassTranscript.rows[row], row).toEqual(embeddedTranscript.rows[row]);
    }
    for (const row of ['module', 'lifecycle', 'errors', 'legacy'] as const) {
      expect(sassTranscript.rows[row], row).not.toEqual(embeddedTranscript.rows[row]);
    }

    const sassLifecycle = sassTranscript.rows.lifecycle;
    const embeddedLifecycle = embeddedTranscript.rows.lifecycle;
    expect(sassLifecycle.syncDirectConstruction.message).toBe(
      'Compiler can not be directly constructed. Please use `sass.initCompiler()` instead.',
    );
    expect(embeddedLifecycle.syncDirectConstruction.message).toBe(
      'Compiler caused error: Compiler can not be directly constructed. Please use `sass.initCompiler()` instead.',
    );
    expect(sassLifecycle.asyncDirectConstruction.message).toBe(
      'AsyncCompiler can not be directly constructed. Please use `sass.initAsyncCompiler()` instead.',
    );
    expect(embeddedLifecycle.asyncDirectConstruction.message).toBe(
      'Compiler caused error: AsyncCompiler can not be directly constructed. Please use `sass.initAsyncCompiler()` instead.',
    );
    expect(sassLifecycle.syncPathFirst).toEqual(embeddedLifecycle.syncPathFirst);
    expect(sassLifecycle.syncPathSecond).toEqual(embeddedLifecycle.syncPathSecond);
    expect(sassLifecycle.asyncPathFirst).toEqual(embeddedLifecycle.asyncPathFirst);
    expect(sassLifecycle.asyncPathSecond).toEqual(embeddedLifecycle.asyncPathSecond);
    expect(sassLifecycle.syncDisposeReturnKind).toBe('undefined');
    expect(embeddedLifecycle.syncDisposeReturnKind).toBe('undefined');
    expect(sassLifecycle.asyncDisposeReturnKind).toBe('promise');
    expect(embeddedLifecycle.asyncDisposeReturnKind).toBe('promise');
    expect(sassLifecycle.asyncDisposeResolvedKind).toBe('null');
    expect(embeddedLifecycle.asyncDisposeResolvedKind).toBe('undefined');
    expect(sassLifecycle.syncPostDisposePath.message).toBe('Compiler has already been disposed.');
    expect(sassLifecycle.syncPostDisposeString.message).toBe('Compiler has already been disposed.');
    expect(embeddedLifecycle.syncPostDisposePath.message).toBe(
      'Compiler caused error: Sync compiler has already been disposed.',
    );
    expect(embeddedLifecycle.syncPostDisposeString.message).toBe(
      'Compiler caused error: Sync compiler has already been disposed.',
    );
    expect(sassLifecycle.asyncPostDisposePath.message).toBe('Compiler has already been disposed.');
    expect(sassLifecycle.asyncPostDisposeString.message).toBe(
      'Compiler has already been disposed.',
    );
    expect(embeddedLifecycle.asyncPostDisposePath.message).toBe(
      'Compiler caused error: Async compiler has already been disposed.',
    );
    expect(embeddedLifecycle.asyncPostDisposeString.message).toBe(
      'Compiler caused error: Async compiler has already been disposed.',
    );
  });

  it('pins the isolated async-importer deadlock twice without leaving a child alive', () => {
    expect(deadlock).toMatchObject({
      schema: 1,
      node: 'v24.16.0',
      platform: 'darwin',
      arch: 'arm64',
      timeoutMs: 2_000,
      attempts: 2,
    });
    expect(deadlock.runs.sass).toHaveLength(2);
    expect(deadlock.runs.sassEmbedded).toHaveLength(2);
    for (const run of deadlock.runs.sass) {
      expect(run).toMatchObject({ timedOut: false, exitCode: 0, signal: null, stderr: '' });
      expect(JSON.parse(run.stdout) as unknown).toMatchObject({
        outcome: 'throw',
        message: expect.stringContaining(
          "The canonicalize() function can't return a Promise for synchronous compile functions.",
        ),
      });
    }
    for (const run of deadlock.runs.sassEmbedded) {
      expect(run).toEqual({
        timedOut: true,
        exitCode: null,
        signal: 'SIGKILL',
        stdout: '',
        stderr: '',
      });
    }
  });
});
