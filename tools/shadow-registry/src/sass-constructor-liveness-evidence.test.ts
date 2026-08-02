import { describe, expect, it } from 'vitest';
import evidence from './fixtures/sass-1.100.0-constructor-liveness.json';

describe('Sass 1.100.0 invalid-construction liveness evidence', () => {
  it('pins the exact compiler child and post-error process lifetime twice', () => {
    expect(evidence).toMatchObject({
      schema: 1,
      node: 'v24.16.0',
      platform: 'darwin',
      arch: 'arm64',
      startupTimeoutMs: 5_000,
      postOutcomeTimeoutMs: 1_500,
      attempts: 2,
      environment: {
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
        compilerCommand: [
          {
            path: 'node_modules/sass-embedded-darwin-arm64/dart-sass/src/dart',
            bytes: 4_759_584,
            sha256: '41ae61a87c19389f7d69b3cfaa57a7fb9ded323980b39c1382d0f74db3ba368d',
          },
          {
            path: 'node_modules/sass-embedded-darwin-arm64/dart-sass/src/sass.snapshot',
            bytes: 5_630_560,
            sha256: 'a7ff61aaafd4ad9a1e0504da5427d0b4de67f3ab6ea47935c405027005b9402c',
          },
        ],
      },
    });
    for (const moduleKind of ['cjs', 'esm'] as const) {
      for (const packageName of ['sass', 'sass-embedded'] as const) {
        const importRuns = evidence.runs[packageName][moduleKind].ImportOnly;
        expect(importRuns).toHaveLength(2);
        for (const run of importRuns) {
          expect(run).toEqual({
            outcomeChannel: 'ipc',
            outcome: { outcome: 'imported' },
            startupTimedOut: false,
            postOutcomeTimedOut: false,
            cleanupForced: false,
            processGroupGone: true,
            exitCode: 0,
            signal: null,
          });
        }
      }
      for (const constructorName of ['Compiler', 'AsyncCompiler'] as const) {
        const directMessage =
          constructorName === 'Compiler'
            ? 'Compiler can not be directly constructed. Please use `sass.initCompiler()` instead.'
            : 'AsyncCompiler can not be directly constructed. Please use `sass.initAsyncCompiler()` instead.';
        const embeddedMessage = `Compiler caused error: ${directMessage}`;
        const pureRuns = evidence.runs.sass[moduleKind][constructorName];
        const embeddedRuns = evidence.runs['sass-embedded'][moduleKind][constructorName];
        expect(pureRuns).toHaveLength(2);
        expect(embeddedRuns).toHaveLength(2);
        for (const run of pureRuns) {
          expect(run).toMatchObject({
            outcomeChannel: 'ipc',
            outcome: {
              outcome: 'throw',
              name: 'Error',
              message: directMessage,
              toString: `Error: ${directMessage}`,
            },
            startupTimedOut: false,
            postOutcomeTimedOut: false,
            cleanupForced: false,
            processGroupGone: true,
            exitCode: 0,
            signal: null,
          });
        }
        for (const run of embeddedRuns) {
          expect(run).toMatchObject({
            outcomeChannel: 'ipc',
            outcome: {
              outcome: 'throw',
              name: 'Error',
              message: embeddedMessage,
              toString: `Error: ${embeddedMessage}`,
            },
            startupTimedOut: false,
            postOutcomeTimedOut: true,
            cleanupForced: false,
            processGroupGone: true,
            processGroup: {
              memberCount: 2,
              leaderCommand: 'node',
              compilerChildCommand: 'node_modules/sass-embedded-darwin-arm64/dart-sass/src/dart',
              compilerChildParent: 'leader',
            },
            deadlineProcessGroup: {
              memberCount: 2,
              leaderCommand: 'node',
              compilerChildCommand: 'node_modules/sass-embedded-darwin-arm64/dart-sass/src/dart',
              compilerChildParent: 'leader',
            },
            exitCode: null,
            signal: 'SIGKILL',
          });
        }
      }
    }
  });
});
